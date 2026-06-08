/**
 * .eikon file parser — NDJSON stateful ASCII animation format.
 *
 * Line 1 is a header object. Subsequent lines are either state
 * declarations (`{state, fps, frame_count, ...}`) or frame objects
 * (`{f, data, ...}`) belonging to the most recent state. Unknown
 * fields are ignored.
 *
 * Spec: docs/SPEC.md
 */

import { readdirSync } from "node:fs"
import { join } from "node:path"
import { STATES, type State } from "./spec"
import { parseLaunchStream } from "../stream/parse"
import { decodeRuntimeFile } from "../stream/runtime-host"

export { STATES, type State }

export type Meta = {
  version: number
  name: string
  author?: string
  glyph?: string
  width: number
  height: number
  states: string[]
  [k: string]: unknown
}

export type Clip = {
  fps: number
  /** Each frame as an array of lines (row-per-string). */
  frames: string[][]
  /** First frame of the loop segment. 0 = loop whole sequence;
   *  frames.length = play once and hold the last frame. */
  loopFrom: number
}

export type Eikon = {
  meta: Meta
  clips: Map<string, Clip>
}

type Row = Record<string, unknown>

const num = (v: unknown, d: number) => typeof v === "number" && isFinite(v) ? v : d
const str = (v: unknown, d = "") => typeof v === "string" ? v : d

function row(line: string, n: number): Row {
  try { return JSON.parse(line) as Row }
  catch (e) {
    const msg = e instanceof Error ? e.message : String(e)
    throw new Error(`eikon: malformed JSON on line ${n}: ${msg}`)
  }
}

function median(xs: number[]): number {
  const s = [...xs].sort((a, b) => a - b)
  const m = s.length >> 1
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2
}

/** Parse a full .eikon NDJSON document. Throws with line number on bad JSON. */
export function parse(text: string): Eikon {
  const lines = text.split("\n")
  if (!lines[0]?.trim()) throw new Error("eikon: empty file (no header on line 1)")

  const head = row(lines[0], 1)
  if (head.type === "header") return parseLaunchStream(text)
  const meta: Meta = {
    ...head,
    version: num(head.eikon ?? head.version, 1),
    name: str(head.name, "unnamed"),
    author: typeof head.author === "string" ? head.author : undefined,
    glyph: typeof head.glyph === "string" ? head.glyph : undefined,
    width: num(head.width, 0),
    height: num(head.height, 0),
    states: Array.isArray(head.states) ? (head.states as string[]) : [],
  }

  const clips = new Map<string, Clip>()
  let cur: { name: string; fps?: number; loopFrom: number; loop?: boolean; frames: string[][]; durs: number[] } | null = null

  const seal = () => {
    if (!cur) return
    const fps = cur.fps ?? (cur.durs.length ? Math.round(1000 / median(cur.durs)) || 12 : 12)
    const n = cur.frames.length
    const raw = cur.loop === false ? n : cur.loopFrom
    clips.set(cur.name, { fps, frames: cur.frames, loopFrom: Math.max(0, Math.min(raw, n)) })
    cur = null
  }

  for (let i = 1; i < lines.length; i++) {
    const line = lines[i]
    if (!line || !line.trim()) continue
    const obj = row(line, i + 1)

    if (typeof obj.state === "string") {
      seal()
      cur = {
        name: obj.state,
        fps: typeof obj.fps === "number" ? obj.fps : undefined,
        loopFrom: typeof obj.loop_from === "number" ? Math.trunc(obj.loop_from) : 0,
        loop: typeof obj.loop === "boolean" ? obj.loop : undefined,
        frames: [],
        durs: [],
      }
      continue
    }

    if (!cur) continue
    const data = typeof obj.data === "string"
      ? obj.data.split("\n")
      : Array.isArray(obj.lines) ? (obj.lines as string[]) : []
    cur.frames.push(data)
    const ms = num(obj.duration_ms, 0) || num(obj.pause, 0) * 1000
    if (ms > 0) cur.durs.push(ms)
  }
  seal()

  if (meta.states.length === 0) meta.states = Array.from(clips.keys())
  return { meta, clips }
}

/** idle frame 0 as a newline-joined string, or empty if absent. */
export function poster(e: Eikon): string {
  return (e.clips.get("idle") ?? e.clips.values().next().value)?.frames[0]?.join("\n") ?? ""
}

/** Decode a runtime file, accepting plain or gzip stored bytes. */
export function decode(path: string): string {
  return decodeRuntimeFile(path)
}

/** Read metadata from a .eikon file, accepting plain or gzip stored bytes. */
export function peek(path: string): Meta | null {
  try {
    const text = decode(path)
    const first = text.split("\n", 1)[0]
    if (!first) return null
    const head = row(first, 1)
    if (head.type === "header") {
      const parsed = parseLaunchStream(text)
      return parsed.meta
    }
    return parse(text).meta
  } catch {
    return null
  }
}

/**
 * Scan directories for `*.eikon` files and return their header metadata.
 * Missing dirs are silently skipped.
 */
export function list(dirs: string[]): { path: string; meta: Meta }[] {
  return dirs.flatMap(dir => {
    let ents: string[]
    try { ents = readdirSync(dir, { recursive: true }) as string[] }
    catch { return [] }
    const files = ents
      .filter(e => e.endsWith(".eikon"))
      .map(e => join(dir, e))
    return files
      .map(path => ({ path, meta: peek(path) }))
      .filter((x): x is { path: string; meta: Meta } => x.meta !== null)
  })
}
