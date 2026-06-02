/** @jsxImportSource react */
import type { CatalogEntry } from "../contract/shape"
import { parseLaunchStream } from "../stream"
import { parse, type Clip, type Eikon } from "../ui/eikon"

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
  previews: Record<string, PreviewState>
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
  loadCatalog?: (base: string, fetcher?: typeof fetch) => Promise<CatalogEntry[]>
}

const defaults: WebPolicy = { maxBytes: 5_000_000, timeoutMs: 8_000, concurrency: 3, cacheEntries: 24 }
const blocked = /\b(publish|auth|login|token|activate|use)\b|herm:\/\//i
const keyFor = (entry: CatalogEntry) => entry.sourceKey || entry.id || entry.name
const previewFor = (entry: CatalogEntry) => entry.preview || entry.installUrl || entry.packageUrl

export function AsciiPreview(props: { lines: string[] }) {
  return <pre className="ascii" aria-label="Eikon ASCII preview"><span className="asciiArt">{props.lines.join("\n")}</span></pre>
}

export function EntryCard(props: { entry: CatalogEntry; selected: boolean; onPick: () => void }) {
  const title = props.entry.title || props.entry.name
  return (
    <button type="button" className={props.selected ? "card selected" : "card"} onClick={props.onPick}>
      <span className="cardPreview" aria-hidden="true">
        <span className="cardPoster">{props.entry.poster || ""}</span>
      </span>
      <span className="name">{props.entry.glyph ?? "⬡"} {title}</span>
      <span className="meta">{props.entry.author ?? "unknown"}</span>
    </button>
  )
}

export function parsePreview(text: string): Eikon {
  const first = text.split("\n", 1)[0]
  if (first?.includes('"type":"header"') || first?.includes('"type": "header"')) return parseLaunchStream(text)
  return parse(text)
}

export function stateClip(eikon: Eikon, state: string): Clip | undefined {
  return eikon.clips.get(state) ?? eikon.clips.get("idle") ?? eikon.clips.values().next().value
}

export function webPlaybackFrame(eikon: Eikon, state: string, tickMs: number, startedAtMs = 0): string[] {
  const clip = stateClip(eikon, state)
  const n = clip?.frames.length ?? 0
  if (!clip || n === 0) return []
  if (n === 1) return clip.frames[0] ?? []
  const fps = clip.fps > 0 ? clip.fps : 12
  const raw = Math.max(0, Math.floor(Math.max(0, tickMs - startedAtMs) / (1000 / fps)))
  if (raw < n) return clip.frames[raw] ?? []
  const loopStart = Math.max(0, Math.min(clip.loopFrom, n - 1))
  const loopLen = n - loopStart
  return clip.frames[loopStart + ((raw - loopStart) % loopLen)] ?? []
}

export function safePublicUrl(raw: string): string {
  const loc = typeof location === "undefined" ? undefined : location
  const url = new URL(raw, loc?.origin ?? "https://eikon.liftaris.dev")
  if (url.protocol !== "http:" && url.protocol !== "https:") throw new Error("unsafe browser URL")
  return url.toString()
}

export function browserInstructions(entry: CatalogEntry) {
  const target = safePublicUrl(entry.installUrl || entry.packageUrl)
  const preview = safePublicUrl(previewFor(entry))
  const command = `herm eikon install ${target}`
  if (blocked.test(command)) throw new Error("unsafe Herm instructions")
  return {
    command,
    manual: `Copy the command into Herm locally. Preview source: ${preview}`,
  }
}

class Limiter {
  active = 0
  queue: (() => void)[] = []
  constructor(readonly max: number) {}
  async run<T>(fn: () => Promise<T>): Promise<T> {
    if (this.active >= this.max) await new Promise<void>(resolve => this.queue.push(resolve))
    this.active++
    try { return await fn() }
    finally {
      this.active--
      this.queue.shift()?.()
    }
  }
}

