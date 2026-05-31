// Catalog = where .eikon entries come from. list() returns index entries
// (cheap, poster included); load() returns the full file body for preview
// and install. Local reads a directory; remote fetches index.json + files.

import { list as scan, parse, poster, type Meta } from "../ui/eikon"
import { loadCatalog, entryFromMeta, type CatalogEntry } from "../catalog"

export type Entry = CatalogEntry

export type Catalog = {
  list: () => Promise<Entry[]>
  load: (name: string) => Promise<string>
}

const toEntry = (meta: Meta, p: string, base: string): Entry => entryFromMeta(meta, p, base, { allowPrivate: true })

export function local(dir: string): Catalog {
  const found = scan([dir])
  const paths = new Map(found.map(f => [f.meta.name, f.path]))
  return {
    async list() {
      const out: Entry[] = []
      for (const f of found) {
        const raw = await Bun.file(f.path).text()
        out.push(toEntry(f.meta, poster(parse(raw)), `file://${f.path}`))
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
