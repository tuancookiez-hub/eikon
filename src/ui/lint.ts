import { parse, STATES, type Eikon, type State } from "./eikon"
import { existsSync, statSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import type { Origin } from "../install"

export const NAME_RE = /^[a-z0-9-]{2,32}$/
export const PUBLIC_LIMITS = {
  minWidth: 8,
  minHeight: 4,
  maxWidth: 160,
  maxHeight: 80,
  maxFps: 30,
  maxFrames: 1200,
  maxPackedBytes: 2_000_000,
  maxPosterBytes: 250_000,
  maxCatalogBytes: 500_000,
  maxPreviewBytes: 100_000,
  fetchTimeoutMs: 10_000,
}

const URL_FIELDS = ["source_url", "homepage_url", "repository_url"]
const REQUIRED_REGISTRY_META = ["author", "glyph", "license", "description"]

/** Validate publish invariants. Returns parsed doc; throws with all errors joined. */
export function lint(raw: string): Eikon {
  const e = parse(raw)
  const errs: string[] = []
  if (!NAME_RE.test(e.meta.name)) errs.push(`name "${e.meta.name}" must match ${NAME_RE}`)
  if (!e.meta.author) errs.push("header.author required")
  if (!e.meta.glyph) errs.push("header.glyph required")
  if (e.meta.width < PUBLIC_LIMITS.minWidth || e.meta.height < PUBLIC_LIMITS.minHeight) errs.push(`dims ${e.meta.width}×${e.meta.height} too small`)
  for (const s of STATES)
    if (!e.clips.get(s)?.frames.length) errs.push(`state "${s}" missing or empty`)
  if (errs.length) throw new Error(errs.join("\n  "))
  return e
}

function safeUrl(key: string, val: unknown, errs: string[]) {
  if (val === undefined) return
  if (typeof val !== "string") { errs.push(`header.${key} must be a URL string`); return }
  let url: URL
  try { url = new URL(val) }
  catch { errs.push(`header.${key} must be a valid URL`); return }
  if (url.protocol !== "https:") errs.push(`header.${key} must use https`)
  if (url.username || url.password) errs.push(`header.${key} must not include credentials`)
  const host = url.hostname.toLowerCase().replace(/^\[|\]$/g, "")
  if (host === "localhost" || nonPublicHost(host)) errs.push(`header.${key} must point at a public host`)
}

function nonPublicHost(host: string) {
  const v4 = parseIpv4(host)
  if (v4) return nonPublicIpv4(v4)
  const v6 = parseIpv6(host)
  if (!v6) return false
  const mapped = mappedIpv4(v6)
  if (mapped) return nonPublicIpv4(mapped)
  return v6.every(x => x === 0)
    || v6.slice(0, 7).every(x => x === 0) && v6[7] === 1
    || (v6[0]! & 0xfe00) === 0xfc00
    || (v6[0]! & 0xffc0) === 0xfe80
}

function parseIpv4(host: string) {
  const parts = host.split(".")
  if (parts.length !== 4) return null
  const nums = parts.map(x => /^\d+$/.test(x) ? Number(x) : NaN)
  return nums.every(x => Number.isInteger(x) && x >= 0 && x <= 255) ? nums : null
}

function nonPublicIpv4(ip: number[]) {
  return ip[0] === 0
    || ip[0] === 10
    || ip[0] === 127
    || ip[0] === 169 && ip[1] === 254
    || ip[0] === 172 && ip[1]! >= 16 && ip[1]! <= 31
    || ip[0] === 192 && ip[1] === 168
}

function parseIpv6(host: string) {
  if (!host.includes(":")) return null
  const [addr] = host.split("%", 1)
  const dot = addr!.lastIndexOf(":")
  const tail = dot === -1 ? "" : addr!.slice(dot + 1)
  const v4 = parseIpv4(tail)
  const text = v4 ? `${addr!.slice(0, dot)}:${((v4[0]! << 8) | v4[1]!).toString(16)}:${((v4[2]! << 8) | v4[3]!).toString(16)}` : addr!
  if ((text.match(/::/g) ?? []).length > 1) return null
  const sides = text.split("::")
  const left = sides[0] ? sides[0].split(":") : []
  const right = sides[1] ? sides[1].split(":") : []
  const fill = sides.length === 2 ? Array(8 - left.length - right.length).fill("0") : []
  const parts = [...left, ...fill, ...right]
  if (parts.length !== 8) return null
  const nums = parts.map(x => /^[0-9a-f]{1,4}$/i.test(x) ? parseInt(x, 16) : NaN)
  return nums.every(x => Number.isInteger(x) && x >= 0 && x <= 0xffff) ? nums : null
}

function mappedIpv4(ip: number[]) {
  if (!ip.slice(0, 5).every(x => x === 0) || ip[5] !== 0xffff) return null
  return [ip[6]! >> 8, ip[6]! & 0xff, ip[7]! >> 8, ip[7]! & 0xff]
}

function text(val: unknown) {
  return typeof val === "string" ? val : ""
}

function hasControl(s: string) {
  return /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f\x1b]/.test(s)
}

