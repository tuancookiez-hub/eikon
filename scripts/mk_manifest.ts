#!/usr/bin/env bun
// Emit a herm-compatible manifest.json for each avatar dir. Shape:
//   { source: "<base>.png", states: { <state>: { file: "states/<state>/<pick>.mp4" } } }
// Picks loop.mp4 over start.mp4 when both exist. Base image resolves
// from faces/<name>-512.png when no local png is present.
import { readdirSync, existsSync, writeFileSync, copyFileSync } from "node:fs"
import { join } from "node:path"

const root = join(import.meta.dir, "..", "avatars")
const faces = join(import.meta.dir, "..", "faces")
const STATES = ["idle", "listening", "thinking", "speaking", "working", "error"]

for (const name of readdirSync(root, { withFileTypes: true }).filter(d => d.isDirectory()).map(d => d.name)) {
  const dir = join(root, name)
  const sdir = join(dir, "states")
  if (!existsSync(sdir)) continue
  const states: Record<string, { file: string }> = {}
  for (const st of STATES) {
    const pick = ["loop.mp4", "start.mp4"].find(f => existsSync(join(sdir, st, f)))
    if (pick) states[st] = { file: `states/${st}/${pick}` }
  }
  let source: string | undefined
  const face = join(faces, `${name}-512.png`)
  const local = readdirSync(dir).find(f => /\.(png|jpe?g|webp)$/i.test(f))
  if (local) source = local
  else if (existsSync(face)) { copyFileSync(face, join(dir, "base.png")); source = "base.png" }
  writeFileSync(join(dir, "manifest.json"),
    JSON.stringify({ name, version: 1, ...(source ? { source } : {}), states }, null, 2) + "\n")
  console.log(`${name}: ${Object.keys(states).length} states${source ? ` + ${source}` : ""}`)
}
