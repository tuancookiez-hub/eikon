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
export type CatalogIndexEntry = CatalogEntry
export type PublicCatalogEntry = CatalogEntry & {
  identityKey: string
  trust: CatalogTrust & NonNullable<CatalogEntry["trust"]>
}
export type Catalog = {
  base: string
  entries: PublicCatalogEntry[]
  load: (entry: PublicCatalogEntry | string) => Promise<string>
}
export type CatalogInput = CatalogEntry | PackageCatalogEntry

type PackageCatalogEntry = {
  manifest: EikonPackageManifest
  packageUrl: string
  sourceKey?: string
  detailUrl?: string
}
type Fetcher = (input: string | URL | Request, init?: RequestInit) => Promise<Response>
export type RuntimeArtifact = { bytes: Uint8Array; text: string }

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const PRIVATE_HOSTS = new Set(["localhost", "127.0.0.1", "0.0.0.0", "::1"])
const SHA256_RE = /^sha256:[a-f0-9]{64}$/
const BLOB_RE = /\/blobs\/sha256\/([a-f0-9]{64})(?:\.eikon)?$/
const encodings = new Set<RuntimeEncoding>(["identity", "gzip"])
const trimSlash = (s: string) => s.replace(/\/$/, "")
const slash = (s: string) => s.replace(/\/?$/, "/")
const problem = (path: string, message: string) => ({ code: "catalog", path, message: `${path}: ${message}` })
const text = (value: unknown) => typeof value === "string" && !/[<>\u0000-\u001f]/.test(value)
const block = (value: unknown) => typeof value !== "string" || (value.length <= 8192 && !/[\u0000-\u0008\u000b-\u001f\u007f-\u009f]/.test(value))
const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const size = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const digest = (value: unknown) => typeof value === "string" && SHA256_RE.test(value)
const allowed = new Set(["kind", "schemaVersion", "id", "version", "sourceKey", "name", "title", "author", "description", "glyph", "tags", "poster", "runtimeUrl", "packageUrl", "detailUrl", "compatibility", "trust"])
const trustKeys = new Set(["manifestDigest", "runtimeDigest", "runtimeSize", "runtimeEncoding", "runtimeDecodedSize", "runtimeDecodedDigest"])

const defined = <T extends Record<string, unknown>>(obj: T) => Object.fromEntries(Object.entries(obj).filter(([, value]) => value !== undefined)) as Partial<T>

function decode(raw: string): string {
  try { return decodeURIComponent(raw) }
  catch { return raw }
}