function hasControlValue(val: unknown): boolean {
  if (typeof val === "string") return hasControl(val)
  if (Array.isArray(val)) return val.some(hasControlValue)
  if (val && typeof val === "object") return Object.values(val).some(hasControlValue)
  return false
}

/** Registry-only validation for public marketplace entries. */
export function lintRegistry(raw: string): Eikon {
  const e = lint(raw)
  const errs: string[] = []
  if (Buffer.byteLength(raw) > PUBLIC_LIMITS.maxPackedBytes) errs.push(`packed .eikon exceeds ${PUBLIC_LIMITS.maxPackedBytes} bytes`)
  for (const k of REQUIRED_REGISTRY_META)
    if (!text(e.meta[k]).trim()) errs.push(`header.${k} required for registry entries`)
  for (const k of URL_FIELDS) safeUrl(k, e.meta[k], errs)
  if (e.meta.width > PUBLIC_LIMITS.maxWidth || e.meta.height > PUBLIC_LIMITS.maxHeight) errs.push(`dims ${e.meta.width}×${e.meta.height} exceed ${PUBLIC_LIMITS.maxWidth}×${PUBLIC_LIMITS.maxHeight}`)
  if (hasControlValue(e.meta)) errs.push("header metadata contains control characters")

  let frames = 0
  for (const [name, clip] of e.clips) {
    if (clip.fps < 1 || clip.fps > PUBLIC_LIMITS.maxFps) errs.push(`state "${name}" fps ${clip.fps} exceeds ${PUBLIC_LIMITS.maxFps}`)
    frames += clip.frames.length
    for (const frame of clip.frames)
      for (const line of frame)
        if (hasControl(line)) errs.push(`state "${name}" contains a control character`)
  }
  if (frames > PUBLIC_LIMITS.maxFrames) errs.push(`frame count ${frames} exceeds ${PUBLIC_LIMITS.maxFrames}`)
  if (Buffer.byteLength((e.clips.get("idle") ?? e.clips.values().next().value)?.frames[0]?.join("\n") ?? "") > PUBLIC_LIMITS.maxPosterBytes)
    errs.push(`poster exceeds ${PUBLIC_LIMITS.maxPosterBytes} bytes`)
  if (errs.length) throw new Error(errs.join("\n  "))
  return e
}

export type Manifest = {
  name: string
  version: number
  eikon_requires?: string
  source?: string
  license?: string
  provenance?: string
  states: Partial<Record<State, { file: string }>>
  origin?: Origin
}

function rel(key: string, val: string, errs: string[]) {
  if (val.startsWith("/") || val.includes("..") || /^[a-z]+:/i.test(val)) errs.push(`${key}: must be a relative path inside the eikon dir`)
}

/** Validate an eikons/<name>/manifest.json: schema + referenced files
 *  exist relative to its directory + name matches its folder. */
export function lintManifest(path: string, raw: string, registry = false): Manifest {
  const man = JSON.parse(raw) as Manifest
  const dir = dirname(path)
  const errs: string[] = []
  if (!NAME_RE.test(man.name)) errs.push(`name "${man.name}" must match ${NAME_RE}`)
  if (basename(dir) !== man.name) errs.push(`name "${man.name}" ≠ folder "${basename(dir)}"`)
  if (man.source) {
    rel("source", man.source, errs)
    const p = join(dir, man.source)
    if (!existsSync(p)) errs.push(`source: ${man.source} missing`)
    else if (registry && statSync(p).size > PUBLIC_LIMITS.maxPosterBytes) errs.push(`source: ${man.source} exceeds ${PUBLIC_LIMITS.maxPosterBytes} bytes`)
  }
  if (!man.states || typeof man.states !== "object") errs.push("states: object required")
  else for (const [st, v] of Object.entries(man.states)) {
    if (!STATES.includes(st as never)) errs.push(`states.${st}: unknown state`)
    else if (!v?.file) errs.push(`states.${st}.file required`)
    else {
      rel(`states.${st}.file`, v.file, errs)
      const p = join(dir, v.file)
      if (!existsSync(p)) errs.push(`states.${st}.file: ${v.file} missing`)
    }
  }
  if (registry && man.origin) errs.push("origin is install metadata and must not be committed to registry manifests")
  if (errs.length) throw new Error(`${path}:\n  ${errs.join("\n  ")}`)
  return man
}
