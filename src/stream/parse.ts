import { EikonCompatibilityError, EikonValidationError } from "../contract/errors"
import {
  assertLaunchCompatibility,
  type ClipName,
  type LaunchClipRecord,
  type LaunchFrameRecord,
  type LaunchHeaderRecord,
  type LaunchStreamRecord,
} from "../contract/shape"
import type { Clip, Eikon, Meta } from "../ui/eikon"

export type ParsedLaunchStream = Eikon & {
  records: LaunchStreamRecord[]
}

type Row = Record<string, unknown>
type ClipState = { record: LaunchClipRecord; frames: string[][]; seen: Set<number> }

const fail = (line: number, message: string): never => {
  throw new EikonValidationError([{ code: "stream", path: `line ${line}`, message: `line ${line}: ${message}` }])
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
const isStr = (value: unknown): value is string => typeof value === "string" && value.length > 0
const isRows = (value: unknown): value is string[] => Array.isArray(value) && value.every(v => typeof v === "string")

function readHeader(record: Row, n: number): LaunchHeaderRecord {
  if (record.type !== "header") fail(n, "first record must be header")
  const asset = record.asset
  if (!asset || typeof asset !== "object" || Array.isArray(asset)) fail(n, "header.asset object required")
  const a = asset as Row
  if (!isStr(a.version)) fail(n, "header.asset.version string required")
  if (!isNum(a.width) || !isNum(a.height)) fail(n, "header.asset width and height required")
  return record as LaunchHeaderRecord
}

function checkCompatibility(version: string, extensions: LaunchStreamRecord["extensions"], n: number): void {
  try {
    assertLaunchCompatibility(version, extensions)
  } catch (err) {
    if (err instanceof EikonCompatibilityError) {
      throw new EikonValidationError(err.problems.map(problem => ({ code: problem.code, path: `line ${n}`, message: `line ${n}: ${problem.message}` })))
    }
    throw err
  }
}

function checkFrameSize(record: LaunchFrameRecord, header: LaunchHeaderRecord, n: number): void {
  if (record.rows.length !== header.asset.height) fail(n, `frame height ${record.rows.length} does not match asset.height ${header.asset.height}`)
  for (const r of record.rows) {
    if (Array.from(r).length !== header.asset.width) fail(n, `frame width ${Array.from(r).length} does not match asset.width ${header.asset.width}`)
  }
}

function readClip(record: Row, n: number): LaunchClipRecord {
  if (!isStr(record.name)) fail(n, "clip.name string required")
  if (!isNum(record.fps) || record.fps <= 0) fail(n, "clip.fps positive number required")
  if (record.frameCount != null && (!isNum(record.frameCount) || record.frameCount < 0)) fail(n, "clip.frameCount non-negative number required")
  if (record.loopFrom != null && (!isNum(record.loopFrom) || record.loopFrom < 0)) fail(n, "clip.loopFrom non-negative number required")
  if (record.fallback != null && !isStr(record.fallback)) fail(n, "clip.fallback string required")
  return record as LaunchClipRecord
}

function readFrame(record: Row, n: number): LaunchFrameRecord {
  if (!isStr(record.clip)) fail(n, "frame.clip string required")
  if (!isNum(record.index) || record.index < 0 || Math.trunc(record.index) !== record.index) fail(n, "frame.index non-negative integer required")
  if (!isRows(record.rows)) fail(n, "frame.rows string array required")
  return record as LaunchFrameRecord
}

function getState(states: Map<ClipName, ClipState>, clip: ClipName, line: number): ClipState {
  const state = states.get(clip)
  if (state === undefined) fail(line, `frame for clip "${clip}" before clip declaration`)
  return state as ClipState
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
      checkCompatibility(head.asset.version, head.extensions, n)
      records.push(head)
      continue
    }
    if (rec.type === "header") fail(n, "duplicate header record")
    if (rec.type === "clip") {
      const item = readClip(rec, n)
      checkCompatibility(head.asset.version, item.extensions, n)
      if (building.has(item.name)) fail(n, `duplicate clip "${item.name}"`)
      building.set(item.name, { record: item, frames: [], seen: new Set() })
      records.push(item)
      continue
    }
    if (rec.type === "frame") {
      const item = readFrame(rec, n)
      checkCompatibility(head.asset.version, item.extensions, n)
      checkFrameSize(item, head, n)
      const state = getState(building, item.clip, n)
      if (state.seen.has(item.index)) fail(n, `duplicate frame ${item.index} for clip "${item.clip}"`)
      if (item.index !== state.frames.length) fail(n, `frame index ${item.index} out of order for clip "${item.clip}"`)
      state.seen.add(item.index)
      state.frames.push(item.rows)
      records.push(item)
      continue
    }
    fail(n, "record.type must be header, clip, or frame")
  }

  if (!head) fail(1, "empty stream")
  const header = head as LaunchHeaderRecord
  const clips = new Map<string, Clip>()
  const states: string[] = []
  for (const [name, state] of building) {
    const expected = state.record.frameCount
    if (expected != null && expected !== state.frames.length) {
      throw new EikonValidationError([{ code: "stream-frame-count", path: `clip ${name}`, message: `clip "${name}": frameCount=${expected} but got ${state.frames.length}` }])
    }
    states.push(name)
    clips.set(name, { fps: state.record.fps, frames: state.frames, loopFrom: Math.max(0, Math.min(state.record.loopFrom ?? 0, state.frames.length)) })
  }

  const meta: Meta = {
    version: Number(header.asset.version.split(".")[0]) || 2,
    name: header.name ?? "unnamed",
    glyph: header.glyph,
    width: header.asset.width,
    height: header.asset.height,
    states,
  }
  return { meta, clips, records }
}

export function serializeLaunchStream(records: readonly LaunchStreamRecord[]): string {
  if (!records.length) throw new EikonValidationError([{ code: "stream", path: "records", message: "stream requires records" }])
  const text = records.map(record => JSON.stringify(record)).join("\n") + "\n"
  parseLaunchStream(text)
  return text
}
