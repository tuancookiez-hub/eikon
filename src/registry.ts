// Registry maintenance — `eikon index` / `eikon manifest`. Run by CI
// on push to main; runnable locally from the repo root.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { STATES, DEFAULT_CATALOG } from "./ui/spec"
import { parse, poster, type Eikon } from "./ui/eikon"
import { lintManifest, lintRegistry, PUBLIC_LIMITS } from "./ui/lint"

const root = () => {
  let d = process.cwd()
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  if (existsSync(join(d, "eikons", "index.json"))) return join(d, "eikons")
  d = import.meta.dir
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  return join(d, "eikons")
}

const catalog = (base: string, name: string) => `${base.replace(/\/?$/, "/")}${name}/`

function entry(doc: Eikon, source?: string) {
  return {
    name: doc.meta.name,
    author: doc.meta.author,
    glyph: doc.meta.glyph,
    w: doc.meta.width,
    h: doc.meta.height,
    ...(typeof doc.meta.license === "string" ? { license: doc.meta.license } : {}),
    ...(typeof doc.meta.description === "string" ? { description: doc.meta.description } : {}),
    ...(typeof doc.meta.homepage_url === "string" ? { homepage_url: doc.meta.homepage_url } : {}),
    ...(typeof doc.meta.repository_url === "string" ? { repository_url: doc.meta.repository_url } : {}),
    ...(Array.isArray(doc.meta.tags) ? { tags: [...doc.meta.tags].map(String).sort() } : {}),
    ...(source ? { source } : {}),
    ...(typeof doc.meta.source_url === "string" ? { source_url: doc.meta.source_url } : {}),
    poster: poster(doc),
  }
}

/** Regenerate eikons/index.json from eikons/<name>/<name>.eikon and
 *  re-stamp each header's `source_url` to point at its own dir under
 *  `base` (default: DEFAULT_CATALOG). An entry with `manifest.json`
 *  gets `source: "<name>/"` so install() knows media exists. */
export async function index(base = DEFAULT_CATALOG) {
  const dir = root()
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
    if (!e.isDirectory()) continue
    const path = join(dir, e.name, `${e.name}.eikon`)
    if (!existsSync(path)) continue
    const body = readFileSync(path, "utf8")
    const source_url = catalog(base, e.name)
    const nl = body.indexOf("\n")
    const head = { ...JSON.parse(body.slice(0, nl)), source_url }
    const text = JSON.stringify(head) + body.slice(nl)
    const doc = process.env.EIKON_REGISTRY ? lintRegistry(text) : parse(text)
    const src = existsSync(join(dir, e.name, "manifest.json")) ? `${e.name}/` : undefined
    if (src && process.env.EIKON_REGISTRY) lintManifest(join(dir, e.name, "manifest.json"), readFileSync(join(dir, e.name, "manifest.json"), "utf8"), true)
    writeFileSync(path, text)
    out.push(entry(doc, src))
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  const text = JSON.stringify(out, null, 2) + "\n"
  if (Buffer.byteLength(text) > PUBLIC_LIMITS.maxCatalogBytes) throw new Error(`index exceeds ${PUBLIC_LIMITS.maxCatalogBytes} bytes`)
  await Bun.write(join(dir, "index.json"), text)
  return out.length
}

/** Emit eikons/<name>/manifest.json for every dir with a states/ tree.
 *  Prefers loop.mp4 over start.mp4. */
export function manifest() {
  const dir = root()
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name))) {
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
