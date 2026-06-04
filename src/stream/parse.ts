import { EikonCompatibilityError, EikonValidationError } from "../contract/errors"
import {
  assertLaunchCompatibility,
  LAUNCH_MAJOR_VERSION,
  type ClipName,
  type LaunchClipRecord,
  type LaunchExtensionRecord,
  type LaunchFrameRecord,
  type LaunchHeaderRecord,
  type LaunchStreamRecord,
  type SignalName,
  type ExtensionSet,
} from "../contract/shape"

export type ParsedClip = { fps: number; frames: string[][]; loopFrom: number; color?: string }
export type ParsedLaunchMeta = {
  version: number
  name: string
  title?: string
  author?: string
  description?: string
  glyph?: string
  width: number
  height: number
  states: string[]
}
export type ParsedLaunchStream = {
  header: LaunchHeaderRecord
  records: LaunchStreamRecord[]
  meta: ParsedLaunchMeta
  clips: Map<string, ParsedClip>
}
export type ResolvedSignal = { signal: SignalName; clip: ClipName; mapping: NonNullable<LaunchHeaderRecord["signals"][SignalName]>; fallbackPath: SignalName[] }

type Row = Record<string, unknown>
type ClipState = { record: LaunchClipRecord; frames: string[][]; seen: Set<number> }

const FORBIDDEN_HEADER_KEYS = new Set([
  "origin",
  "originUrl",
  "origin_url",
  "source",
  "sourceUrl",
  "source_url",
  "editPackageUrl",
  "edit_package_url",
  "generator",
  "generatedBy",
  "packageDigest",
  "package_digest",
  "poster",
  "preview",
  "license",
  "provenance",
  "platform",
  "download",
  "downloadUrl",
  "download_url",
])

const fail = (line: number, message: string): never => {
  throw new EikonValidationError([{ code: "stream", path: `line ${line}`, message: `line ${line}: ${message}` }])
}

const failPath = (path: string, message: string): never => {
  throw new EikonValidationError([{ code: "stream", path, message: `${path}: ${message}` }])
}

function row(line: string, n: number): Row {
  try {
    const value = JSON.parse(line) as unknown
    if (!value || typeof value !== "object" || Array.isArray(value)) fail(n, "record must be an object")
    return value as Row
  } catch (err) {
    if (err instanceof EikonValidationError) throw err
    const msg = err instanceof Error ? err.message : String(err)
    throw new EikonValidationError([{ code: "stream-json", path: `line ${n}`, message: `malformed JSON on line ${n}: ${msg}` }])
  }
}

const isNum = (value: unknown): value is number => typeof value === "number" && Number.isFinite(value)
const isInt = (value: unknown): value is number => isNum(value) && Math.trunc(value) === value
const isStr = (value: unknown): value is string => typeof value === "string" && value.length > 0
const isObj = (value: unknown): value is Row => !!value && typeof value === "object" && !Array.isArray(value)
const isRows = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string")
const isSignal = (value: string): value is SignalName => value.includes(".") && !value.startsWith(".") && !value.endsWith(".")

function checkCompatibility(version: string | number, extensions: ExtensionSet | undefined, n: number): void {
  try {
    assertLaunchCompatibility(version, extensions)
  } catch (err) {
    if (err instanceof EikonCompatibilityError) {
      throw new EikonValidationError(err.problems.map(problem => ({ code: problem.code, path: `line ${n}`, message: `line ${n}: ${problem.message}` })))
    }
    throw err
  }
}

