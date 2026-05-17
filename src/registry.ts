// Registry maintenance — `eikon index` / `eikon manifest`. Run by CI
// on push to main; runnable locally from the repo root.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { STATES, DEFAULT_CATALOG } from "./ui/spec"
import { parse, poster } from "./ui/eikon"

const root = () => {
  let d = import.meta.dir
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  return join(d, "eikons")
}

/** Regenerate eikons/index.json from eikons/<name>/<name>.eikon and
 *  re-stamp each header's `source_url` to point at its own dir under
 *  `base` (default: DEFAULT_CATALOG). An entry with `manifest.json`
 *  gets `source: "<name>/"` so install() knows media exists. */
export async function index(base = DEFAULT_CATALOG) {
  const dir = root()
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const path = join(dir, e.name, `${e.name}.eikon`)
    if (!existsSync(path)) continue
    const body = readFileSync(path, "utf8")
    const doc = parse(body)
    const src = existsSync(join(dir, e.name, "manifest.json")) ? `${e.name}/` : undefined
    const nl = body.indexOf("\n")
    const head = { ...JSON.parse(body.slice(0, nl)),
                   source_url: `${base.replace(/\/?$/, "/")}${e.name}/` }
    writeFileSync(path, JSON.stringify(head) + body.slice(nl))
    out.push({
      name: doc.meta.name, author: doc.meta.author, glyph: doc.meta.glyph,
      w: doc.meta.width, h: doc.meta.height,
      ...(src ? { source: src } : {}), poster: poster(doc),
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  await Bun.write(join(dir, "index.json"), JSON.stringify(out, null, 2) + "\n")
  return out.length
}

/** Emit eikons/<name>/manifest.json for every dir with a states/ tree.
 *  Prefers loop.mp4 over start.mp4. */
export function manifest() {
  const dir = root()
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const d = join(dir, e.name), sd = join(d, "states")
    if (!existsSync(sd)) continue
    const states: Record<string, { file: string }> = {}
    for (const st of STATES) {
      const pick = ["loop.mp4", "start.mp4"].find(f => existsSync(join(sd, st, f)))
      if (pick) states[st] = { file: `states/${st}/${pick}` }
    }
    const base = readdirSync(d).find(f => /\.(png|jpe?g|webp)$/i.test(f))
    writeFileSync(join(d, "manifest.json"),
      JSON.stringify({ name: e.name, version: 1, ...(base ? { source: base } : {}), states }, null, 2) + "\n")
    n++
  }
  return n
}
