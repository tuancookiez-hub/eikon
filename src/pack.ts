// image/video/dir → .eikon packer. Backs `eikon pack`.
//
// Input forms (first match wins):
//   file.{png,jpg,jpeg,webp,bmp}   1 frame → all 6 states
//   file.{mp4,mov,webm,mkv,gif}    N frames → all states share this loop
//   dir/<state>.{ext}              per-state file; missing → idle
//   dir/<state>/{start,loop}.mp4   intro + loop; sets loop_from = intro length
//
// Requires chafa on PATH; ffmpeg only for video/gif input.

import { spawnSync } from "node:child_process"
import { existsSync, statSync, readdirSync, mkdtempSync, rmSync } from "node:fs"
import { join, basename, extname } from "node:path"
import { tmpdir } from "node:os"
import { type Doc, type StateDecl } from "./ui/format"
import { STATES } from "./ui/spec"
import { defaultSignalMappings, type LaunchStreamRecord } from "./contract/shape"
import { serializeLaunchStream } from "./stream"

export const SYMBOLS = ["block", "ascii", "braille", "sextant", "all"] as const
export const COLORS = ["none", "16", "256", "full"] as const
export const DITHER = ["none", "ordered", "diffusion"] as const

export type Knobs = {
  width: number; height: number; fps: number
  symbols: typeof SYMBOLS[number]
  colors: typeof COLORS[number]
  dither: typeof DITHER[number]
  invert: boolean
}

export const DEFAULTS: Knobs = {
  width: 48, height: 24, fps: 16,
  symbols: "block", colors: "none", dither: "none", invert: true,
}

const IMG = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"])
const VID = new Set([".mp4", ".mov", ".webm", ".mkv", ".gif"])

const STATE_COLOR: Record<string, string> = {
  idle: "#7aa2f7", listening: "#9ece6a", thinking: "#e0af68",
  speaking: "#bb9af7", working: "#ff9e64", error: "#f7768e",
}

export function which(bin: string): void {
  const r = spawnSync("which", [bin], { encoding: "utf8" })
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`'${bin}' not found on PATH`)
}

