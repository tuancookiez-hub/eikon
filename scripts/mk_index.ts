#!/usr/bin/env bun
// Regenerate catalog/index.json from catalog/*.eikon + avatars/*/manifest.json.
// Each entry carries header fields + idle frame 0 (poster) so Browser can draw
// the grid without fetching bodies. When avatars/<name>/manifest.json exists,
// the entry gets `source: "avatars/<name>/"` and the catalog .eikon header is
// re-stamped with `source_url: <RAW>/avatars/<name>/` so every consumer —
// herm bundled, `eikon add`, catalog fetch — learns where the media lives.

import { resolve, join } from "node:path"
import { existsSync, readFileSync, writeFileSync } from "node:fs"
import { list, parse, poster } from "../src/ui/eikon"

const root = resolve(import.meta.dir, "..")
const dir = join(root, "catalog")
const RAW = process.env.EIKON_RAW
  ?? "https://raw.githubusercontent.com/liftaris/eikon/main"

const entries = []
for (const f of list([dir])) {
  const e = parse(readFileSync(f.path, "utf8"))
  const src = existsSync(join(root, "avatars", e.meta.name, "manifest.json"))
    ? `avatars/${e.meta.name}/` : undefined
  if (src) {
    const raw = readFileSync(f.path, "utf8")
    const nl = raw.indexOf("\n")
    const head = { ...JSON.parse(raw.slice(0, nl)), source_url: `${RAW}/${src}` }
    writeFileSync(f.path, JSON.stringify(head) + raw.slice(nl))
  }
  entries.push({
    name: e.meta.name, author: e.meta.author, glyph: e.meta.glyph,
    w: e.meta.width, h: e.meta.height,
    ...(src ? { source: src } : {}),
    poster: poster(e),
  })
}
entries.sort((a, b) => a.name.localeCompare(b.name))

await Bun.write(join(dir, "index.json"), JSON.stringify(entries, null, 2) + "\n")
console.log(`wrote ${entries.length} entries → catalog/index.json`)
