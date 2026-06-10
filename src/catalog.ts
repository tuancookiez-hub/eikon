import { EikonValidationError } from "./contract/errors"
import {
  CATALOG_KIND,
  CATALOG_SCHEMA_VERSION,
  LAUNCH_MEDIA_TYPE,
  type CatalogEntry,
  type EikonPackageManifest,
  type RuntimeEncoding,
} from "./contract/shape"
import { validatePackageManifest, isSafeRelativePath } from "./package/manifest"
import { DEFAULT_CATALOG } from "./ui/spec"
import { decodeRuntimeBytes } from "./stream/runtime-browser"
import type { RuntimeDescriptor } from "./stream/runtime"

export const CATALOG_VERSION = 1
export const DEFAULT_PUBLIC_CATALOG = DEFAULT_CATALOG

export type CatalogOptions = { allowPrivate?: boolean }
export type CatalogTrust = {
  manifestDigest?: string
  runtimeDigest?: string
  runtimeSize?: number
  runtimeEncoding?: RuntimeEncoding
  runtimeDecodedSize?: number
  runtimeDecodedDigest?: string
}
export type CatalogIndexEntry = {
  name: string
  version?: string
  author?: string
  glyph?: string
  tags?: string[]
  w?: number
  h?: number
  width?: number
  height?: number
  poster?: string
  source?: string
  runtime_url?: string
  runtimeUrl?: string
  package_url?: string
  packageUrl?: string
  detail_url?: string
  detailUrl?: string
  source_url?: string
  description?: string
  [key: string]: unknown
}
export type PublicCatalogEntry = CatalogEntry & {
  w: number
  h: number
  width: number
  height: number
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
  trust?: CatalogTrust
}
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type RuntimeArtifact = { bytes: Uint8Array; text: string }

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"])
const text = (value: unknown) => typeof value === "string" && !/[<>\u0000-\u001f]/.test(value)
const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const problem = (path: string, message: string) => ({ code: "catalog", path, message: `${path}: ${message}` })
const digestRe = /^sha256:[A-Za-z0-9._~+/=-]+$/
const encodings = new Set<RuntimeEncoding>(["identity", "gzip"])
const trimSlash = (s: string) => s.replace(/\/$/, "")
const slash = (s: string) => s.replace(/\/?$/, "/")
const pathEscape = (raw: string) => {
  const path = raw.split(/[?#]/, 1)[0] ?? raw
  const decoded = (() => { try { return decodeURIComponent(path) } catch { return path } })()
  return [path, decoded].some(value => /%5c/i.test(value) || value.split(/[\/]/).some(p => p === ".."))
}
const clean = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u001f\u007f-\u009f]/g, "") : undefined
const cleanTextBlock = (value: unknown) => typeof value === "string" ? value.replace(/[\u0000-\u0009\u000b\u000c\u000e-\u001f\u007f-\u009f]/g, "") : undefined
const safeName = (value: unknown, fallback = "unnamed") => clean(value) || fallback
const safeNum = (value: unknown) => typeof value === "number" && Number.isFinite(value) ? value : 0
const blobDigest = (value: string): string | undefined => {
  const m = new URL(value).pathname.match(/\/blobs\/sha256\/([A-Fa-f0-9]{64})(?:\.eikon)?$/)
  return m ? `sha256:${m[1]!.toLowerCase()}` : undefined
}
const isRuntimeUrl = (value: string) => value.endsWith(".eikon") || /\/blobs\/sha256\/[A-Fa-f0-9]{16,}(?:\.eikon)?$/.test(new URL(value).pathname)
const goodSize = (value: unknown) => typeof value === "number" && Number.isFinite(value) && value >= 0

