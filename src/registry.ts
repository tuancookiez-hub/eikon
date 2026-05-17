// Registry maintenance — `eikon index` / `eikon manifest`. Run by CI
// on push to main; runnable locally from the repo root.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { STATES, DEFAULT_CATALOG } from "./ui/spec"
import { parse, list, poster } from "./ui/eikon"

const repo = () => {
  let d = import.meta.dir
  while (!existsSync(join(d, "catalog")) && dirname(d) !== d) d = dirname(d)
  return d
}

/** Regenerate catalog/index.json from catalog/*.eikon. When
 *  eikons/<name>/manifest.json exists, the entry gets `source` and the
 *  catalog header is re-stamped with `source_url` so every consumer
 *  (herm bundled, `eikon install`, catalog fetch) learns where the
 *  media lives. */
export async function index(raw = DEFAULT_CATALOG.replace(/\/catalog$/, "")) {
  const root = repo()
  const dir = join(root, "catalog")
  const out = []
  for (const f of list([dir])) {
    const e = parse(readFileSync(f.path, "utf8"))
    const src = existsSync(join(root, "eikons", e.meta.name, "manifest.json"))
      ? `eikons/${e.meta.name}/` : undefined
    if (src) {
      const body = readFileSync(f.path, "utf8")
      const nl = body.indexOf("\n")
      const head = { ...JSON.parse(body.slice(0, nl)), source_url: `${raw}/${src}` }
      writeFileSync(f.path, JSON.stringify(head) + body.slice(nl))
    }
    out.push({
      name: e.meta.name, author: e.meta.author, glyph: e.meta.glyph,
      w: e.meta.width, h: e.meta.height,
      ...(src ? { source: src } : {}), poster: poster(e),
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  await Bun.write(join(dir, "index.json"), JSON.stringify(out, null, 2) + "\n")
  return out.length
}

/** Emit eikons/<name>/manifest.json for every eikon dir from its
 *  states/ tree. Prefers loop.mp4 over start.mp4. */
export function manifest() {
  const root = join(repo(), "eikons")
  let n = 0
  for (const e of readdirSync(root, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const dir = join(root, e.name), sd = join(dir, "states")
    if (!existsSync(sd)) continue
    const states: Record<string, { file: string }> = {}
    for (const st of STATES) {
      const pick = ["loop.mp4", "start.mp4"].find(f => existsSync(join(sd, st, f)))
      if (pick) states[st] = { file: `states/${st}/${pick}` }
    }
    const base = readdirSync(dir).find(f => /\.(png|jpe?g|webp)$/i.test(f))
    writeFileSync(join(dir, "manifest.json"),
      JSON.stringify({ name: e.name, version: 1, ...(base ? { source: base } : {}), states }, null, 2) + "\n")
    n++
  }
  return n
}
