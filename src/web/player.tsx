/** @jsxImportSource react */
import {
  loadCatalogEntries,
  loadRuntimeArtifact,
  parseLaunchStream,
  type BrowserClip,
  type BrowserEikon,
  type CatalogEntry,
} from "../browser"

export type PreviewState =
  | { status: "idle" }
  | { status: "loading"; entry: CatalogEntry }
  | { status: "ready"; entry: CatalogEntry; raw: string; eikon: BrowserEikon }
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
const keyFor = (entry: CatalogEntry) => entry.sourceKey || entry.id || entry.name
const previewFor = (entry: CatalogEntry) => entry.runtimeUrl
const cacheFor = (entry: CatalogEntry) => [
  keyFor(entry),
  previewFor(entry),
  entry.trust?.runtimeDigest ?? "",
  entry.trust?.runtimeSize ?? "",
  entry.trust?.runtimeEncoding ?? "identity",
  entry.trust?.runtimeDecodedDigest ?? "",
].join("|")
const shellSafe = /^[A-Za-z0-9_/@%+=:,.-]+$/

function shellArg(value: string): string {
  if (shellSafe.test(value)) return value
  return `'${value.replaceAll("'", "'\\''")}'`
}

export function AsciiPreview(props: { lines: string[] }) {
  return <pre className="ascii" aria-label="Eikon ASCII preview"><span className="asciiArt">{props.lines.join("\n")}</span></pre>
}

export function EntryCard(props: { entry: CatalogEntry; selected: boolean; onPick: () => void; frame?: string[] }) {
  const title = props.entry.title || props.entry.name
  const preview = props.frame?.length ? props.frame.join("\n") : props.entry.poster || ""
  return (
    <button type="button" className={props.selected ? "card selected" : "card"} onClick={props.onPick}>
      <span className="cardPreview" aria-hidden="true">
        <span className="cardPoster">{preview}</span>
      </span>
      <span className="name">{props.entry.glyph ?? "⬡"} {title}</span>
      <span className="meta">{props.entry.author ?? "unknown"}</span>
    </button>
  )
}

export function parsePreview(text: string): BrowserEikon {
  return parseLaunchStream(text)
}

export function stateClip(eikon: BrowserEikon, state: string): BrowserClip | undefined {
  return eikon.clips.get(state) ?? eikon.clips.get("idle") ?? eikon.clips.values().next().value
}

export function webPlaybackFrame(eikon: BrowserEikon, state: string, tickMs: number, startedAtMs = 0): string[] {
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
  const target = safePublicUrl(entry.packageUrl)
  const preview = safePublicUrl(previewFor(entry))
  const command = `herm eikon install ${shellArg(target)}`
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

  const fetchText = async (raw: string, signal?: AbortSignal, entry?: CatalogEntry) => {
    const url = safePublicUrl(raw)
    const key = entry ? cacheFor({ ...entry, runtimeUrl: url }) : url
    const hit = cache.get(key)
    if (hit !== undefined) return hit
    return limit.run(async () => {
      const ctrl = new AbortController()
      const timer = globalThis.setTimeout(() => ctrl.abort(new Error("preview fetch timed out")), policy.timeoutMs)
      signal?.addEventListener("abort", () => ctrl.abort(new Error("preview fetch cancelled")), { once: true })
      try {
        const text = entry
          ? (await loadRuntimeArtifact({ ...entry, runtimeUrl: url }, fetcher, { maxBytes: policy.maxBytes, signal: ctrl.signal })).text
          : await (async () => {
              const res = await fetcher(url, { signal: ctrl.signal })
              if (!res.ok) throw new Error(`web catalog: HTTP ${res.status}`)
              const bytes = new Uint8Array(await res.arrayBuffer())
              if (bytes.length > policy.maxBytes) throw new Error("web catalog: size limit exceeded")
              return new TextDecoder().decode(bytes)
            })()
        put(key, text)
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
    const id = cacheFor(entry)
    const ready = state.previews[id]
    if (ready?.status === "ready") return ready
    const active = inflight.get(id)
    if (active) return active
    state.previews[id] = { status: "loading", entry }
    const work = (async () => {
      try {
        const raw = await fetchText(previewFor(entry), signal, entry)
        const eikon = parsePreview(raw)
        const loaded: PreviewState = { status: "ready", entry, raw, eikon }
        state.previews[id] = loaded
        return loaded
      } catch (err) {
        const failed: PreviewState = { status: "error", entry, error: err instanceof Error ? err.message : String(err) }
        state.previews[id] = failed
        return failed
      } finally {
        inflight.delete(id)
      }
    })()
    inflight.set(id, work)
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
        state.entries = loader ? await loader(base, fetcher) : await loadCatalogEntries(base, fetcher)
        state.previews = {}
        inflight.clear()
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
      const id = cacheFor(entry)
      state.preview = state.previews[id]?.status === "ready" ? state.previews[id]! : { status: "loading", entry }
      if (state.preview.status === "ready") return state.preview
      const loaded = await loadPreview(key, signal)
      if (state.selectedKey === key) state.preview = loaded
      return loaded
    },
  }
  return api
}