async function sha256(bytes: Uint8Array): Promise<string> {
  const copy = new Uint8Array(bytes)
  const hash = await crypto.subtle.digest("SHA-256", copy.buffer as ArrayBuffer)
  return `sha256:${[...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, "0")).join("")}`
}

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
  catch { throw new Error(`public catalog URL is invalid`) }
  if (pathEscape(raw)) throw new Error(`public catalog URL path escape: ${out.origin}${out.pathname}`)
  if (opts.allowPrivate && out.protocol === "file:") return out.href
  if (out.protocol !== "https:" && out.protocol !== "http:") throw new Error(`public catalog URL must use http(s): ${out.href}`)
  if (out.username || out.password) throw new Error(`public catalog URL cannot include credentials: ${out.protocol}//[redacted]@${out.host}${out.pathname}`)
  for (const key of out.searchParams.keys()) if (/token|secret|key|credential|password/i.test(key)) throw new Error(`public catalog URL cannot include credentials: ${out.origin}${out.pathname}`)
  if (!opts.allowPrivate && privateHost(out.hostname)) throw new Error(`public catalog URL cannot use private host: ${out.hostname}`)
  if (out.protocol === "http:" && !privateHost(out.hostname)) throw new Error(`public catalog URL must use https: ${out.href}`)
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
  const input = raw || fallback
  const out = publicCatalogUrl(input, input.includes("://") ? undefined : slash(base), opts)
  const root = new URL(slash(base))
  const parsed = new URL(out)
  if (parsed.host !== root.host) throw new Error(`public catalog URL host must match catalog host: ${out}`)
  if (!parsed.pathname.startsWith(root.pathname)) throw new Error(`public catalog URL path escape: ${out}`)
  return out
}

function sourceDir(entry: CatalogIndexEntry, base: string, name: string, opts: CatalogOptions) {
  return assetUrl(typeof entry.source === "string" ? entry.source : undefined, base, `${name}/`, opts)
}

function runtimeDescriptor(man: EikonPackageManifest) {
  return man.files?.find(file => file.role === "runtime" && file.path === runtimePath(man))
}

function digestFor(man: EikonPackageManifest, path: string): string | undefined {
  return man.files?.find(file => file.path === path)?.digest
}

function runtimePath(man: EikonPackageManifest): string {
  return man.entrypoints.default
}

export function catalogEntry(entry: CatalogIndexEntry, base = DEFAULT_PUBLIC_CATALOG, opts: CatalogOptions = {}): PublicCatalogEntry {
  return publicFromEntry(fromLegacy(entry, base, opts), entry)
}

function publicFromEntry(entry: CatalogEntry, raw: CatalogEntry | CatalogIndexEntry = entry): PublicCatalogEntry {
  return {
    ...entry,
    trust: entry.trust ?? {},
    poster: entry.poster ?? "",
    w: 0,
    h: 0,
    width: 0,
    height: 0,
    identityKey: entry.sourceKey || entry.id,
    raw,
  }
}

function runtimeDesc(entry: CatalogEntry): RuntimeDescriptor | undefined {
  const trust = entry.trust
  const digest = trust?.runtimeDigest ?? blobDigest(entry.runtimeUrl)
  if (!digest && !trust?.runtimeSize && !trust?.runtimeEncoding && !trust?.runtimeDecodedSize && !trust?.runtimeDecodedDigest) return undefined
  return {
    digest,
    size: trust?.runtimeSize,
    encoding: trust?.runtimeEncoding,
    decodedSize: trust?.runtimeDecodedSize,
    decodedDigest: trust?.runtimeDecodedDigest,
  }
}

function assertArtifactHeaders(res: Response, entry: CatalogEntry): void {
  const enc = res.headers.get("content-encoding")
  if (enc && enc.toLowerCase() !== "identity" && (entry.trust?.runtimeDigest || blobDigest(entry.runtimeUrl)))
    throw new Error(`catalog: runtime artifact must be served without Content-Encoding: ${enc}`)
}

