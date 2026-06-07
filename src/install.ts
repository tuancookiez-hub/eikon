// eikon install resolver — the one shared entry point for obtaining an
// eikon from any of: bare catalog name, git URL, local directory, or
// http(s) manifest base URL. Pure wrt host state: caller supplies
// destRoot; no hermes-home, no prefs, no console.
//
// Writes `manifest.json` at the destination with an `origin` block so
// `update` and profile-distribution can detect local edits.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync, readdirSync, lstatSync } from "node:fs"
import { join, extname, basename, dirname } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { STATES, FORMAT_VERSION, DEFAULT_CATALOG, type State } from "./ui/spec"
import { loadCatalogEntries, normalizeCatalogEntry } from "./catalog"
import { PACKAGE_KIND, type CatalogEntry, type EikonPackageManifest } from "./contract/shape"
import { validatePackageManifest, isSafeRelativePath } from "./package/manifest"
import { parseLaunchStream } from "./stream"
import type { Manifest } from "./ui/lint"

export type Role = State | "base"
export type Sources = Partial<Record<Role, string>>
export const TRUST_STATES = ["verified", "unverified", "mismatch"] as const
export type TrustState = typeof TRUST_STATES[number]
export type TrustResult = { state: TrustState; reason?: string; verified?: string[] }
export type SourceKind = "default-catalog" | "catalog-package" | "github-catalog" | "github-package" | "local" | "legacy"
export type Origin = {
  source: string
  at: string
  sha?: string
  kind?: SourceKind
  sourceKey?: string
  identityKey?: string
  packageUrl?: string
  repo?: string
  selector?: string
  catalogRoot?: string
}

export type Resolved = {
  name: string
  manifest: Manifest | EikonPackageManifest
  /** Local dir where manifest.json + any staged media live. */
  staged: string
  /** When staged came from an http base (no local tree). */
  base?: string
  /** Staged is a clone-owned tempdir; install() rm's it after copy. */
  tmp?: boolean
  origin: Origin
  trust: TrustResult
}

export type Installed = Resolved & { dir: string; sources: Sources; n: number; bytes: number }

export type CloneResult = { dir: string; sha?: string; cleanup?: boolean }
export type CloneBackend = (cloneUrl: string, dst: string) => Promise<CloneResult>
export type DownloadOptions = {
  allowPrivate?: boolean
  maxBytes?: number
  maxRedirects?: number
  fetcher?: (input: string | URL | Request, init?: RequestInit) => Promise<Response>
}

export type Opts = {
  name?: string
  /** Fetch source media into <dest>/source/. Default true. */
  media?: boolean
  catalog?: string
  progress?: (done: number, total: number) => void
  clone?: CloneBackend
  downloader?: DownloadOptions
}

export type GithubSource = { owner: string; repo: string; selector?: string; cloneUrl: string; display: string }

const sha256 = (data: string | Uint8Array) => `sha256:${createHash("sha256").update(data).digest("hex")}`
const cleanUrl = (raw: string) => {
  try {
    const u = new URL(raw)
    if (u.username || u.password) return `${u.protocol}//[redacted]@${u.host}${u.pathname}${u.search}${u.hash}`
    return u.href
  } catch { return raw.replace(/\/\/[^/@\s]+@/, "//[redacted]@") }
}

