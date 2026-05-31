import type { Meta } from "./ui/eikon"

export const CATALOG_VERSION = 1
export const DEFAULT_PUBLIC_CATALOG = "https://eikon.liftaris.dev/eikons"

const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"])
const REVIEWED = new Set(["reviewed", "pending", "unreviewed"])

export type CatalogTrust = {
  license?: string
  provenance?: string
  reviewStatus?: string
}

export type CatalogIndexEntry = {
  name: string
  author?: string
  glyph?: string
  w?: number
  h?: number
  width?: number
  height?: number
  poster?: string
  source?: string
  preview_url?: string
  install_url?: string
  source_url?: string
  description?: string
  license?: string
  provenance?: string
  review_status?: string
  reviewed?: boolean
  [key: string]: unknown
}

export type CatalogEntry = {
  name: string
  author?: string
  glyph?: string
  w: number
  h: number
  width: number
  height: number
  poster: string
  description?: string
  trust: CatalogTrust
  previewUrl: string
  installUrl: string
  provenanceUrl?: string
  sourceKey: string
  identityKey: string
  raw: CatalogIndexEntry
}

export type Catalog = {
  base: string
  entries: CatalogEntry[]
  load: (entry: CatalogEntry | string) => Promise<string>
}

export type CatalogOptions = { allowPrivate?: boolean }
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const trimSlash = (s: string) => s.replace(/\/$/, "")
const slash = (s: string) => s.replace(/\/?$/, "/")

const pathEscape = (raw: string) => raw.split(/[?#]/, 1)[0]?.split(/[\\/]/).some(p => p === "..") ?? false

const clean = (v: unknown) => {
  if (typeof v !== "string") return undefined
  return v.replace(/[\u0000-\u001f\u007f-\u009f]/g, "")
}

const cleanTextBlock = (v: unknown) => {
  if (typeof v !== "string") return undefined
  return v.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "")
}

const safeName = (v: unknown, fallback = "unnamed") => clean(v) || fallback
const safeNum = (v: unknown) => typeof v === "number" && Number.isFinite(v) ? v : 0

const privateHost = (host: string) => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (PRIVATE_HOSTS.has(h)) return true
  if (h.endsWith(".localhost")) return true
  if (/^10\./.test(h)) return true
  if (/^127\./.test(h)) return true
  if (/^169\.254\./.test(h)) return true
  if (/^192\.168\./.test(h)) return true
  const m = h.match(/^172\.(\d+)\./)
  if (m && Number(m[1]) >= 16 && Number(m[1]) <= 31) return true
  if (h.startsWith("fe80:")) return true
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true
  return h.startsWith("::ffff:127.") || h.startsWith("::ffff:10.") || h.startsWith("::ffff:192.168.") || h.startsWith("::ffff:169.254.")
}

function catalogBaseUrl(base: string, opts: CatalogOptions) {
  const url = publicCatalogUrl(base, undefined, opts)
  return trimSlash(url)
}

export function publicCatalogUrl(raw: string, base?: string, opts: CatalogOptions = {}): string {
  let url: URL
  try { url = new URL(raw, base) }
  catch { throw new Error(`public catalog URL is invalid: ${raw}`) }
  if (pathEscape(raw)) throw new Error(`public catalog URL path escape: ${url.href}`)
  if (opts.allowPrivate && url.protocol === "file:") return url.href
  if (url.protocol !== "https:" && url.protocol !== "http:")
    throw new Error(`public catalog URL must use http(s): ${url.href}`)
  if (!opts.allowPrivate && privateHost(url.hostname)) throw new Error(`public catalog URL cannot use private host: ${url.hostname}`)
  if (url.pathname.split("/").some(p => p === "..")) throw new Error(`public catalog URL path escape: ${url.href}`)
  return url.href
}

function assetUrl(raw: string | undefined, base: string, fallback: string, opts: CatalogOptions = {}) {
  if (!raw) return publicCatalogUrl(new URL(fallback, slash(base)).href, undefined, opts)
  const url = publicCatalogUrl(raw, raw.includes("://") ? undefined : slash(base), opts)
  const root = new URL(slash(base))
  const parsed = new URL(url)
  if (parsed.host !== root.host) throw new Error(`public catalog URL host must match catalog host: ${url}`)
  if (!parsed.pathname.startsWith(root.pathname)) throw new Error(`public catalog URL path escape: ${url}`)
  return url
}