export function createWebCatalog(opts: WebCatalogOptions = {}) {
  const policy = { ...defaults, ...opts }
  const fetcher = opts.fetch ?? fetch
  const loader = opts.loadCatalog
  const limit = new Limiter(policy.concurrency)
  const cache = new Map<string, string>()
  const inflight = new Map<string, Promise<PreviewState>>()
  const state: WebState = { status: "idle", entries: [], query: "", preview: { status: "idle" }, previews: {} }

  const put = (key: string, val: string) => {
    if (cache.has(key)) cache.delete(key)
    cache.set(key, val)
    while (cache.size > policy.cacheEntries) cache.delete(cache.keys().next().value!)
  }

  const fetchText = async (raw: string, signal?: AbortSignal) => {
    const url = safePublicUrl(raw)
    const hit = cache.get(url)
    if (hit !== undefined) return hit
    return limit.run(async () => {
      const ctrl = new AbortController()
      const timer = globalThis.setTimeout(() => ctrl.abort(new Error("preview fetch timed out")), policy.timeoutMs)
      signal?.addEventListener("abort", () => ctrl.abort(new Error("preview fetch cancelled")), { once: true })
      try {
        const res = await fetcher(url, { signal: ctrl.signal })
        if (!res.ok) throw new Error(`web catalog: HTTP ${res.status}`)
        const text = await res.text()
        if (new TextEncoder().encode(text).byteLength > policy.maxBytes) throw new Error("web catalog: size limit exceeded")
        put(url, text)
        return text
      } finally {
        globalThis.clearTimeout(timer)
      }
    })
  }

  const entryFor = (key: string) => state.entries.find(entry => keyFor(entry) === key)

  const loadPreview = async (key: string, signal?: AbortSignal): Promise<PreviewState> => {
    const entry = entryFor(key)
    if (!entry) return { status: "error", error: "unknown entry" }
    const ready = state.previews[key]
    if (ready?.status === "ready") return ready
    const active = inflight.get(key)
    if (active) return active
    state.previews[key] = { status: "loading", entry }
    const work = (async () => {
      try {
        const raw = await fetchText(previewFor(entry), signal)
        const eikon = parsePreview(raw)
        const loaded: PreviewState = { status: "ready", entry, raw, eikon }
        state.previews[key] = loaded
        return loaded
      } catch (err) {
        const failed: PreviewState = { status: "error", entry, error: err instanceof Error ? err.message : String(err) }
        state.previews[key] = failed
        return failed
      } finally {
        inflight.delete(key)
      }
    })()
    inflight.set(key, work)
    return work
  }

  const api = {
    state,
    keyFor,
    policy: () => ({ maxBytes: policy.maxBytes, timeoutMs: policy.timeoutMs, concurrency: policy.concurrency, cacheEntries: policy.cacheEntries }),
    async refresh() {
      state.status = "loading"
      state.error = undefined
      try {
        const base = opts.base ?? "/eikons"
        if (loader) state.entries = await loader(base, fetcher)
        else {
          const { loadCatalogEntries } = await import("../catalog")
          state.entries = await loadCatalogEntries(base, fetcher)
        }
        state.status = "ready"
      } catch (err) {
        state.status = "error"
        state.error = err instanceof Error ? err.message : String(err)
      }
    },
    search(query: string) {
      state.query = query
      const q = query.trim().toLowerCase()
      const entries = !q ? [...state.entries] : state.entries.filter(entry => [entry.name, entry.title, entry.author, entry.description, ...(entry.tags ?? [])].some(value => value?.toLowerCase().includes(q)))
      if (!entries.some(entry => keyFor(entry) === state.selectedKey)) state.selectedKey = undefined
      return entries
    },
    select(key: string) { state.selectedKey = key },
    selected() { return entryFor(state.selectedKey ?? "") },
    actions() {
      if (state.status === "error") return ["retry"]
      if (state.preview.status === "error") return ["copy-instructions", "retry-preview"]
      return ["copy-instructions"]
    },
    fetchText,
    loadPreview,
    async preview(key: string, signal?: AbortSignal): Promise<PreviewState> {
      const entry = entryFor(key)
      if (!entry) return { status: "error", error: "unknown entry" }
      state.selectedKey = key
      state.preview = state.previews[key]?.status === "ready" ? state.previews[key]! : { status: "loading", entry }
      if (state.preview.status === "ready") return state.preview
      const loaded = await loadPreview(key, signal)
      if (state.selectedKey === key) state.preview = loaded
      return loaded
    },
  }
  return api
}
