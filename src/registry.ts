import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { DEFAULT_CATALOG } from "./ui/spec"
import { parse, poster } from "./ui/eikon"
import { migrateLegacyEikon } from "./stream/legacy"
import { normalizeCatalogEntry, validateCatalogEntry } from "./catalog"

const root = () => {
  let d = import.meta.dir
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  return join(d, "eikons")
}

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
    const head = { ...JSON.parse(body.slice(0, nl)), source_url: `${base.replace(/\/?$/, "/")}${e.name}/` }
    writeFileSync(path, JSON.stringify(head) + body.slice(nl))
    const entry = normalizeCatalogEntry({
      name: doc.meta.name,
      author: doc.meta.author,
      glyph: doc.meta.glyph,
      ...(src ? { source: src } : {}),
      poster: poster(doc),
    }, base)
    out.push(validateCatalogEntry(entry))
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
    const d = join(dir, e.name)
    const packed = join(d, `${e.name}.eikon`)
    if (existsSync(packed)) {
      const migrated = migrateLegacyEikon(readFileSync(packed, "utf8"), { id: e.name, entrypoint: `${e.name}.eikonl` })
      writeFileSync(join(d, `${e.name}.eikonl`), migrated.stream)
      writeFileSync(join(d, "manifest.json"), JSON.stringify(migrated.manifest, null, 2) + "\n")
      n++
    }
  }
  return n
}
