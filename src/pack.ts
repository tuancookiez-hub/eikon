// Quick-pack: image/video/gif → .eikon with minimal ceremony.
//
// Input forms (first match wins):
//   file.{png,jpg,jpeg,webp}   1 frame → all 6 states (static avatar)
//   file.{mp4,mov,webm,gif}    N frames → idle loop; other states = idle
//   dir/                       per-state {idle,listening,...}.{ext} files;
//                              missing states fall back to idle
//
// This is the low-ceremony sibling of scripts/mk_eikon.ts (the artist
// pipeline, which wants a full start.mp4/loop.mp4 tree). If you have that
// tree, use mk_eikon instead.

import { existsSync, statSync, readdirSync } from "node:fs"
import { join, basename, extname } from "node:path"
import { rasterize, extract, which, DEFAULT_KNOBS, type Knobs } from "../scripts/lib"
import { serialize, type Doc, type StateDecl } from "./ui/format"
import { STATES } from "./ui/eikon"

const IMG = new Set([".png", ".jpg", ".jpeg", ".webp", ".bmp"])
const VID = new Set([".mp4", ".mov", ".webm", ".mkv", ".gif"])

const STATE_COLOR: Record<string, string> = {
  idle: "#7aa2f7", listening: "#9ece6a", thinking: "#e0af68",
  speaking: "#bb9af7", working: "#ff9e64", error: "#f7768e",
}

export type PackOpts = {
  name?: string
  author?: string
  glyph?: string
  width?: number
  height?: number
  fps?: number
  symbols?: Knobs["symbols"]
  colors?: Knobs["colors"]
  invert?: boolean
}

type Clip = { frames: string[]; loopFrom: number }

function clip(path: string, k: Knobs, tmps: string[]): Clip {
  const ext = extname(path).toLowerCase()
  if (IMG.has(ext)) return { frames: [rasterize(path, k)], loopFrom: 0 }
  if (VID.has(ext)) {
    const { dir, pngs } = extract(path, k.fps)
    tmps.push(dir)
    return { frames: pngs.map(p => rasterize(p, k)), loopFrom: 0 }
  }
  throw new Error(`unsupported input: ${path} (want ${[...IMG, ...VID].join(" ")})`)
}

/** Resolve per-state source files from a directory. idle is required; others fall back to it. */
function scan(dir: string): Map<string, string> {
  const files = readdirSync(dir).filter(f => IMG.has(extname(f).toLowerCase()) || VID.has(extname(f).toLowerCase()))
  const by = new Map(files.map(f => [basename(f, extname(f)).toLowerCase(), join(dir, f)]))
  const idle = by.get("idle") ?? (files[0] ? join(dir, files[0]) : undefined)
  if (!idle) throw new Error(`no usable images/videos in ${dir}`)
  return new Map(STATES.map(s => [s, by.get(s) ?? idle]))
}

export function pack(src: string, opts: PackOpts = {}): { doc: Doc; text: string } {
  which("chafa")
  if (!existsSync(src)) throw new Error(`not found: ${src}`)
  const k: Knobs = {
    ...DEFAULT_KNOBS,
    ...(opts.width != null && { width: opts.width }),
    ...(opts.height != null && { height: opts.height }),
    ...(opts.fps != null && { fps: opts.fps }),
    ...(opts.symbols && { symbols: opts.symbols }),
    ...(opts.colors && { colors: opts.colors }),
    ...(opts.invert != null && { invert: opts.invert }),
  }
  const tmps: string[] = []

  const st = statSync(src)
  const sources: Map<string, string> = st.isDirectory()
    ? scan(src)
    : new Map(STATES.map(s => [s, src]))

  // Render each distinct source once, then fan out.
  const rendered = new Map<string, Clip>()
  for (const p of new Set(sources.values()))
    rendered.set(p, clip(p, k, tmps))

  const states: StateDecl[] = STATES.map(s => {
    const c = rendered.get(sources.get(s)!)!
    return {
      state: s, fps: k.fps, color: STATE_COLOR[s],
      frame_count: c.frames.length, loop_from: c.loopFrom,
      frames: c.frames.map((data, i) => ({ f: i, data })),
    }
  })

  for (const d of tmps) Bun.spawnSync(["rm", "-rf", d])

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
  return { doc, text: serialize(doc) }
}