function privateIpv4(a: number, b: number) {
  if (a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function privateHost(host: string) {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (["localhost", "127.0.0.1", "0.0.0.0", "::1"].includes(h)) return true
  if (h.endsWith(".localhost")) return true
  const ip = h.match(/^(\d+)\.(\d+)\./)
  if (ip && privateIpv4(Number(ip[1]), Number(ip[2]))) return true
  if (h.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(h)) return true
  return false
}

function assertDownloadUrl(raw: string, opts: DownloadOptions) {
  const url = new URL(raw)
  if (url.protocol !== "https:" && url.protocol !== "http:") throw new Error(`download URL must use https: ${cleanUrl(raw)}`)
  if (url.username || url.password) throw new Error(`download URL cannot include credentials: ${cleanUrl(raw)}`)
  if (!opts.allowPrivate && privateHost(url.hostname)) throw new Error(`download URL cannot use private host: ${url.hostname}`)
  if (url.protocol === "http:" && !privateHost(url.hostname)) throw new Error(`download URL must use https: ${cleanUrl(raw)}`)
  return url
}

export async function downloadBytes(raw: string, opts: DownloadOptions = {}): Promise<Uint8Array> {
  const fetcher = opts.fetcher ?? fetch
  const maxBytes = opts.maxBytes ?? 100 * 1024 * 1024
  const maxRedirects = opts.maxRedirects ?? 5
  let url = assertDownloadUrl(raw, opts)
  for (let i = 0; i <= maxRedirects; i++) {
    const res = await fetcher(url.href, { redirect: "manual" })
    if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
      url = assertDownloadUrl(new URL(res.headers.get("location")!, url).href, opts)
      continue
    }
    if (!res.ok) throw new Error(`download failed ${res.status}: ${cleanUrl(url.href)}`)
    const len = Number(res.headers.get("content-length") ?? 0)
    if (len > maxBytes) throw new Error(`download byte limit exceeded: ${cleanUrl(url.href)}`)
    const buf = new Uint8Array(await res.arrayBuffer())
    if (buf.length > maxBytes) throw new Error(`download byte limit exceeded: ${cleanUrl(url.href)}`)
    return buf
  }
  throw new Error(`download redirect limit exceeded: ${cleanUrl(raw)}`)
}

function safeSelector(selector: string | undefined) {
  if (!selector) return undefined
  if (/[\u0000-\u001f\u007f]|%|\\/.test(selector)) throw new Error("unsafe selector")
  if (selector.split("/").some(p => !p || p === "." || p === ".." || p.startsWith("-"))) throw new Error("unsafe selector")
  const parts = selector.split("/")
  if (parts.length > 2 || parts.some(p => !/^[A-Za-z0-9._-]+$/.test(p))) throw new Error("unsafe selector")
  return selector
}

export function resolveGithubSource(raw: string): GithubSource {
  if (/[\u0000\r\n]/.test(raw)) throw new Error("unsafe GitHub source")
  let owner: string | undefined, repo: string | undefined, rest = ""
  let m = raw.match(/^github\.com\/([^/]+)\/([^/]+)(?:\/(.+))?$/)
  if (m) { owner = m[1]; repo = m[2]; rest = m[3] ?? "" }
  m = raw.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?(?:\/(.+))?$/)
  if (!owner && m) { owner = m[1]; repo = m[2]; rest = m[3] ?? "" }
  m = raw.match(/^git@github\.com:([^/]+)\/([^/]+?)(?:\.git)?(?:\/(.+))?$/)
  if (!owner && m) { owner = m[1]; repo = m[2]; rest = m[3] ?? "" }
  if (!owner || !repo) throw new Error("only github.com repository sources are supported")
  repo = repo.replace(/\.git$/, "")
  if (![owner, repo].every(p => /^[A-Za-z0-9._-]+$/.test(p)) || owner.startsWith("-") || repo.startsWith("-")) throw new Error("unsafe GitHub repository")
  const selector = safeSelector(rest.replace(/^\/+/, "") || undefined)
  return { owner, repo, selector, cloneUrl: `https://github.com/${owner}/${repo}.git`, display: `github.com/${owner}/${repo}${selector ? `/${selector}` : ""}` }
}

