// Catalog = where .eikon entries come from. list() returns index entries
// (cheap, poster included); load() returns the full file body for preview
// and install. Local reads a directory; remote fetches index.json + files.

import { list as scan, parse, poster, decode, type Meta } from "../ui/eikon"
import { dirname } from "node:path"
import { pathToFileURL } from "node:url"
import { CATALOG_KIND, CATALOG_SCHEMA_VERSION, type CatalogEntry } from "../contract/shape"
import { loadCatalog, loadRuntimeArtifact, validateCatalogEntry } from "../catalog"

export type Entry = CatalogEntry

export type Catalog = {
  list: () => Promise<Entry[]>
  load: (name: string) => Promise<string>
  loadBytes?: (name: string) => Promise<Uint8Array>
  loadArtifact?: (name: string) => Promise<{ raw: string; bytes: Uint8Array }>
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
        const raw = decode(f.path)
        out.push(toEntry(f.meta, poster(parse(raw)), f.path))
      }
      return out
    },
    async load(name) {
      const p = paths.get(name)
      if (!p) throw new Error(`catalog: unknown eikon "${name}"`)
      return decode(p)
    },
    async loadBytes(name) {
      const p = paths.get(name)
      if (!p) throw new Error(`catalog: unknown eikon "${name}"`)
      return new Uint8Array(await Bun.file(p).arrayBuffer())
    },
    async loadArtifact(name) {
      const p = paths.get(name)
      if (!p) throw new Error(`catalog: unknown eikon "${name}"`)
      const bytes = new Uint8Array(await Bun.file(p).arrayBuffer())
      return { raw: decode(p), bytes }
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
    async loadBytes(name) {
      const cat = await loadCatalog(base, fetch, { allowPrivate: true })
      const entry = cat.entries.find(e => e.name === name || e.id === name || e.sourceKey === name)
      if (!entry) throw new Error(`catalog: unknown eikon "${name}"`)
      return (await loadRuntimeArtifact(entry, fetch)).bytes
    },
    async loadArtifact(name) {
      const cat = await loadCatalog(base, fetch, { allowPrivate: true })
      const entry = cat.entries.find(e => e.name === name || e.id === name || e.sourceKey === name)
      if (!entry) throw new Error(`catalog: unknown eikon "${name}"`)
      const out = await loadRuntimeArtifact(entry, fetch)
      return { raw: out.text, bytes: out.bytes }
    },
  }
}

/** Catalog from $EIKON_URL — http(s) → remote, otherwise local dir. */
export function resolve(fallback: string): Catalog {
  const src = process.env.EIKON_URL ?? fallback
  return /^https?:/.test(src) ? remote(src) : local(src)
}