function readHeader(record: Row, n: number): LaunchHeaderRecord {
  if (record.type !== "header") fail(n, "first record must be header")
  for (const key of Object.keys(record)) {
    if (FORBIDDEN_HEADER_KEYS.has(key)) fail(n, `header field "${key}" is not allowed in launch runtime streams`)
  }
  if (record.eikon !== LAUNCH_MAJOR_VERSION) fail(n, `header.eikon must be ${LAUNCH_MAJOR_VERSION}`)
  const sizeRaw = record.size
  if (!isObj(sizeRaw)) fail(n, "header.size object required")
  const size = sizeRaw as Row
  if (!isInt(size.cols) || size.cols <= 0) fail(n, "header.size.cols positive integer required")
  if (!isInt(size.rows) || size.rows <= 0) fail(n, "header.size.rows positive integer required")
  if (!isStr(record.defaultSignal) || !isSignal(record.defaultSignal)) fail(n, "header.defaultSignal namespaced string required")
  const defaultSignal = record.defaultSignal as SignalName
  const signalsRaw = record.signals
  if (!isObj(signalsRaw)) fail(n, "header.signals object required")
  const signals = signalsRaw as Record<string, unknown>
  if (!signals[defaultSignal]) fail(n, "header.defaultSignal must be declared in header.signals")
  for (const [signal, raw] of Object.entries(signals)) {
    if (!isSignal(signal)) fail(n, `header.signals key "${signal}" must be namespaced`)
    if (!isObj(raw)) fail(n, `header.signals.${signal} object required`)
    const mapping = raw as Row
    if (!isStr(mapping.clip)) fail(n, `header.signals.${signal}.clip string required`)
    if (mapping.fallback != null && (!isStr(mapping.fallback) || !isSignal(mapping.fallback))) fail(n, `header.signals.${signal}.fallback namespaced string required`)
  }
  return record as LaunchHeaderRecord
}

function readClip(record: Row, n: number): LaunchClipRecord {
  if (!isStr(record.name)) fail(n, "clip.name string required")
  if (!isNum(record.fps) || record.fps <= 0) fail(n, "clip.fps positive number required")
  if (record.frameCount != null && (!isInt(record.frameCount) || record.frameCount < 0)) fail(n, "clip.frameCount non-negative integer required")
  if (record.loopFrom != null && (!isInt(record.loopFrom) || record.loopFrom < 0)) fail(n, "clip.loopFrom non-negative integer required")
  if ("fallback" in record) fail(n, "clip.fallback is not part of the launch contract; use header.signals fallback")
  return record as LaunchClipRecord
}

function readFrame(record: Row, n: number): LaunchFrameRecord {
  if (!isStr(record.clip)) fail(n, "frame.clip string required")
  if (!isInt(record.index) || record.index < 0) fail(n, "frame.index non-negative integer required")
  if (!isRows(record.rows)) fail(n, "frame.rows string array required")
  return record as LaunchFrameRecord
}

function readExtension(record: Row, n: number): LaunchExtensionRecord {
  if (!isStr(record.extension)) fail(n, "extension.extension string required")
  if (!("payload" in record)) fail(n, "extension.payload required")
  return record as LaunchExtensionRecord
}

function checkFrameSize(record: LaunchFrameRecord, header: LaunchHeaderRecord, n: number): void {
  if (record.rows.length !== header.size.rows) fail(n, `frame height ${record.rows.length} does not match size.rows ${header.size.rows}`)
  for (const r of record.rows) {
    if (Array.from(r).length !== header.size.cols) fail(n, `frame width ${Array.from(r).length} does not match size.cols ${header.size.cols}`)
  }
}

function getState(states: Map<ClipName, ClipState>, clip: ClipName, line: number): ClipState {
  const state = states.get(clip)
  if (state === undefined) fail(line, `frame for clip "${clip}" before clip declaration`)
  return state as ClipState
}

function validateFallbackGraph(header: LaunchHeaderRecord): void {
  for (const signal of Object.keys(header.signals) as SignalName[]) {
    const seen = new Set<SignalName>()
    let current: SignalName | undefined = signal
    while (current) {
      if (seen.has(current)) failPath(`header.signals.${signal}.fallback`, `fallback cycle detected: ${[...seen, current].join(" -> ")}`)
      seen.add(current)
      current = header.signals[current]?.fallback
    }
  }
}

function resolveSignalInternal(header: LaunchHeaderRecord, clips: Map<string, ParsedClip>, signal: SignalName): ResolvedSignal {
  const fallbackPath: SignalName[] = []
  const seen = new Set<SignalName>()
  let current: SignalName = header.signals[signal] ? signal : header.defaultSignal
  if (!header.signals[signal]) fallbackPath.push(signal)
  while (true) {
    if (seen.has(current)) failPath(`header.signals.${signal}.fallback`, `fallback cycle detected: ${[...seen, current].join(" -> ")}`)
    seen.add(current)
    fallbackPath.push(current)
    const mapping = header.signals[current]
    if (!mapping) failPath(`header.signals.${current}`, "signal mapping missing")
    const resolvedMapping = mapping as NonNullable<typeof mapping>
    if (clips.has(resolvedMapping.clip)) return { signal: current, clip: resolvedMapping.clip, mapping: resolvedMapping, fallbackPath }
    const next = resolvedMapping.fallback ?? header.defaultSignal
    if (next === current) failPath(`header.signals.${current}`, `signal maps to missing clip "${resolvedMapping.clip}" and fallback loops to itself`)
    current = next
  }
}