/** Role-tagged (role, relpath) pairs from either manifest shape. */
export function entries(man: Manifest | Record<string, unknown>): Array<[Role, string]> {
  if ((man as Record<string, unknown>).kind === PACKAGE_KIND) {
    const pkg = validatePackageManifest(man)
    const xs: Array<[Role, string]> = []
    if (pkg.source?.base) xs.push(["base", pkg.source.base])
    for (const k of STATES) {
      const f = pkg.source?.states?.[k]?.file
      if (f) xs.push([k, f])
    }
    return xs
  }
  const xs: Array<[Role, string]> = []
  const src = (man as Manifest).source
  if (typeof src === "string") xs.push(["base", src])
  const st = (man as Manifest).states as Record<string, { file?: string }> | undefined
  if (st) for (const k of STATES) { const f = st[k]?.file; if (f) xs.push([k, f]) }
  if (xs.length === 0 && Array.isArray((man as Record<string, unknown>).files))
    for (const f of (man as { files: unknown[] }).files) {
      if (typeof f !== "string") continue
      const stem = basename(f, extname(f)).toLowerCase() as Role
      xs.push([stem === "base" || (STATES as readonly string[]).includes(stem) ? stem : "base", f])
    }
  return xs
}

function manifest(value: unknown): Manifest | EikonPackageManifest {
  if ((value as Record<string, unknown>).kind === PACKAGE_KIND) return validatePackageManifest(value)
  return value as Manifest
}

function installManifest(man: Manifest | EikonPackageManifest, origin: Origin): Manifest | EikonPackageManifest {
  const { license: _license, provenance: _provenance, ...clean } = man as Record<string, unknown>
  return { ...clean, origin } as Manifest | EikonPackageManifest
}

const gitish = (s: string) => {
  if (/^(?:github\.com|https:\/\/github\.com|git@github\.com:)/.test(s)) return true
  return /^git@|^ssh:\/\/|^git:\/\/|\.git$/.test(s) || /^(https?:\/\/)?(gitlab|bitbucket)\.com\/[\w.-]+\/[\w.-]+\/?$/.test(s)
}