/** ffmpeg mp4/gif → N pngs at `fps` into a tmpdir. */
function extract(src: string, fps: number): { dir: string; pngs: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "eikon-"))
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", src,
    "-vf", `fps=${fps}`, "-q:v", "2", join(dir, "f_%04d.png"),
  ])
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${src}: ${r.stderr?.toString()}`)
  const pngs = readdirSync(dir).filter(f => f.endsWith(".png")).sort().map(f => join(dir, f))
  if (pngs.length === 0) throw new Error(`ffmpeg extracted 0 frames from ${src}`)
  return { dir, pngs }
}

// padEnd/slice by column is wrong when colors != none (SGR escapes
// have zero display width). Only normalize when output is pure text.
const pad = (line: string, w: number) =>
  line.includes("\x1b[") ? line : line.padEnd(w).slice(0, w)

/** chafa one image → exactly H rows of W columns, right-padded. */
function raster(img: string, k: Knobs): string {
  const r = spawnSync("chafa", [
    `--size=${k.width}x${k.height}`, "--format=symbols", "--stretch",
    `--symbols=${k.symbols}`, `--colors=${k.colors}`, `--dither=${k.dither}`,
    ...(k.invert ? ["--invert"] : []), img,
  ], { encoding: "utf8" })
  if (r.status !== 0) throw new Error(`chafa failed on ${img}: ${r.stderr}`)
  const rows = r.stdout.replace(/\n$/, "").split("\n")
  while (rows.length < k.height) rows.push("")
  return rows.slice(0, k.height).map(l => pad(l, k.width)).join("\n")
}

type Src = { start?: string; loop?: string; still?: string }
type Clip = { frames: string[]; loopFrom: number }

/** Discover per-state sources from a directory. Flat files and
 *  `<state>/{start,loop}.mp4` subdirs both work. */
function discover(dir: string): Map<string, Src> {
  const out = new Map<string, Src>()
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name)
    if (e.isDirectory()) {
      const start = existsSync(join(p, "start.mp4")) ? join(p, "start.mp4") : undefined
      const loop = existsSync(join(p, "loop.mp4")) ? join(p, "loop.mp4") : undefined
      if (start || loop) out.set(e.name, { start, loop })
      continue
    }
    const ext = extname(e.name).toLowerCase()
    const stem = basename(e.name, ext).toLowerCase()
    if (VID.has(ext)) out.set(stem, { loop: p })
    else if (IMG.has(ext)) out.set(stem, { still: p })
  }
  return out
}

function render(s: Src, k: Knobs, tmps: string[]): Clip {
  if (s.still) return { frames: [raster(s.still, k)], loopFrom: 1 }
  const pull = (v?: string) => {
    if (!v) return []
    const { dir, pngs } = extract(v, k.fps)
    tmps.push(dir)
    return pngs.map(p => raster(p, k))
  }
  const intro = pull(s.start), loop = pull(s.loop)
  const frames = [...intro, ...loop]
  // start only → play once, hold; loop only → loop all; both → intro then loop
  return { frames, loopFrom: s.loop ? intro.length : frames.length }
}

export type Opts = {
  name?: string; author?: string; glyph?: string
  width?: number; height?: number; fps?: number
  symbols?: Knobs["symbols"]; colors?: Knobs["colors"]; invert?: boolean
}

export function pack(src: string, opts: Opts = {}): { doc: Doc; text: string } {
  which("chafa")
  if (!existsSync(src)) throw new Error(`not found: ${src}`)
  const k: Knobs = {
    ...DEFAULTS,
    ...(opts.width != null && { width: opts.width }),
    ...(opts.height != null && { height: opts.height }),
    ...(opts.fps != null && { fps: opts.fps }),
    ...(opts.symbols && { symbols: opts.symbols }),
    ...(opts.colors && { colors: opts.colors }),
    ...(opts.invert != null && { invert: opts.invert }),
  }
  const tmps: string[] = []

  const st = statSync(src)
  const ext = extname(src).toLowerCase()
  if (!st.isDirectory() && !IMG.has(ext) && !VID.has(ext))
    throw new Error(`unsupported input: ${src} (want ${[...IMG, ...VID].join(" ")} or dir)`)
  const found = st.isDirectory() ? discover(src)
    : new Map([["idle", IMG.has(ext) ? { still: src } : { loop: src }]])
  const idle = found.get("idle") ?? found.values().next().value
  if (!idle) throw new Error(`no usable media in ${src}`)

  // Render each distinct Src once, then fan to states.
  const key = (s: Src) => `${s.still ?? ""}|${s.start ?? ""}|${s.loop ?? ""}`
  const cache = new Map<string, Clip>()
  const of = (s: Src) => {
    const k2 = key(s)
    let c = cache.get(k2)
    if (!c) { c = render(s, k, tmps); cache.set(k2, c) }
    return c
  }

  const states: StateDecl[] = STATES.map(s => {
    const c = of(found.get(s) ?? idle)
    return {
      state: s, fps: k.fps, color: STATE_COLOR[s],
      frame_count: c.frames.length, loop_from: c.loopFrom,
      frames: c.frames.map((data, i) => ({ f: i, data })),
    }
  })

  for (const d of tmps) rmSync(d, { recursive: true, force: true })

  const name = (opts.name ?? basename(src, extname(src)))
    .toLowerCase().replace(/[^a-z0-9-]+/g, "-").replace(/^-+|-+$/g, "") || "eikon"
  const doc: Doc = {
    header: {
      eikon: 1, name, width: k.width, height: k.height,
      author: opts.author ?? process.env.USER ?? "unknown",
      glyph: opts.glyph ?? "◆",
      created: new Date().toISOString(),
    },
    states,
  }
  const records: LaunchStreamRecord[] = [
    {
      type: "header",
      eikon: 1,
      title: name,
      author: { name: doc.header.author },
      size: { cols: k.width, rows: k.height },
      defaultSignal: "state.idle",
      signals: defaultSignalMappings(),
    },
    ...states.flatMap(state => [
      {
        type: "clip" as const,
        name: state.state,
        fps: state.fps,
        frameCount: state.frame_count,
        loopFrom: state.loop_from,
        color: state.color,
      },
      ...state.frames.map(frame => ({
        type: "frame" as const,
        clip: state.state,
        index: frame.f,
        rows: frame.data.split("\n"),
        ...(frame.pause != null ? { pause: frame.pause } : {}),
        ...(frame.color ? { color: frame.color } : {}),
      })),
    ]),
  ]
  return { doc, text: serializeLaunchStream(records) }
}
