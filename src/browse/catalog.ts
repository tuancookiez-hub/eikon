// Catalog = where .eikon entries come from. list() returns index entries
// (cheap, poster included); load() returns the full file body for preview
// and install. Local reads a directory; remote fetches index.json + files.

import { list as scan, parse, poster, type Meta } from "../ui/eikon"
import { dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { CATALOG_KIND, CATALOG_SCHEMA_VERSION, type CatalogEntry } from "../contract/shape"
import { loadCatalog, validateCatalogEntry } from "../catalog"

export type Entry = CatalogEntry

export type Catalog = {
  list: () => Promise<Entry[]>
  load: (name: string) => Promise<string>
}

const toEntry = (meta: Meta, p: string, path: string): Entry => {
  const runtimeUrl = pathToFileURL(path).href
  const packageUrl = new URL("manifest.json", pathToFileURL(`${dirname(path)}/`)).href
  return validateCatalogEntry({
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: meta.name,
    sourceKey: runtimeUrl,
    name: meta.name,
    title: typeof meta.title === "string" ? meta.title : meta.name,
    author: meta.author,
    glyph: meta.glyph,
    poster: p,
    preview: runtimeUrl,
    runtimeUrl,
    packageUrl,
    compatibility: { eikon: ">=1 <2", available: true },
  })
}

export function local(dir: string): Catalog {
  const found = scan([dir])
  const paths = new Map(found.map(f => [f.meta.name, f.path]))
  return {
    async list() {
      const out: Entry[] = []
      for (const f of found) {
        const raw = await Bun.file(f.path).text()
        out.push(toEntry(f.meta, poster(parse(raw)), f.path))
      }
      return out
    },
    async load(name) {
      const p = paths.get(name)
      if (!p) throw new Error(`catalog: unknown eikon "${name}"`)
      return Bun.file(p).text()
    },
  }
}

export function remote(base: string): Catalog {
  return {
    async list() {
      return (await loadCatalog(base, fetch, { allowPrivate: true })).entries
    },
    async load(name) {
      return (await loadCatalog(base, fetch, { allowPrivate: true })).load(name)
    },
  }
}

/** Catalog from $EIKON_URL — http(s) → remote, otherwise local dir. */
export function resolve(fallback: string): Catalog {
  const src = process.env.EIKON_URL ?? fallback
  return /^https?:/.test(src) ? remote(src) : local(src)
}