export async function loadRuntimeArtifact(entry: CatalogEntry, fetcher: Fetcher = fetch, opts: { maxBytes?: number; signal?: AbortSignal; allowPrivate?: boolean } = {}): Promise<RuntimeArtifact> {
  publicCatalogUrl(entry.runtimeUrl, undefined, { allowPrivate: opts.allowPrivate })
  publicCatalogUrl(entry.packageUrl, undefined, { allowPrivate: opts.allowPrivate })
  if (entry.trust?.manifestDigest) {
    const pkg = await fetcher(entry.packageUrl, opts.signal ? { signal: opts.signal } : undefined)
    if (pkg.url) publicCatalogUrl(pkg.url, undefined, { allowPrivate: opts.allowPrivate })
    if (!pkg.ok) throw new Error(`catalog: package HTTP ${pkg.status}`)
    const body = new Uint8Array(await pkg.arrayBuffer())
    if (await sha256(body) !== entry.trust.manifestDigest) throw new Error("catalog: package manifest digest mismatch")
  }
  const out = await fetcher(entry.runtimeUrl, opts.signal ? { signal: opts.signal } : undefined)
  if (out.url) publicCatalogUrl(out.url, undefined, { allowPrivate: opts.allowPrivate })
  if (!out.ok) throw new Error(`catalog: HTTP ${out.status}`)
  assertArtifactHeaders(out, entry)
  const bytes = new Uint8Array(await out.arrayBuffer())
  if (opts.maxBytes != null && bytes.length > opts.maxBytes) throw new Error("catalog: size limit exceeded")
  return {
    bytes,
    text: await decodeRuntimeBytes(bytes, { descriptor: runtimeDesc(entry), maxBytes: opts.maxBytes, maxDecodedBytes: opts.maxBytes }),
  }
}

function fromPackage(input: PackageCatalogEntry, root?: string, opts: CatalogOptions = {}): CatalogEntry {
  const man = validatePackageManifest(input.manifest)
  const packageUrl = url(input.packageUrl, root)
  const base = packageUrl.slice(0, packageUrl.lastIndexOf("/") + 1)
  const runtime = runtimePath(man)
  const desc = runtimeDescriptor(man)
  const runtimeUrl = relativeUrl(base, runtime)!
  return validateCatalogEntry({
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: man.id,
    version: man.version,
    sourceKey: input.sourceKey ?? `registry:${new URL(packageUrl).host}:${man.id}${man.version ? `@${man.version}` : ""}`,
    name: man.name,
    title: man.display?.title,
    author: man.display?.author,
    description: man.display?.description,
    glyph: man.display?.glyph,
    tags: man.display?.tags,
    poster: relativeUrl(base, man.poster),
    runtimeUrl,
    packageUrl,
    detailUrl: input.detailUrl ? url(input.detailUrl, base) : undefined,
    compatibility: { eikon: man.compatibility.eikon, hosts: man.compatibility.hosts, available: true },
    trust: {
      manifestDigest: input.trust?.manifestDigest ?? digestFor(man, "manifest.json"),
      runtimeDigest: input.trust?.runtimeDigest ?? desc?.digest,
      runtimeSize: input.trust?.runtimeSize ?? desc?.size,
      runtimeEncoding: input.trust?.runtimeEncoding ?? desc?.encoding,
      runtimeDecodedSize: input.trust?.runtimeDecodedSize ?? desc?.decodedSize,
      runtimeDecodedDigest: input.trust?.runtimeDecodedDigest ?? desc?.decodedDigest,
    },
  }, opts)
}