function validateSignalResolution(header: LaunchHeaderRecord, clips: Map<string, ParsedClip>): void {
  validateFallbackGraph(header)
  for (const signal of Object.keys(header.signals) as SignalName[]) resolveSignalInternal(header, clips, signal)
  resolveSignalInternal(header, clips, header.defaultSignal)
}

export function parseLaunchStream(text: string): ParsedLaunchStream {
  const lines = text.split("\n")
  const records: LaunchStreamRecord[] = []
  let head: LaunchHeaderRecord | undefined
  const building = new Map<ClipName, ClipState>()

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (!line?.trim()) continue
    const n = i + 1
    const rec = row(line, n)
    if (!head) {
      head = readHeader(rec, n)
      checkCompatibility(head.eikon, head.extensions, n)
      records.push(head)
      continue
    }
    if (rec.type === "header") fail(n, "duplicate header record")
    if (rec.type === "clip") {
      const item = readClip(rec, n)
      checkCompatibility(head.eikon, item.extensions, n)
      if (building.has(item.name)) fail(n, `duplicate clip "${item.name}"`)
      building.set(item.name, { record: item, frames: [], seen: new Set() })
      records.push(item)
      continue
    }
    if (rec.type === "frame") {
      const item = readFrame(rec, n)
      checkCompatibility(head.eikon, item.extensions, n)
      checkFrameSize(item, head, n)
      const state = getState(building, item.clip, n)
      if (state.seen.has(item.index)) fail(n, `duplicate frame ${item.index} for clip "${item.clip}"`)
      if (item.index !== state.frames.length) fail(n, `frame index ${item.index} out of order for clip "${item.clip}"`)
      state.seen.add(item.index)
      state.frames.push(item.rows)
      records.push(item)
      continue
    }
    if (rec.type === "extension") {
      const item = readExtension(rec, n)
      records.push(item)
      continue
    }
    fail(n, "record.type must be header, clip, frame, or extension")
  }

  if (!head) fail(1, "empty stream")
  const header = head as LaunchHeaderRecord
  const clips = new Map<string, ParsedClip>()
  const states: string[] = []
  for (const [name, state] of building) {
    const expected = state.record.frameCount
    if (expected != null && expected !== state.frames.length) {
      throw new EikonValidationError([{ code: "stream-frame-count", path: `clip ${name}`, message: `clip "${name}": frameCount=${expected} but got ${state.frames.length}` }])
    }
    if (state.record.loopFrom != null && state.record.loopFrom > state.frames.length) failPath(`clip ${name}`, `loopFrom ${state.record.loopFrom} exceeds frame count ${state.frames.length}`)
    states.push(name)
    clips.set(name, {
      fps: state.record.fps,
      frames: state.frames,
      loopFrom: Math.max(0, Math.min(state.record.loopFrom ?? 0, state.frames.length)),
      ...(state.record.color ? { color: state.record.color } : {}),
    })
  }
  validateSignalResolution(header, clips)

  const meta: ParsedLaunchMeta = {
    version: header.eikon,
    name: header.title ?? header.id ?? "unnamed",
    title: header.title,
    author: header.author?.name,
    description: header.description,
    width: header.size.cols,
    height: header.size.rows,
    states,
  }
  return { header, meta, clips, records }
}

export function resolveSignal(stream: ParsedLaunchStream, signal: SignalName | string): ResolvedSignal {
  const requested = isSignal(signal) ? signal : stream.header.defaultSignal
  return resolveSignalInternal(stream.header, stream.clips, requested)
}

export function serializeLaunchStream(records: readonly LaunchStreamRecord[]): string {
  if (!records.length) throw new EikonValidationError([{ code: "stream", path: "records", message: "stream requires records" }])
  const text = records.map(record => JSON.stringify(record)).join("\n") + "\n"
  parseLaunchStream(text)
  return text
}
