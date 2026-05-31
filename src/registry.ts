// Registry maintenance — `eikon index` / `eikon manifest`. Run by CI
// on push to main; runnable locally from the repo root.

import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { STATES, DEFAULT_CATALOG } from "./ui/spec"
import { parse, poster } from "./ui/eikon"
import { catalogEntry, type CatalogIndexEntry } from "./catalog"

const root = () => {
  let d = import.meta.dir
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  return join(d, "eikons")
}

export async function index(base = DEFAULT_CATALOG) {
  const dir = root()
  const out: CatalogIndexEntry[] = []
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
    const entry = catalogEntry({
      name: doc.meta.name,
      author: doc.meta.author,
      glyph: doc.meta.glyph,
      w: doc.meta.width,
      h: doc.meta.height,
      description: typeof doc.meta.description === "string" ? doc.meta.description : undefined,
      license: typeof doc.meta.license === "string" ? doc.meta.license : undefined,
      provenance: typeof doc.meta.provenance === "string" ? doc.meta.provenance : undefined,
      review_status: typeof doc.meta.review_status === "string" ? doc.meta.review_status : undefined,
      source_url: head.source_url,
      preview_url: `${e.name}/${e.name}.eikon`,
      install_url: src,
      ...(src ? { source: src } : {}),
      poster: poster(doc),
    }, base)
    out.push({
      name: entry.name,
      ...(entry.author ? { author: entry.author } : {}),
      ...(entry.glyph ? { glyph: entry.glyph } : {}),
      w: entry.width,
      h: entry.height,
      ...(entry.description ? { description: entry.description } : {}),
      ...(entry.trust.license ? { license: entry.trust.license } : {}),
      ...(entry.trust.provenance ? { provenance: entry.trust.provenance } : {}),
      ...(entry.trust.reviewStatus ? { review_status: entry.trust.reviewStatus } : {}),
      source_url: head.source_url,
      preview_url: entry.previewUrl,
      install_url: entry.installUrl,
      ...(src ? { source: src } : {}),
      poster: entry.poster,
    })
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  await Bun.write(join(dir, "index.json"), JSON.stringify(out, null, 2) + "\n")
  return out.length
}

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
