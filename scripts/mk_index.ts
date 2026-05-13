#!/usr/bin/env bun
// Regenerate catalog/index.json from catalog/*.eikon. Each entry carries
// header fields + idle frame 0 (poster) so the Browser can draw the grid
// without fetching bodies.

import { resolve } from "node:path"
import { list, parse, poster } from "../src/ui/eikon"

const dir = resolve(import.meta.dir, "../catalog")
const out = resolve(dir, "index.json")

const entries = []
for (const f of list([dir])) {
  const e = parse(await Bun.file(f.path).text())
  entries.push({
    name: e.meta.name,
    author: e.meta.author,
    glyph: e.meta.glyph,
    w: e.meta.width,
    h: e.meta.height,
    poster: poster(e),
  })
}
entries.sort((a, b) => a.name.localeCompare(b.name))

await Bun.write(out, JSON.stringify(entries, null, 2) + "\n")
console.log(`wrote ${entries.length} entries → ${out}`)
