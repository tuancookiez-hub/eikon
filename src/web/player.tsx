/** @jsxImportSource react */
import type { CatalogEntry } from "../catalog"
import { loadCatalog, publicCatalogUrl, searchCatalog, type Catalog } from "../catalog"
import { parse, type Eikon } from "../ui/eikon"

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; entry: CatalogEntry }
  | { status: "ready"; entry: CatalogEntry; raw: string; eikon: Eikon }
  | { status: "error"; entry?: CatalogEntry; error: string }

export type WebState = {
  status: "idle" | "loading" | "ready" | "error"
  entries: CatalogEntry[]
  query: string
  selectedKey?: string
  error?: string
  preview: PreviewState
}

export type WebPolicy = {
  maxBytes: number
  timeoutMs: number
  concurrency: number
  cacheEntries: number
}

export type WebCatalogOptions = Partial<WebPolicy> & {
  base?: string
  fetch?: typeof fetch
  loadCatalog?: (base?: string, fetcher?: typeof fetch) => Promise<Catalog>
}

const defaults: WebPolicy = { maxBytes: 1_000_000, timeoutMs: 8_000, concurrency: 3, cacheEntries: 24 }
const dangerous = /\b(publish|auth|login|token)\b|\buse\s+/i

export function AsciiPreview(props: { lines: string[] }) {
  return <pre className="ascii" aria-label="Eikon ASCII preview">{props.lines.join("\n")}</pre>
}

export function EntryCard(props: { entry: CatalogEntry; selected: boolean; onPick: () => void }) {
  return (
    <button type="button" className={props.selected ? "card selected" : "card"} onClick={props.onPick}>
      <pre aria-hidden="true">{props.entry.poster}</pre>
      <span className="name">{props.entry.glyph ?? "⬡"} {props.entry.name}</span>
      <span className="meta">{props.entry.author ?? "unknown"} · {props.entry.width}×{props.entry.height}</span>
    </button>
  )
}

export function previewError(preview: PreviewState): string | undefined {
  return preview.status === "error" ? preview.error : undefined
}

export function safePublicUrl(raw: string): string {
  try {
    const url = publicCatalogUrl(raw)
    if (!/^https?:/.test(url)) throw new Error("unsafe browser URL")
    return url
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    throw new Error(`unsafe browser URL: ${msg}`)
  }
}

export function safeHermUrl(entry: CatalogEntry): string {
  const url = safePublicUrl(entry.installUrl || entry.previewUrl)
  return `herm://eikon/detail?url=${encodeURIComponent(url)}`
}

export function browserInstructions(entry: CatalogEntry) {
  const install = safePublicUrl(entry.installUrl || entry.previewUrl)
  const preview = safePublicUrl(entry.previewUrl)
  const command = `eikon install ${install}`
  if (dangerous.test(command)) throw new Error("unsafe install instructions")
  return {
    command,
    manual: `Download ${preview}, then open Herm's Eikon gallery and install from URL or file.`,
    hermUrl: safeHermUrl(entry),
  }
}

class Limiter {
  active = 0
  q: (() => void)[] = []
  constructor(readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>(resolve => this.q.push(resolve))
    this.active++
    try { return await fn() }
    finally {
      this.active--
      this.q.shift()?.()
    }
  }
}

export function createWebCatalog(opts: WebCatalogOptions = {}) {
  const policy = { ...defaults, ...opts }
  const fetcher = opts.fetch ?? fetch
  const loader = opts.loadCatalog ?? ((base?: string, f?: typeof fetch) => loadCatalog(base, f))
  const limit = new Limiter(policy.concurrency)
  const cache = new Map<string, string>()
  let cat: Catalog | undefined
  const state: WebState = { status: "idle", entries: [], query: "", preview: { status: "idle" } }

  const put = (key: string, val: string) => {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, val)
    while (cache.size > policy.cacheEntries) cache.delete(cache.keys().next().value!)
  }

  const fetchText = async (url: string, signal?: AbortSignal) => {
    const safe = safePublicUrl(url)
    const hit = cache.get(safe)
    if (hit !== undefined) return hit
    return limit.run(async () => {
      const ctrl = new AbortController()
      const timer = setTimeout(() => ctrl.abort(), policy.timeoutMs)
      signal?.addEventListener("abort", () => ctrl.abort(), { once: true })
      try {
        const res = await fetcher(safe, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`web catalog: HTTP ${res.status}`)
        const text = await res.text()
        if (new TextEncoder().encode(text).byteLength > policy.maxBytes) throw new Error("web catalog: size limit exceeded")
        put(safe, text)
        return text
      } finally {
        clearTimeout(timer)
      }
    })
  }

  const api = {
    state,
    policy: () => ({ maxBytes: policy.maxBytes, timeoutMs: policy.timeoutMs, concurrency: policy.concurrency, cacheEntries: policy.cacheEntries }),
    async refresh() {
      state.status = "loading"
      state.error = undefined
      try {
        cat = await loader(opts.base, fetcher)
        state.entries = cat.entries
        state.status = "ready"
      } catch (err) {
        state.status = "error"
        state.error = err instanceof Error ? err.message : String(err)
      }
    },
    search(query: string) {
      state.query = query
      const xs = searchCatalog(state.entries, query)
      if (!xs.some(e => e.identityKey === state.selectedKey)) state.selectedKey = undefined
      return xs
    },
    select(key: string) { state.selectedKey = key },
    selected() { return state.entries.find(e => e.identityKey === state.selectedKey) },
    actions() {
      if (state.status === "error") return ["retry"]
      if (state.preview.status === "error") return ["copy-instructions", "open-herm-detail", "retry-preview"]
      return ["copy-instructions", "open-herm-detail"]
    },
    fetchText,
    async preview(key: string, signal?: AbortSignal): Promise<PreviewState> {
      const entry = state.entries.find(e => e.identityKey === key)
      if (!entry) return { status: "error", error: "unknown entry" }
      state.selectedKey = key
      state.preview = { status: "loading", entry }
      try {
        const raw = await fetchText(entry.previewUrl, signal)
        const eikon = parse(raw)
        state.preview = { status: "ready", entry, raw, eikon }
      } catch (err) {
        state.preview = { status: "error", entry, error: err instanceof Error ? err.message : String(err) }
      }
      return state.preview
    },
  }
  return api
}