function sourceDir(e: CatalogIndexEntry, base: string, name: string, opts: CatalogOptions) {
  const src = typeof e.source === "string" ? e.source : `${name}/`
  return assetUrl(src, base, `${name}/`, opts)
}

function entryAssetUrl(raw: unknown, base: string, dir: string, fallback: string, opts: CatalogOptions) {
  if (typeof raw !== "string") return assetUrl(undefined, dir, fallback, opts)
  if (raw.includes("://") || raw.startsWith("/")) return assetUrl(raw, base, fallback, opts)
  if (raw.startsWith("./")) return assetUrl(raw, dir, fallback, opts)
  const prefix = new URL(dir).pathname.replace(new URL(slash(base)).pathname, "").replace(/^\//, "")
  const relativeBase = raw === prefix || raw.startsWith(prefix) ? base : dir
  return assetUrl(raw, relativeBase, fallback, opts)
}

export function catalogEntry(e: CatalogIndexEntry, base = DEFAULT_PUBLIC_CATALOG, opts: CatalogOptions = {}): CatalogEntry {
  const name = safeName(e.name)
  const author = clean(e.author)
  const desc = clean(e.description)
  const dir = sourceDir(e, base, name, opts)
  const previewUrl = entryAssetUrl(e.preview_url, base, dir, `${name}.eikon`, opts)
  const installUrl = entryAssetUrl(e.install_url, base, dir, "", opts)
  const sourceUrl = typeof e.source_url === "string" ? publicCatalogUrl(e.source_url, slash(base), opts) : undefined
  const review = clean(e.review_status) ?? (e.reviewed === true ? "reviewed" : undefined)
  const reviewStatus = review && REVIEWED.has(review) ? review : review
  const trust = {
    ...(clean(e.license) ? { license: clean(e.license) } : {}),
    ...(clean(e.provenance) ? { provenance: clean(e.provenance) } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
  }
  const sourceKey = dir
  return {
    name,
    ...(author ? { author } : {}),
    ...(clean(e.glyph) ? { glyph: clean(e.glyph) } : {}),
    w: safeNum(e.width ?? e.w),
    h: safeNum(e.height ?? e.h),
    width: safeNum(e.width ?? e.w),
    height: safeNum(e.height ?? e.h),
    poster: cleanTextBlock(e.poster) ?? "",
    ...(desc ? { description: desc } : {}),
    trust,
    previewUrl,
    installUrl,
    ...(sourceUrl ? { provenanceUrl: sourceUrl } : {}),
    sourceKey,
    identityKey: sourceKey || `${slash(base)}#${name}`,
    raw: e,
  }
}

export function searchCatalog(entries: CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return entries
  return entries.filter(e => e.name.toLowerCase().includes(q) || (e.author ?? "").toLowerCase().includes(q))
}

export async function loadCatalog(base = DEFAULT_PUBLIC_CATALOG, fetcher: Fetcher = fetch, opts: CatalogOptions = {}): Promise<Catalog> {
  const root = catalogBaseUrl(base, opts)
  const res = await fetcher(`${root}/index.json`)
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`)
  const idx = await res.json() as CatalogIndexEntry[]
  const entries = idx.map(e => catalogEntry(e, root, opts))
  return {
    base: root,
    entries,
    load(entry) {
      const hit = typeof entry === "string" ? entries.find(e => e.name === entry || e.identityKey === entry || e.sourceKey === entry) : entry
      if (!hit) throw new Error(`catalog: unknown eikon "${entry}"`)
      return fetcher(hit.previewUrl).then(r => {
        if (!r.ok) throw new Error(`catalog: HTTP ${r.status}`)
        return r.text()
      })
    },
  }
}

export function entryFromMeta(meta: Meta, poster: string, base: string, opts: CatalogOptions = {}): CatalogEntry {
  return catalogEntry({
    name: meta.name,
    author: meta.author,
    glyph: meta.glyph,
    width: meta.width,
    height: meta.height,
    poster,
    description: clean(meta.description),
    license: clean(meta.license),
    provenance: clean(meta.provenance),
    source_url: clean(meta.source_url),
  }, base, opts)
}