function fromLegacy(input: LegacyCatalogEntry, base?: string, opts: CatalogOptions = {}): CatalogEntry {
  if (!NAME_RE.test(input.name)) throw new EikonValidationError([problem("name", "safe catalog name required")])
  const source = input.source ?? `${input.name}/`
  if (/^file:|^javascript:|^data:/i.test(source)) throw new EikonValidationError([problem("packageUrl", "http(s) URL required")])
  if (!/^https?:\/\//.test(source) && !isSafeRelativePath(source)) throw new EikonValidationError([problem("path", "path escape")])
  const root = /^https?:\/\//.test(source) ? publicCatalogUrl(source, undefined, opts) : base ? joinUrl(base, source) : source
  const catalogRoot = base ? slash(base) : root
  const runtimeUrl = typeof input.runtimeUrl === "string" ? assetUrl(input.runtimeUrl, catalogRoot, "", opts) : typeof input.runtime_url === "string" ? assetUrl(input.runtime_url, catalogRoot, "", opts) : joinUrl(root, `${input.name}.eikon`)
  const packageUrl = typeof input.packageUrl === "string" ? url(input.packageUrl, catalogRoot) : typeof input.package_url === "string" ? url(input.package_url, catalogRoot) : joinUrl(root, "manifest.json")
  return validateCatalogEntry({
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: input.name,
    version: input.version,
    sourceKey: /^https?:\/\//.test(root) ? root : input.name,
    name: input.name,
    title: clean(input.name),
    author: clean(input.author),
    glyph: clean(input.glyph),
    tags: Array.isArray(input.tags) ? input.tags.filter(text) as string[] : undefined,
    poster: cleanTextBlock(input.poster),
    runtimeUrl,
    packageUrl,
    detailUrl: typeof input.detailUrl === "string" ? url(input.detailUrl, root) : typeof input.detail_url === "string" ? url(input.detail_url, root) : undefined,
    description: clean(input.description),
    compatibility: { eikon: ">=1 <2", available: true },
    trust: {},
  }, opts)
}

export function validateCatalogEntry(entry: CatalogEntry, opts: CatalogOptions = {}): CatalogEntry {
  const errs = []
  if (entry.kind !== CATALOG_KIND) errs.push(problem("kind", `must be ${CATALOG_KIND}`))
  if (!NAME_RE.test(entry.name)) errs.push(problem("name", "safe catalog name required"))
  for (const [key, value] of Object.entries({ id: entry.id, sourceKey: entry.sourceKey, title: entry.title, author: entry.author, description: entry.description, glyph: entry.glyph })) {
    if (value != null && !text(value)) errs.push(problem(key, "unsafe text"))
  }
  try { publicCatalogUrl(entry.packageUrl, undefined, opts) } catch { errs.push(problem("packageUrl", "safe http(s) URL required")) }
  try { publicCatalogUrl(entry.runtimeUrl, undefined, opts) } catch { errs.push(problem("runtimeUrl", "safe http(s) URL required")) }
  if (entry.runtimeUrl && !isRuntimeUrl(entry.runtimeUrl)) errs.push(problem("runtimeUrl", "must point at launch .eikon stream or content-addressed blob"))
  const trust = entry.trust
  if (trust?.manifestDigest != null && !digestRe.test(trust.manifestDigest)) errs.push(problem("trust.manifestDigest", "sha256 digest required"))
  if (trust?.runtimeDigest != null && !digestRe.test(trust.runtimeDigest)) errs.push(problem("trust.runtimeDigest", "sha256 digest required"))
  if (trust?.runtimeDecodedDigest != null && !digestRe.test(trust.runtimeDecodedDigest)) errs.push(problem("trust.runtimeDecodedDigest", "sha256 digest required"))
  if (trust?.runtimeSize != null && !goodSize(trust.runtimeSize)) errs.push(problem("trust.runtimeSize", "non-negative finite size required"))
  if (trust?.runtimeDecodedSize != null && !goodSize(trust.runtimeDecodedSize)) errs.push(problem("trust.runtimeDecodedSize", "non-negative finite size required"))
  if (trust?.runtimeEncoding != null && !encodings.has(trust.runtimeEncoding)) errs.push(problem("trust.runtimeEncoding", "unsupported runtime encoding"))
  if (trust?.runtimeEncoding === "gzip") {
    if (!trust.runtimeDigest) errs.push(problem("trust.runtimeDigest", "required for gzip runtime"))
    if (!goodSize(trust.runtimeSize)) errs.push(problem("trust.runtimeSize", "required for gzip runtime"))
    if (!goodSize(trust.runtimeDecodedSize)) errs.push(problem("trust.runtimeDecodedSize", "required for gzip runtime"))
    if (!trust.runtimeDecodedDigest) errs.push(problem("trust.runtimeDecodedDigest", "required for gzip runtime"))
  }
  for (const key of ["poster", "detailUrl"] as const) {
    const value = entry[key]
    if (value && /^file:|^javascript:|^data:/i.test(value)) errs.push(problem(key, "unsafe URL"))
  }
  if (!entry.compatibility?.eikon) errs.push(problem("compatibility.eikon", "required"))
  if (entry.compatibility?.eikon && !/>=?\s*1/.test(entry.compatibility.eikon)) errs.push(problem("compatibility.eikon", "must support launch major version 1"))
  if (errs.length) throw new EikonValidationError(errs)
  return entry
}

export function normalizeCatalogEntry(input: CatalogInput, base?: string, opts: CatalogOptions = {}): CatalogEntry {
  if (isObj(input) && "kind" in input && input.kind === CATALOG_KIND) return validateCatalogEntry(input as CatalogEntry, opts)
  if (isObj(input) && "manifest" in input) return fromPackage(input as PackageCatalogEntry, base, opts)
  return fromLegacy(input as LegacyCatalogEntry, base, opts)
}

export function searchCatalogEntries(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  return entries.filter(entry => [entry.name, entry.title, entry.author, entry.description, ...(entry.tags ?? [])].some(value => value?.toLowerCase().includes(q)))
}

export async function loadCatalogEntries(base: string, fetcher: Fetcher = fetch, opts: CatalogOptions = {}): Promise<CatalogEntry[]> {
  const root = trimSlash(publicCatalogUrl(base, undefined, opts))
  const res = await fetcher(`${root}/index.json`)
  if (res.url) publicCatalogUrl(res.url, undefined, opts)
  if (!res.ok) throw new Error(`catalog: ${res.status} loading ${root}/index.json`)
  const items = await res.json() as unknown
  if (!Array.isArray(items)) throw new EikonValidationError([problem("catalog", "index array required")])
  return items.map(item => normalizeCatalogEntry(item as CatalogInput, `${root}/`, opts))
}

export function searchCatalog(entries: readonly PublicCatalogEntry[], query: string): PublicCatalogEntry[] {
  return searchCatalogEntries(entries, query) as PublicCatalogEntry[]
}

export async function loadCatalog(base = DEFAULT_PUBLIC_CATALOG, fetcher: Fetcher = fetch, opts: CatalogOptions = {}): Promise<Catalog> {
  const root = trimSlash(publicCatalogUrl(base, undefined, opts))
  const res = await fetcher(`${root}/index.json`)
  if (res.url) publicCatalogUrl(res.url, undefined, opts)
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`)
  const items = await res.json() as unknown
  if (!Array.isArray(items)) throw new EikonValidationError([problem("catalog", "index array required")])
  const entries = items.map(item => {
    if (isObj(item) && "kind" in item && item.kind === CATALOG_KIND) return publicFromEntry(normalizeCatalogEntry(item as CatalogEntry, undefined, opts), item as CatalogEntry)
    if (isObj(item) && "manifest" in item) return publicFromEntry(normalizeCatalogEntry(item as PackageCatalogEntry, `${root}/`, opts), item as CatalogIndexEntry)
    return catalogEntry(item as CatalogIndexEntry, root, opts)
  })
  return {
    base: root,
    entries,
    async load(entry) {
      const item = typeof entry === "string" ? entries.find(e => e.identityKey === entry || e.sourceKey === entry || e.id === entry || e.name === entry) : entry
      if (!item) throw new Error(`catalog: unknown eikon "${entry}"`)
      return (await loadRuntimeArtifact(item, fetcher, { allowPrivate: opts.allowPrivate })).text
    },
  }
}
