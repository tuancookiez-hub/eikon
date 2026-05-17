import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, cpSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { spawnSync } from "node:child_process"
import { pack } from "../src/pack"
import { parse, STATES } from "../src/ui/eikon"
import { lint } from "../src/ui/lint"

const have = (bin: string) => spawnSync("which", [bin]).status === 0
const skip = !have("chafa") || !have("ffmpeg")

const tmp = mkdtempSync(join(tmpdir(), "eikon-pack-"))

// Valid 8x8 gray PNG via ffmpeg (already a skipIf dep).
const PNG_FIX = join(tmp, "_fix.png")
if (!skip)
  spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=gray:s=8x8:d=1:r=1", "-frames:v", "1", "-y", PNG_FIX])

function png(p: string) { cpSync(PNG_FIX, p) }

test.skipIf(skip)("pack: single image → 6 identical 1-frame states, lint-clean", () => {
  const src = join(tmp, "face.png"); png(src)
  const { doc, text } = pack(src, { name: "face", author: "t", glyph: "◆" })
  expect(doc.states.length).toBe(6)
  expect(doc.states.every(s => s.frame_count === 1)).toBe(true)
  const e = lint(text)
  expect(e.meta.name).toBe("face")
  expect([...e.clips.keys()].sort()).toEqual([...STATES].sort())
  // all states share the same single frame
  const f0 = doc.states[0]!.frames[0]!.data
  expect(doc.states.every(s => s.frames[0]!.data === f0)).toBe(true)
  expect(f0.split("\n").length).toBe(doc.header.height)
})

test.skipIf(skip)("pack: gif → multi-frame loop fanned to all states", () => {
  const gif = join(tmp, "spin.gif")
  // 8 frames of shifting grayscale via ffmpeg lavfi
  const r = spawnSync("ffmpeg", ["-hide_banner", "-loglevel", "error",
    "-f", "lavfi", "-i", "color=c=gray:s=64x64:d=1:r=8",
    "-vf", "hue=h=t*45", "-y", gif])
  expect(r.status).toBe(0)
  const { doc, text } = pack(gif, { name: "spin", author: "t", fps: 8 })
  expect(doc.states[0]!.frame_count).toBeGreaterThan(1)
  expect(doc.states.every(s => s.frame_count === doc.states[0]!.frame_count)).toBe(true)
  expect(doc.states.every(s => s.loop_from === 0)).toBe(true)
  lint(text)
})

test.skipIf(skip)("pack: dir with per-state images, missing states fall back to idle", () => {
  const dir = join(tmp, "mix"); mkdirSync(dir)
  png(join(dir, "idle.png"))
  png(join(dir, "error.png"))
  // thinking has no file — should fall back to idle's frame
  const { doc, text } = pack(dir, { name: "mix", author: "t" })
  expect(doc.states.length).toBe(6)
  lint(text)
  // distinct-source render: idle and error rendered once each (same bytes here,
  // but the map should have at most 2 entries' worth of work — can't observe
  // directly, so just assert correctness).
  expect(doc.states.find(s => s.state === "thinking")!.frames[0]!.data)
    .toBe(doc.states.find(s => s.state === "idle")!.frames[0]!.data)
})

test.skipIf(skip)("pack: name sanitized, rejects unsupported ext", () => {
  const src = join(tmp, "My Cat!.png"); png(src)
  const { doc } = pack(src, { author: "t" })
  expect(doc.header.name).toBe("my-cat")
  const bad = join(tmp, "nope.txt"); cpSync(PNG_FIX, bad)
  expect(() => pack(bad)).toThrow()
})

test.skipIf(skip)("pack: <state>/{start,loop}.mp4 → loop_from = intro length", () => {
  const dir = join(tmp, "sl"); mkdirSync(join(dir, "idle"), { recursive: true })
  const vid = (p: string, frames: number) => spawnSync("ffmpeg", ["-hide_banner",
    "-loglevel", "error", "-f", "lavfi", "-i", `color=c=gray:s=32x32:d=${frames / 8}:r=8`,
    "-y", p])
  vid(join(dir, "idle", "start.mp4"), 4)
  vid(join(dir, "idle", "loop.mp4"), 8)
  mkdirSync(join(dir, "error")); vid(join(dir, "error", "start.mp4"), 3)
  const { doc } = pack(dir, { name: "sl", author: "t", fps: 8 })
  const idle = doc.states.find(s => s.state === "idle")!
  // intro (4) + loop (8) → 12 frames, loop_from = 4
  expect(idle.frame_count).toBe(12)
  expect(idle.loop_from).toBe(4)
  // start-only → play-once-hold (loop_from == frame_count)
  const err = doc.states.find(s => s.state === "error")!
  expect(err.loop_from).toBe(err.frame_count)
  // thinking falls back to idle
  expect(doc.states.find(s => s.state === "thinking")!.loop_from).toBe(4)
})
