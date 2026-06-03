import { EikonValidationError } from "./contract/errors"
import {
  CATALOG_KIND,
  CATALOG_SCHEMA_VERSION,
  type CatalogEntry,
  type EikonPackageManifest,
} from "./contract/shape"
import { validatePackageManifest, isSafeRelativePath } from "./package/manifest"
import { DEFAULT_CATALOG } from "./ui/spec"

export const CATALOG_VERSION = 1
export const DEFAULT_PUBLIC_CATALOG = DEFAULT_CATALOG

export type CatalogOptions = { allowPrivate?: boolean }
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
export type PublicCatalogEntry = CatalogEntry & {
  w: number
  h: number
  width: number
  height: number
  previewUrl: string
  installUrl: string
  provenanceUrl?: string
  identityKey: string
  raw: CatalogIndexEntry | CatalogEntry
  trust: CatalogTrust & NonNullable<CatalogEntry["trust"]>
}
export type Catalog = {
  base: string
  entries: PublicCatalogEntry[]
  load: (entry: PublicCatalogEntry | string) => Promise<string>
}
export type CatalogInput = CatalogEntry | CatalogIndexEntry | PackageCatalogEntry

type LegacyCatalogEntry = CatalogIndexEntry
type PackageCatalogEntry = {
  manifest: EikonPackageManifest
  packageUrl: string
  sourceKey?: string
  detailUrl?: string
  installUrl?: string
}
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"])
const REVIEWED = new Set(["reviewed", "pending", "unreviewed"])
const text = (value: unknown) => typeof value === "string" && !/[<>\u0000-\u001f]/.test(value)
const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const problem = (path: string, message: string) => ({ code: "catalog", path, message: `${path}: ${message}` })
const trimSlash = (s: string) => s.replace(/\/$/, "")
const slash = (s: string) => s.replace(/\/?$/, "/")
const pathEscape = (raw: string) => raw.split(/[?#]/, 1)[0]?.split(/[\\/]/).some(p => p === "..") ?? false
const clean = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "") : undefined
const cleanTextBlock = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "") : undefined
const safeName = (value: unknown, fallback = "unnamed") => clean(value) || fallback
const safeNum = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0

const privateIpv4 = (a: number, b: number) => {
  if (a === 10) return true
  if (a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

const mappedIpv4Private = (host: string) => {
  const hex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/)
  if (!hex) return false
  const n = Number.parseInt(hex[1]!, 16) * 0x10000 + Number.parseInt(hex[2]!, 16)
  return privateIpv4(Math.floor(n / 0x1000000), Math.floor(n / 0x10000) & 0xff)
}

const privateHost = (host: string) => {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (PRIVATE_HOSTS.has(h)) return true
  if (h.endsWith(".localhost")) return true
  const ip = h.match(/^(\d+)\.(\d+)\./)
  if (ip && privateIpv4(Number(ip[1]), Number(ip[2]))) return true
  if (h.startsWith("fe80:")) return true
  if (/^f[cd][0-9a-f]{2}:/.test(h)) return true
  return mappedIpv4Private(h)
}

export function publicCatalogUrl(raw = DEFAULT_PUBLIC_CATALOG, base?: string, opts: CatalogOptions = {}): string {
  let out: URL
  try { out = new URL(raw, base) }
  catch { throw new Error(`public catalog URL is invalid: ${raw}`) }
  if (pathEscape(raw)) throw new Error(`public catalog URL path escape: ${out.href}`)
  if (opts.allowPrivate && out.protocol === "file:") return out.href
  if (out.protocol !== "https:" && out.protocol !== "http:") throw new Error(`public catalog URL must use http(s): ${out.href}`)
  if (!opts.allowPrivate && privateHost(out.hostname)) throw new Error(`public catalog URL cannot use private host: ${out.hostname}`)
  if (out.pathname.split("/").some(p => p === "..")) throw new Error(`public catalog URL path escape: ${out.href}`)
  return out.href
}

function url(value: string, base?: string): string {
  try {
    return publicCatalogUrl(value, base, { allowPrivate: true })
  } catch {
    throw new EikonValidationError([problem("packageUrl", "http(s) URL required")])
  }
}

function joinUrl(base: string, path: string): string {
  return new URL(path, base.endsWith("/") ? base : `${base}/`).toString()
}

function relativeUrl(base: string, path?: string): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//.test(path)) return url(path)
  if (!isSafeRelativePath(path)) throw new EikonValidationError([problem("path", "safe relative path required")])
  return joinUrl(base, path)
}

function assetUrl(raw: string | undefined, base: string, fallback: string, opts: CatalogOptions = {}) {
  if (!raw) return publicCatalogUrl(new URL(fallback, slash(base)).href, undefined, opts)
  const out = publicCatalogUrl(raw, raw.includes("://") ? undefined : slash(base), opts)
  const root = new URL(slash(base))
  const parsed = new URL(out)
  if (parsed.host !== root.host) throw new Error(`public catalog URL host must match catalog host: ${out}`)
  if (!parsed.pathname.startsWith(root.pathname)) throw new Error(`public catalog URL path escape: ${out}`)
  return out
}

