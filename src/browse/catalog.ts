// Catalog = where .eikon entries come from. list() returns index entries
// (cheap, poster included); load() returns the full file body for preview
// and install. Local reads a directory; remote fetches index.json + files.

import { list as scan, parse, poster, type Meta } from "../ui/eikon"

export type Entry = {
  name: string
  author?: string
  glyph?: string
  w: number
  h: number
  poster: string
}

export type Catalog = {
  list: () => Promise<Entry[]>
  load: (name: string) => Promise<string>
}

const toEntry = (meta: Meta, p: string): Entry => ({
  name: meta.name, author: meta.author, glyph: meta.glyph,
  w: meta.width, h: meta.height, poster: p,
})

export function local(dir: string): Catalog {
  const found = scan([dir])
  const paths = new Map(found.map(f => [f.meta.name, f.path]))
  return {
    async list() {
      const out: Entry[] = []
      for (const f of found) {
        const raw = await Bun.file(f.path).text()
        out.push(toEntry(f.meta, poster(parse(raw))))
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
  const url = base.replace(/\/$/, "")
  return {
    list: () => fetch(`${url}/index.json`).then(r => r.json() as Promise<Entry[]>),
    load: (name) => fetch(`${url}/${name}/${name}.eikon`).then(r => r.text()),
  }
}

/** Catalog from $EIKON_URL — http(s) → remote, otherwise local dir. */
export function resolve(fallback: string): Catalog {
  const src = process.env.EIKON_URL ?? fallback
  return /^https?:/.test(src) ? remote(src) : local(src)
}