function pathEscape(raw: string): boolean {
  const all = [raw, decode(raw)]
  return all.some(value => /[\\]/.test(value)
    || /[\u0000-\u001f\u007f]/.test(value)
    || value.split(/[?#]/, 1)[0]?.split(/[\\/]/).some(part => part === ".."))
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
  if (out.username || out.password) throw new Error("public catalog URL cannot include credentials")
  if (pathEscape(raw) || out.pathname.split("/").some(p => p === "..")) throw new Error("public catalog URL path escape")
  if (opts.allowPrivate && out.protocol === "file:") return out.href
  if (out.protocol !== "https:" && out.protocol !== "http:") throw new Error("public catalog URL must use http(s)")
  if (!opts.allowPrivate && privateHost(out.hostname)) throw new Error(`public catalog URL cannot use private host: ${out.hostname}`)
  if (out.protocol === "http:" && !privateHost(out.hostname)) throw new Error("public catalog URL must use https")
  return out.href
}

function safe(raw: string, field: string, base?: string, opts: CatalogOptions = {}): string {
  try { return publicCatalogUrl(raw, base, opts) }
  catch (err) { throw new EikonValidationError([problem(field, err instanceof Error ? err.message : String(err))]) }
}

function rel(base: string, path?: string, field = "path", opts: CatalogOptions = {}): string | undefined {
  if (!path) return undefined
  if (/^https?:\/\//.test(path)) return safe(path, field, undefined, opts)
  if (!isSafeRelativePath(path)) throw new EikonValidationError([problem(field, "safe relative path required")])
  return new URL(path, slash(base)).toString()
}

function blob(value: string): string | undefined {
  const m = new URL(value).pathname.match(BLOB_RE)
  return m ? `sha256:${m[1]}` : undefined
}

function runtimeUrl(value: string): boolean {
  const path = new URL(value).pathname
  return path.endsWith(".eikon") || BLOB_RE.test(path)
}

function runtimePath(man: EikonPackageManifest): string {
  return man.entrypoints.default
}

function runtimeDescriptor(man: EikonPackageManifest) {
  return man.files?.find(file => file.role === "runtime" && file.path === runtimePath(man))
}

function desc(man: EikonPackageManifest, path: string): string | undefined {
  return man.files?.find(file => file.path === path)?.digest
}

function publicFromEntry(entry: CatalogEntry): PublicCatalogEntry {
  return {
    ...entry,
    trust: entry.trust ?? {},
    poster: entry.poster ?? "",
    identityKey: entry.sourceKey || entry.id,
  }
}

function runtimeDesc(entry: CatalogEntry): RuntimeDescriptor | undefined {
  const trust = entry.trust
  const runtimeDigest = trust?.runtimeDigest ?? blob(entry.runtimeUrl)
  if (!runtimeDigest && !trust?.runtimeSize && !trust?.runtimeEncoding && !trust?.runtimeDecodedSize && !trust?.runtimeDecodedDigest) return undefined
  return {
    digest: runtimeDigest,
    size: trust?.runtimeSize,
    encoding: trust?.runtimeEncoding,
    decodedSize: trust?.runtimeDecodedSize,
    decodedDigest: trust?.runtimeDecodedDigest,
  }
}

function assertArtifactHeaders(res: Response, entry: CatalogEntry): void {
  const enc = res.headers.get("content-encoding")
  if (enc && enc.toLowerCase() !== "identity" && (entry.trust?.runtimeDigest || blob(entry.runtimeUrl)))
    throw new Error(`catalog: runtime artifact must be served without Content-Encoding: ${enc}`)
}

export async function loadRuntimeArtifact(entry: CatalogEntry, fetcher: Fetcher = fetch, opts: { maxBytes?: number; signal?: AbortSignal } = {}): Promise<RuntimeArtifact> {
  const out = await fetcher(entry.runtimeUrl, opts.signal ? { signal: opts.signal } : undefined)
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
  const pkg = safe(input.packageUrl, "packageUrl", root, opts)
  const base = pkg.slice(0, pkg.lastIndexOf("/") + 1)
  const runtime = runtimePath(man)
  const file = runtimeDescriptor(man)
  const run = rel(base, runtime, "runtimeUrl", opts)!
  const trust = defined({
    manifestDigest: desc(man, "manifest.json"),
    runtimeDigest: file?.digest,
    runtimeSize: file?.size,
    runtimeEncoding: file?.encoding,
    runtimeDecodedSize: file?.decodedSize,
    runtimeDecodedDigest: file?.decodedDigest,
  }) as CatalogTrust
  return validateCatalogEntry({
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: man.id,
    version: man.version,
    sourceKey: input.sourceKey ?? `registry:${new URL(pkg).host}:${man.id}${man.version ? `@${man.version}` : ""}`,
    name: man.name,
    ...defined({
      title: man.display?.title,
      author: man.display?.author,
      description: man.display?.description,
      glyph: man.display?.glyph,
      tags: man.display?.tags,
      poster: rel(base, man.poster, "poster", opts),
      detailUrl: input.detailUrl ? safe(input.detailUrl, "detailUrl", base, opts) : undefined,
    }),
    runtimeUrl: run,
    packageUrl: pkg,
    compatibility: { eikon: man.compatibility.eikon, hosts: man.compatibility.hosts, available: true },
    ...(Object.keys(trust).length ? { trust } : {}),
  }, opts)
}

export function validateCatalogEntry(entry: CatalogEntry, opts: CatalogOptions = {}): CatalogEntry {
  const errs = []
  const raw = entry as unknown as Record<string, unknown>
  for (const key of Object.keys(raw)) {
    if (!allowed.has(key)) errs.push(problem(key, "unsupported catalog field"))
  }
  if (entry.kind !== CATALOG_KIND) errs.push(problem("kind", `must be ${CATALOG_KIND}`))
  if (entry.schemaVersion !== CATALOG_SCHEMA_VERSION) errs.push(problem("schemaVersion", `must be ${CATALOG_SCHEMA_VERSION}`))
  if (!NAME_RE.test(entry.name)) errs.push(problem("name", "safe catalog name required"))
  for (const [key, value] of Object.entries({ id: entry.id, sourceKey: entry.sourceKey, title: entry.title, author: entry.author, description: entry.description, glyph: entry.glyph })) {
    if (value != null && !text(value)) errs.push(problem(key, "unsafe text"))
  }
  if (entry.tags?.some(tag => !text(tag))) errs.push(problem("tags", "unsafe text"))
  if (!block(entry.poster)) errs.push(problem("poster", "safe poster text required"))
  try { safe(entry.packageUrl, "packageUrl", undefined, opts) } catch (err) { if (err instanceof EikonValidationError) errs.push(...err.problems); else errs.push(problem("packageUrl", String(err))) }
  try { safe(entry.runtimeUrl, "runtimeUrl", undefined, opts) } catch (err) { if (err instanceof EikonValidationError) errs.push(...err.problems); else errs.push(problem("runtimeUrl", String(err))) }
  if (entry.detailUrl) try { safe(entry.detailUrl, "detailUrl", undefined, opts) } catch (err) { if (err instanceof EikonValidationError) errs.push(...err.problems); else errs.push(problem("detailUrl", String(err))) }
  if (entry.runtimeUrl) {
    try { if (!runtimeUrl(entry.runtimeUrl)) errs.push(problem("runtimeUrl", "must point at launch .eikon stream or content-addressed blob")) }
    catch { errs.push(problem("runtimeUrl", "http(s) URL required")) }
  }
  const trust = entry.trust
  for (const key of Object.keys(trust ?? {})) {
    if (!trustKeys.has(key)) errs.push(problem(`trust.${key}`, "unsupported trust field"))
  }
  if (trust?.manifestDigest != null && !digest(trust.manifestDigest)) errs.push(problem("trust.manifestDigest", "canonical sha256 digest required"))
  if (trust?.runtimeDigest != null && !digest(trust.runtimeDigest)) errs.push(problem("trust.runtimeDigest", "canonical sha256 digest required"))
  if (trust?.runtimeDecodedDigest != null && !digest(trust.runtimeDecodedDigest)) errs.push(problem("trust.runtimeDecodedDigest", "canonical sha256 digest required"))
  if (trust?.runtimeSize != null && !size(trust.runtimeSize)) errs.push(problem("trust.runtimeSize", "non-negative safe integer required"))
  if (trust?.runtimeDecodedSize != null && !size(trust.runtimeDecodedSize)) errs.push(problem("trust.runtimeDecodedSize", "non-negative safe integer required"))
  if (trust?.runtimeEncoding != null && !encodings.has(trust.runtimeEncoding)) errs.push(problem("trust.runtimeEncoding", "unsupported runtime encoding"))
  if (trust?.runtimeEncoding === "gzip") {
    if (!trust.runtimeDigest) errs.push(problem("trust.runtimeDigest", "required for gzip runtime"))
    if (!size(trust.runtimeSize)) errs.push(problem("trust.runtimeSize", "required for gzip runtime"))
    if (!size(trust.runtimeDecodedSize)) errs.push(problem("trust.runtimeDecodedSize", "required for gzip runtime"))
    if (!trust.runtimeDecodedDigest) errs.push(problem("trust.runtimeDecodedDigest", "required for gzip runtime"))
  }
  const pathDigest = entry.runtimeUrl ? blob(entry.runtimeUrl) : undefined
  if (pathDigest && trust?.runtimeDigest && trust.runtimeDigest !== pathDigest) errs.push(problem("trust.runtimeDigest", "must match content-addressed runtimeUrl digest"))
  if (!entry.compatibility?.eikon) errs.push(problem("compatibility.eikon", "required"))
  if (entry.compatibility?.eikon && !/>=?\s*1/.test(entry.compatibility.eikon)) errs.push(problem("compatibility.eikon", "must support launch major version 1"))
  if (errs.length) throw new EikonValidationError(errs)
  return entry
}

export function normalizeCatalogEntry(input: CatalogInput, base?: string, opts: CatalogOptions = {}): CatalogEntry {
  if (!isObj(input)) throw new EikonValidationError([problem("catalog", "catalog entry or package manifest wrapper required")])
  if ("kind" in input && input.kind === CATALOG_KIND) return validateCatalogEntry(input as CatalogEntry, opts)
  if ("manifest" in input) return fromPackage(input as PackageCatalogEntry, base, opts)
  throw new EikonValidationError([problem("catalog", "launch catalog entry or package-backed entry required")])
}

export function catalogEntry(input: CatalogInput, base = DEFAULT_PUBLIC_CATALOG, opts: CatalogOptions = {}): PublicCatalogEntry {
  return publicFromEntry(normalizeCatalogEntry(input, base, opts))
}

export function searchCatalogEntries(entries: readonly CatalogEntry[], query: string): CatalogEntry[] {
  const q = query.trim().toLowerCase()
  if (!q) return [...entries]
  return entries.filter(entry => [entry.name, entry.title, entry.author, entry.description, ...(entry.tags ?? [])].some(value => value?.toLowerCase().includes(q)))
}

export async function loadCatalogEntries(base: string, fetcher: Fetcher = fetch, opts: CatalogOptions = {}): Promise<CatalogEntry[]> {
  const root = trimSlash(publicCatalogUrl(base, undefined, opts))
  const res = await fetcher(`${root}/index.json`)
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
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`)
  const items = await res.json() as unknown
  if (!Array.isArray(items)) throw new EikonValidationError([problem("catalog", "index array required")])
  const entries = items.map(item => publicFromEntry(normalizeCatalogEntry(item as CatalogInput, `${root}/`, opts)))
  return {
    base: root,
    entries,
    async load(entry) {
      const item = typeof entry === "string" ? entries.find(e => e.identityKey === entry || e.sourceKey === entry || e.id === entry || e.name === entry) : entry
      if (!item) throw new Error(`catalog: unknown eikon "${entry}"`)
      return (await loadRuntimeArtifact(item, fetcher)).text
    },
  }
}