function sourceDir(entry: CatalogIndexEntry, base: string, name: string, opts: CatalogOptions) {
  return assetUrl(typeof entry.source === "string" ? entry.source : undefined, base, `${name}/`, opts)
}

function entryAssetUrl(raw: unknown, base: string, dir: string, fallback: string, opts: CatalogOptions) {
  if (typeof raw !== "string") return assetUrl(undefined, dir, fallback, opts)
  if (raw.includes("://") || raw.startsWith("/")) return assetUrl(raw, base, fallback, opts)
  if (raw.startsWith("./")) return assetUrl(raw, dir, fallback, opts)
  const prefix = new URL(dir).pathname.replace(new URL(slash(base)).pathname, "").replace(/^\//, "")
  const relativeBase = raw === prefix || raw.startsWith(prefix) ? base : dir
  return assetUrl(raw, relativeBase, fallback, opts)
}

export function catalogEntry(entry: CatalogIndexEntry, base = DEFAULT_PUBLIC_CATALOG, opts: CatalogOptions = {}): PublicCatalogEntry {
  const name = safeName(entry.name)
  const author = clean(entry.author)
  const desc = clean(entry.description)
  const dir = sourceDir(entry, base, name, opts)
  const previewUrl = entryAssetUrl(entry.preview_url, base, dir, `${name}.eikon`, opts)
  const installUrl = entryAssetUrl(entry.install_url, base, dir, "", opts)
  const sourceUrl = typeof entry.source_url === "string" ? publicCatalogUrl(entry.source_url, slash(base), opts) : undefined
  const review = clean(entry.review_status) ?? (entry.reviewed === true ? "reviewed" : undefined)
  const reviewStatus = review && REVIEWED.has(review) ? review : review
  const trust = {
    ...(clean(entry.license) ? { license: clean(entry.license) } : {}),
    ...(clean(entry.provenance) ? { provenance: clean(entry.provenance) } : {}),
    ...(reviewStatus ? { reviewStatus } : {}),
  }
  return {
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: name,
    sourceKey: dir,
    name,
    ...(author ? { author } : {}),
    ...(clean(entry.glyph) ? { glyph: clean(entry.glyph) } : {}),
    w: safeNum(entry.width ?? entry.w),
    h: safeNum(entry.height ?? entry.h),
    width: safeNum(entry.width ?? entry.w),
    height: safeNum(entry.height ?? entry.h),
    poster: cleanTextBlock(entry.poster) ?? "",
    ...(desc ? { description: desc } : {}),
    trust,
    previewUrl,
    preview: previewUrl,
    packageUrl: installUrl.endsWith("manifest.json") ? installUrl : joinUrl(installUrl, "manifest.json"),
    installUrl,
    compatibility: { eikon: ">=1 <3", available: true },
    ...(sourceUrl ? { provenanceUrl: sourceUrl } : {}),
    identityKey: sourceUrl ?? dir,
    raw: entry,
  }
}

function publicFromEntry(entry: CatalogEntry, raw: CatalogEntry | CatalogIndexEntry = entry): PublicCatalogEntry {
  const previewUrl = entry.preview ?? entry.installUrl ?? entry.packageUrl
  const installUrl = entry.installUrl ?? entry.packageUrl
  const trust = entry.trust ?? {}
  const reviewStatus = "reviewStatus" in trust && typeof trust.reviewStatus === "string" ? trust.reviewStatus : entry.trust?.reviewed ? "reviewed" : undefined
  return {
    ...entry,
    trust: {
      ...trust,
      ...(reviewStatus ? { reviewStatus } : {}),
      ...(entry.trust?.source ? { provenance: entry.trust.source } : {}),
    },
    poster: entry.poster ?? "",
    preview: previewUrl,
    previewUrl,
    installUrl,
    w: 0,
    h: 0,
    width: 0,
    height: 0,
    identityKey: entry.sourceKey || entry.id,
    raw,
  }
}

function fromPackage(input: PackageCatalogEntry, root?: string): CatalogEntry {
  const man = validatePackageManifest(input.manifest)
  const packageUrl = url(input.packageUrl, root)
  const base = packageUrl.slice(0, packageUrl.lastIndexOf("/") + 1)
  return validateCatalogEntry({
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: man.id,
    sourceKey: input.sourceKey ?? packageUrl,
    name: man.name,
    title: man.display?.title,
    author: man.display?.author,
    description: man.display?.description,
    glyph: man.display?.glyph,
    tags: man.display?.tags,
    poster: relativeUrl(base, man.poster),
    preview: relativeUrl(base, man.preview ?? man.entrypoints.default),
    packageUrl,
    detailUrl: input.detailUrl ? url(input.detailUrl, base) : undefined,
    installUrl: input.installUrl ? url(input.installUrl, base) : packageUrl,
    compatibility: { eikon: man.compatibility.eikon, hosts: man.compatibility.hosts, available: true },
  })
}

function fromLegacy(input: LegacyCatalogEntry, base?: string): CatalogEntry {
  if (!NAME_RE.test(input.name)) throw new EikonValidationError([problem("name", "safe catalog name required")])
  const source = input.source ?? `${input.name}/`
  if (/^file:|^javascript:|^data:/i.test(source)) throw new EikonValidationError([problem("packageUrl", "http(s) URL required")])
  const packageUrl = /^https?:\/\//.test(source) ? url(source) : base ? joinUrl(base, source) : source
  const manifest = packageUrl.endsWith("manifest.json") ? packageUrl : joinUrl(packageUrl, "manifest.json")
  const root = packageUrl.endsWith("manifest.json") ? packageUrl.slice(0, packageUrl.lastIndexOf("/") + 1) : packageUrl
  return validateCatalogEntry({
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: input.name,
    sourceKey: /^https?:\/\//.test(packageUrl) ? packageUrl : input.name,
    name: input.name,
    author: input.author,
    glyph: input.glyph,
    poster: input.poster,
    preview: typeof input.preview_url === "string" ? relativeUrl(root, input.preview_url) : joinUrl(root, `${input.name}.eikon`),
    packageUrl: manifest,
    installUrl: typeof input.install_url === "string" ? relativeUrl(root, input.install_url) : root,
    compatibility: { eikon: ">=1 <3", available: true },
    trust: { source: input.provenance, reviewed: input.reviewed === true },
  })
}

export function validateCatalogEntry(entry: CatalogEntry): CatalogEntry {
  const errs = []
  if (entry.kind !== CATALOG_KIND) errs.push(problem("kind", `must be ${CATALOG_KIND}`))
  if (!NAME_RE.test(entry.name)) errs.push(problem("name", "safe catalog name required"))
  for (const [key, value] of Object.entries({ id: entry.id, sourceKey: entry.sourceKey, title: entry.title, author: entry.author, description: entry.description, glyph: entry.glyph })) {
    if (value != null && !text(value)) errs.push(problem(key, "unsafe text"))
  }
  try { url(entry.packageUrl) } catch { errs.push(problem("packageUrl", "http(s) URL required")) }
  for (const key of ["poster", "preview", "detailUrl", "installUrl"] as const) {
    const value = entry[key]
    if (value && /^file:|^javascript:|^data:/i.test(value)) errs.push(problem(key, "unsafe URL"))
  }
  if (!entry.compatibility?.eikon) errs.push(problem("compatibility.eikon", "required"))
  if (errs.length) throw new EikonValidationError(errs)
  return entry
}

export function normalizeCatalogEntry(input: CatalogInput, base?: string): CatalogEntry {
  if (isObj(input) && "kind" in input && input.kind === CATALOG_KIND) return validateCatalogEntry(input as CatalogEntry)
  if (isObj(input) && "manifest" in input) return fromPackage(input as PackageCatalogEntry, base)
  return fromLegacy(input as LegacyCatalogEntry, base)
}

export function searchCatalogEntries(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  return entries.filter(entry => [entry.name, entry.title, entry.author, entry.description, ...(entry.tags ?? [])].some(value => value?.toLowerCase().includes(q)))
}

export async function loadCatalogEntries(base: string, fetcher: typeof fetch = fetch): Promise<CatalogEntry[]> {
  const root = base.replace(/\/$/, "")
  const res = await fetcher(`${root}/index.json`)
  if (!res.ok) throw new Error(`catalog: ${res.status} loading ${root}/index.json`)
  const items = await res.json() as unknown
  if (!Array.isArray(items)) throw new EikonValidationError([problem("catalog", "index array required")])
  return items.map(item => normalizeCatalogEntry(item as CatalogInput, `${root}/`))
}

export function searchCatalog(entries: readonly PublicCatalogEntry[], query: string): PublicCatalogEntry[] {
  return searchCatalogEntries(entries, query) as PublicCatalogEntry[]
}

export async function loadCatalog(base = DEFAULT_PUBLIC_CATALOG, fetcher: Fetcher = fetch, opts: CatalogOptions = {}): Promise<Catalog> {
  const root = trimSlash(publicCatalogUrl(base, undefined, opts))
  const res = await fetcher(`${root}/index.json`)
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`)
  const items = await res.json() as unknown
  if (!Array.isArray(items)) throw new EikonValidationError([problem("catalog", "index array required")])
  const entries = items.map(item => {
    if (isObj(item) && "kind" in item && item.kind === CATALOG_KIND) return publicFromEntry(normalizeCatalogEntry(item as CatalogEntry), item as CatalogEntry)
    if (isObj(item) && "manifest" in item) return publicFromEntry(normalizeCatalogEntry(item as PackageCatalogEntry, `${root}/`), item as CatalogIndexEntry)
    return catalogEntry(item as CatalogIndexEntry, root, opts)
  })
  return {
    base: root,
    entries,
    async load(entry) {
      const item = typeof entry === "string" ? entries.find(e => e.identityKey === entry || e.sourceKey === entry || e.name === entry) : entry
      if (!item) throw new Error(`catalog: unknown eikon "${entry}"`)
      const out = await fetcher(item.previewUrl)
      if (!out.ok) throw new Error(`catalog: HTTP ${out.status}`)
      return out.text()
    },
  }
}