async function defaultClone(url: string, dst: string): Promise<CloneResult> {
  const source = resolveGithubSource(url)
  const p = Bun.spawn(["git", "clone", "--depth", "1", "--", source.cloneUrl, dst], { stdout: "pipe", stderr: "pipe" })
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
  if (code !== 0) throw new Error(`git clone failed: ${err.trim()}`)
  const sha = await new Response(Bun.spawn(["git", "-C", dst, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout).text()
  rmSync(join(dst, ".git"), { recursive: true, force: true })
  return { dir: dst, sha: sha.trim() || undefined, cleanup: true }
}

function readJson(path: string) {
  return JSON.parse(readFileSync(path, "utf8")) as unknown
}

function asPackageIndex(value: unknown): { versions?: Array<{ version?: string; manifest?: string }> } | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined
  const raw = value as { versions?: unknown }
  if (!Array.isArray(raw.versions)) return undefined
  return raw as { versions?: Array<{ version?: string; manifest?: string }> }
}

function latestPackageFromIndex(path: string) {
  const idx = asPackageIndex(readJson(path))
  const rel = idx?.versions?.at(-1)?.manifest
  if (!rel || !isSafeRelativePath(rel)) throw new Error(`${path}: package index has no safe manifest path`)
  return join(dirname(path), rel)
}

function catalogMatches(entry: CatalogEntry, selector: string) {
  const slug = selector.split("/").at(-1)!
  const keys = [entry.id, entry.name, entry.sourceKey, entry.packageUrl.split("/packages/").at(-1)?.replace(/\/[^/]+\.json$/, "")]
  return keys.some(key => key === selector || key === slug || key?.endsWith(`/${selector}`) || key?.endsWith(`/${slug}`))
}

function packageResolution(repo: string, selector: string): { manifest: EikonPackageManifest; staged: string; root: string } | undefined {
  const parts = selector.split("/")
  if (parts.length === 2) {
    const idx = join(repo, "packages", parts[0]!, parts[1]!, "index.json")
    if (!existsSync(idx)) return undefined
    const path = latestPackageFromIndex(idx)
    return { manifest: manifest(readJson(path)) as EikonPackageManifest, staged: dirname(path), root: `packages/${parts[0]}/${parts[1]}/index.json` }
  }
  const matches: string[] = []
  const packages = join(repo, "packages")
  if (existsSync(packages)) for (const ns of readdirSync(packages, { withFileTypes: true })) {
    if (!ns.isDirectory()) continue
    const idx = join(packages, ns.name, selector, "index.json")
    if (existsSync(idx)) matches.push(idx)
  }
  if (matches.length > 1) throw new Error(`ambiguous package selector "${selector}"; use namespace/name`)
  if (!matches.length) return undefined
  const path = latestPackageFromIndex(matches[0]!)
  const ns = basename(dirname(dirname(path)))
  return { manifest: manifest(readJson(path)) as EikonPackageManifest, staged: dirname(path), root: `packages/${ns}/${selector}/index.json` }
}

export function resolvePackageIndex(repo: string, selector: string) {
  return packageResolution(repo, selector)
}

function catalogResolution(repo: string, selector: string): { entry: CatalogEntry; manifest: EikonPackageManifest; staged: string; root: string } | undefined {
  for (const root of ["eikons/index.json", "registry.json", "index.json"]) {
    const path = join(repo, root)
    if (!existsSync(path)) continue
    const raw = readJson(path)
    if (!Array.isArray(raw)) continue
    const entries = raw.map(item => {
      const any = item as { packageUrl?: string; package_url?: string }
      if (any.packageUrl?.startsWith("../") || any.package_url?.startsWith("../")) {
        const rel = any.packageUrl ?? any.package_url!
        return normalizeCatalogEntry({ ...(item as object), packageUrl: `https://github.local/${rel.replace(/^\.\.\//, "")}` } as never, "https://github.local/")
      }
      return normalizeCatalogEntry(item as never, "https://github.local/")
    })
    const matches = entries.filter(entry => catalogMatches(entry, selector))
    if (matches.length > 1) throw new Error(`ambiguous catalog selector "${selector}"`)
    if (!matches.length) continue
    const entry = matches[0]!
    let pkgPath: string
    const url = new URL(entry.packageUrl)
    pkgPath = join(repo, url.pathname.replace(/^\//, ""))
    if (!existsSync(pkgPath)) pkgPath = join(dirname(path), entry.packageUrl)
    return { entry, manifest: manifest(readJson(pkgPath)) as EikonPackageManifest, staged: dirname(pkgPath), root }
  }
  return undefined
}

function trustFor(man: Manifest | EikonPackageManifest, staged: string, base?: string): TrustResult {
  if ((man as Record<string, unknown>).kind !== PACKAGE_KIND) return { state: "unverified", reason: "legacy manifest has no package descriptors" }
  const pkg = validatePackageManifest(man)
  const files = pkg.files ?? []
  if (!files.length) return { state: "unverified", reason: "package descriptors missing" }
  const missing = files.filter(file => !file.digest || typeof file.size !== "number")
  if (missing.length) return { state: "unverified", reason: "package descriptor digest or size missing" }
  if (base) return { state: "unverified", reason: "remote package files not downloaded yet" }
  return verifyPackageFiles(pkg, staged)
}

async function verifyRemotePackageFiles(pkg: EikonPackageManifest, base: string, opts: DownloadOptions): Promise<{ trust: TrustResult; files?: Map<string, Uint8Array> }> {
  const files = pkg.files ?? []
  if (!files.length) return { trust: { state: "unverified", reason: "package descriptors missing" } }
  const missing = files.filter(file => !file.digest || typeof file.size !== "number")
  if (missing.length) return { trust: { state: "unverified", reason: "package descriptor digest or size missing" } }
  const verified: string[] = []
  const data = new Map<string, Uint8Array>()
  for (const file of files) {
    if (!isSafeRelativePath(file.path)) throw new Error(`mismatch: unsafe descriptor path ${file.path}`)
    const buf = await downloadBytes(new URL(file.path, base).href, opts)
    if (typeof file.size === "number" && buf.length !== file.size) throw new Error(`mismatch: size ${file.path}`)
    if (file.digest && sha256(buf) !== file.digest) throw new Error(`mismatch: digest ${file.path}`)
    data.set(file.path, buf)
    verified.push(file.path)
  }
  return { trust: { state: "verified", verified }, files: data }
}

export function verifyPackageFiles(pkg: EikonPackageManifest, staged: string): TrustResult {
  const verified: string[] = []
  for (const file of pkg.files ?? []) {
    if (!isSafeRelativePath(file.path)) throw new Error(`mismatch: unsafe descriptor path ${file.path}`)
    const path = join(staged, file.path)
    const stat = lstatSync(path)
    if (stat.isSymbolicLink() || !stat.isFile()) throw new Error(`mismatch: symlink or special file ${file.path}`)
    const data = readFileSync(path)
    if (typeof file.size === "number" && data.length !== file.size) throw new Error(`mismatch: size ${file.path}`)
    if (file.digest && sha256(data) !== file.digest) throw new Error(`mismatch: digest ${file.path}`)
    if (file.digest && typeof file.size === "number") verified.push(file.path)
  }
  return verified.length ? { state: "verified", verified } : { state: "unverified", reason: "package descriptor digest or size missing" }
}

/** Find a manifest.json at root or exactly one level deep. */
function locate(dir: string): string {
  if (existsSync(join(dir, "manifest.json"))) return dir
  for (const e of readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory() && existsSync(join(dir, e.name, "manifest.json")))
      return join(dir, e.name)
  throw new Error(`no manifest.json in ${dir} (or one level deep)`)
}

function checkRequires(spec: string | undefined): void {
  if (!spec) return
  const m = spec.match(/^\s*(>=|>|<=|<|==|=)?\s*(\d+)/)
  if (!m) return
  const [, op = ">=", v] = m
  const n = Number(v), cur = FORMAT_VERSION
  const ok = op === ">=" ? cur >= n : op === ">" ? cur > n
           : op === "<=" ? cur <= n : op === "<" ? cur < n : cur === n
  if (!ok) throw new Error(`eikon_requires ${spec}: this build supports format ${cur}`)
}

async function catalog(name: string, url: string, opts: Pick<Opts, "downloader"> = {}): Promise<CatalogEntry> {
  const base = url.replace(/\/?$/, "/")
  const entries = await loadCatalogEntries(base)
  const entry = entries.find(e => e.name === name || e.id === name || e.sourceKey === name)
  if (!entry) throw new Error(`catalog: no eikon named "${name}"`)
  return entry
}

async function resolvePackageUrl(entry: CatalogEntry, opts: Pick<Opts, "downloader"> = {}): Promise<Resolved> {
  const at = new Date().toISOString()
  const bytes = await downloadBytes(entry.packageUrl, opts.downloader ?? (/^http:\/\/localhost[:/]/.test(entry.packageUrl) ? { allowPrivate: true } : undefined))
  const man = manifest(JSON.parse(new TextDecoder().decode(bytes)))
  const base = new URL(".", entry.packageUrl).href
  return {
    name: man.name,
    manifest: man,
    staged: "",
    base,
    origin: { source: entry.packageUrl, at, kind: "default-catalog", sourceKey: entry.sourceKey, identityKey: entry.sourceKey || entry.id, packageUrl: entry.packageUrl },
    trust: trustFor(man, "", base),
  }
}

export async function resolve(src: string, opts: Pick<Opts, "catalog" | "clone" | "downloader"> = {}): Promise<Resolved> {
  const at = new Date().toISOString()

  if (!/[\/:]/.test(src)) return resolvePackageUrl(await catalog(src, opts.catalog ?? DEFAULT_CATALOG, opts), opts)

  const local = src.replace(/^file:\/\//, "")
  if (!gitish(src) && existsSync(local) && statSync(local).isDirectory()) {
    const staged = locate(local)
    const man = manifest(JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8")))
    return { name: man.name, manifest: man, staged, origin: { source: src, at, kind: "local" }, trust: trustFor(man, staged) }
  }

  if (gitish(src)) {
    let gh: GithubSource | undefined
    try { gh = resolveGithubSource(src) } catch {
      if (existsSync(src)) {
        const tmp = mkdtempSync(join(tmpdir(), "eikon-"))
        const p = Bun.spawn(["git", "clone", "--depth", "1", "--", src, tmp], { stdout: "pipe", stderr: "pipe" })
        const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
        if (code !== 0) throw new Error(`git clone failed: ${err.trim()}`)
        const sha = await new Response(Bun.spawn(["git", "-C", tmp, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout).text()
        rmSync(join(tmp, ".git"), { recursive: true, force: true })
        const staged = locate(tmp)
        const man = manifest(JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8")))
        return { name: man.name, manifest: man, staged, tmp: true, origin: { source: src, at, kind: "github-package", sha: sha.trim() || undefined }, trust: trustFor(man, staged) }
      }
      throw new Error("only github.com repository sources are supported")
    }
    const tmp = mkdtempSync(join(tmpdir(), "eikon-"))
    const cloned = await (opts.clone ?? defaultClone)(gh.cloneUrl, tmp)
    const repo = cloned.dir
    if (gh.selector) {
      const selected = catalogResolution(repo, gh.selector)
      if (selected) return {
        name: selected.manifest.name,
        manifest: selected.manifest,
        staged: selected.staged,
        tmp: cloned.cleanup !== false,
        origin: { source: src, at, kind: "github-catalog", sha: cloned.sha, repo: gh.display, selector: gh.selector, catalogRoot: selected.root, sourceKey: selected.entry.sourceKey, identityKey: selected.entry.sourceKey || selected.entry.id, packageUrl: selected.entry.packageUrl },
        trust: trustFor(selected.manifest, selected.staged),
      }
      const indexed = packageResolution(repo, gh.selector)
      if (indexed) return {
        name: indexed.manifest.name,
        manifest: indexed.manifest,
        staged: indexed.staged,
        tmp: cloned.cleanup !== false,
        origin: { source: src, at, kind: "github-catalog", sha: cloned.sha, repo: gh.display, selector: gh.selector, catalogRoot: indexed.root },
        trust: trustFor(indexed.manifest, indexed.staged),
      }
      throw new Error(`no eikon named "${gh.selector}" in GitHub catalog`)
    }
    const staged = locate(repo)
    const man = manifest(JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8")))
    return { name: man.name, manifest: man, staged, tmp: cloned.cleanup !== false, origin: { source: src, at, kind: "github-package", sha: cloned.sha, repo: gh.display }, trust: trustFor(man, staged) }
  }

  if (/^https?:\/\//.test(src)) {
    const raw = new URL(src)
    const href = raw.pathname.endsWith(".json") ? raw.href : new URL("manifest.json", src.replace(/\/?$/, "/")).href
    const base = new URL(".", href).href
    const bytes = await downloadBytes(href, opts.downloader ?? (/^http:\/\/localhost[:/]/.test(href) ? { allowPrivate: true } : undefined))
    const man = manifest(JSON.parse(new TextDecoder().decode(bytes)))
    return { name: man.name, manifest: man, staged: "", base, origin: { source: src, at, kind: "catalog-package", packageUrl: href }, trust: trustFor(man, "", base) }
  }

  throw new Error(`cannot resolve "${src}": expected catalog name, git URL, local dir, or http(s) base`)
}

const peeked = new Map<string, Promise<{ n: number; bytes: number } | undefined>>()

/** HEAD the manifest's referenced files; memoized per src. */
export function peek(src: string, opts?: Pick<Opts, "catalog" | "downloader">): Promise<{ n: number; bytes: number } | undefined> {
  const hit = peeked.get(src)
  if (hit) return hit
  const p = resolve(src, opts).then(async r => {
    const xs = entries(r.manifest)
    if (r.base) {
      const sizes = await Promise.all(xs.map(([, rel]) =>
        fetch(new URL(rel, r.base).href, { method: "HEAD" })
          .then(h => Number(h.headers.get("content-length") ?? 0)).catch(() => 0)))
      return { n: xs.length, bytes: sizes.reduce((a, b) => a + b, 0) }
    }
    const bytes = xs.reduce((a, [, rel]) => {
      const p = join(r.staged, rel)
      return a + (existsSync(p) ? statSync(p).size : 0)
    }, 0)
    return { n: xs.length, bytes }
  }).catch(() => undefined)
  peeked.set(src, p)
  return p
}

export async function install(src: string, root: string, opts: Opts = {}): Promise<Installed> {
  const r = await resolve(src, opts)
  checkRequires((r.manifest as Manifest & { eikon_requires?: string }).eikon_requires)
  const name = opts.name ?? r.name
  const dst = join(root, name)
  const srcd = join(dst, "source")
  try {
    let remote: Awaited<ReturnType<typeof verifyRemotePackageFiles>> | undefined
    let launchText: string | undefined
    if ((r.manifest as Record<string, unknown>).kind === PACKAGE_KIND) {
      const man = validatePackageManifest(r.manifest)
      const dl: DownloadOptions = opts.downloader ?? (/^http:\/\/localhost[:/]/.test(r.base ?? "") ? { allowPrivate: true } : {})
      if (r.base) remote = await verifyRemotePackageFiles(man, r.base, dl)
      else if (r.staged) verifyPackageFiles(man, r.staged)
      const rel = man.entrypoints.default
      if (r.base) {
        const entry = remote?.files?.get(rel) ?? await downloadBytes(new URL(rel, r.base).href, dl)
        launchText = new TextDecoder().decode(entry)
      } else {
        launchText = readFileSync(join(r.staged, rel), "utf8")
      }
      parseLaunchStream(launchText)
      if (remote) r.trust = remote.trust
    }

    mkdirSync(srcd, { recursive: true })

    if (launchText) writeFileSync(join(dst, `${name}.eikon`), launchText)

    // The packed .eikon travels when present in the source.
    const packed = `${r.name}.eikon`
    if (r.staged && existsSync(join(r.staged, packed)))
      copyFileSync(join(r.staged, packed), join(dst, `${name}.eikon`))

    const xs = entries(r.manifest)
    const sources: Sources = {}
    let done = 0, bytes = 0
    const tick = () => opts.progress?.(++done, xs.length)

    if (opts.media !== false) await Promise.all(xs.map(async ([role, rel]) => {
      const fname = `${role}${extname(rel).toLowerCase()}`
      const to = join(srcd, fname)
      if (r.base) {
        const dl: DownloadOptions = opts.downloader ?? (/^http:\/\/localhost[:/]/.test(r.base) ? { allowPrivate: true } : {})
        const buf = remote?.files?.get(rel) ?? await downloadBytes(new URL(rel, r.base).href, dl)
        await Bun.write(to, buf); bytes += buf.length
      } else {
        const from = join(r.staged, rel)
        if (!existsSync(from)) throw new Error(`${rel}: missing in ${r.staged}`)
        copyFileSync(from, to); bytes += statSync(to).size
      }
      sources[role] = fname; tick()
    }))

    const out = installManifest(r.manifest, r.origin)
    writeFileSync(join(dst, "manifest.json"), JSON.stringify(out, null, 2) + "\n")

    if (r.tmp) rmSync(r.staged, { recursive: true, force: true })

    return { ...r, name, dir: dst, sources, n: xs.length, bytes }
  } catch (err) {
    rmSync(dst, { recursive: true, force: true })
    if (r.tmp) rmSync(r.staged, { recursive: true, force: true })
    throw err
  }
}

/** True if <dir> looks locally modified since install (coarse: any
 *  file mtime > origin.at). */
export function dirty(dir: string): boolean {
  const mf = join(dir, "manifest.json")
  if (!existsSync(mf)) return false
  const man = JSON.parse(readFileSync(mf, "utf8")) as Manifest & { origin?: Origin }
  if (!man.origin?.at) return false
  const since = Date.parse(man.origin.at)
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true }) as Array<{ name: string; parentPath: string }>)
    if (statSync(join(e.parentPath ?? dir, e.name)).mtimeMs > since + 2000) return true
  return false
}
