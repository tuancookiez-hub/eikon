import { copyFileSync, cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join, relative } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { DEFAULT_CATALOG } from "./ui/spec"
import { poster } from "./ui/eikon"
import { migrateLegacyEikon } from "./stream/legacy"
import { parseRuntimeFile, decodeRuntimeFile, runtimeDescriptor as runtimeBlob, type ParsedLaunchStream } from "./stream"
import { normalizeCatalogEntry, validateCatalogEntry } from "./catalog"
import {
  LAUNCH_MEDIA_TYPE,
  PACKAGE_KIND,
  type EikonPackageManifest,
  type PackageFileDescriptor,
  type PackageSourceMedia,
  type SignalName,
  type RuntimeEncoding,
} from "./contract/shape"
import { validatePackageManifest } from "./package/manifest"

export type RegistryOptions = {
  root?: string
  base?: string
  encoding?: RuntimeEncoding
}

export type FreshnessResult = { ok: boolean; diffs: string[] }

const root = (opts: RegistryOptions = {}) => {
  if (opts.root) return opts.root
  let d = import.meta.dir
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  return join(d, "eikons")
}
const siteRoot = (opts: RegistryOptions = {}) => dirname(root(opts))
const slash = (s: string) => s.replace(/\/?$/, "/")
const digestHex = (digest: string) => digest.replace(/^sha256:/, "")
const blobRel = (digest: string) => `blobs/sha256/${digestHex(digest)}`

function sha256(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
}

function sha256Bytes(bytes: string | Uint8Array): string {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function mediaType(path: string): string {
  const lower = path.toLowerCase()
  if (lower.endsWith(".eikon")) return LAUNCH_MEDIA_TYPE
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".mp4")) return "video/mp4"
  if (lower.endsWith(".webm")) return "video/webm"
  if (lower.endsWith(".txt")) return "text/plain"
  if (lower.endsWith(".json")) return "application/json"
  return "application/octet-stream"
}

function fileInfo(dir: string, path: string, role: PackageFileDescriptor["role"], signal?: SignalName): PackageFileDescriptor {
  const full = join(dir, path)
  return {
    path,
    role,
    mediaType: role === "runtime" ? LAUNCH_MEDIA_TYPE : mediaType(path),
    size: statSync(full).size,
    digest: sha256(full),
    ...(signal ? { signal } : {}),
  }
}

function localRuntimeInfo(dir: string, path: string, text: string): PackageFileDescriptor {
  const info = fileInfo(dir, path, "runtime")
  const bytes = readFileSync(join(dir, path))
  if (bytes[0] !== 0x1f || bytes[1] !== 0x8b) return info
  const decoded = new TextEncoder().encode(text)
  return {
    ...info,
    encoding: "gzip",
    decodedSize: decoded.length,
    decodedDigest: sha256Bytes(decoded),
  }
}

function registryInfo(file: PackageFileDescriptor): PackageFileDescriptor {
  return {
    ...file,
    path: blobRel(file.digest!),
  }
}

function sourceMedia(man: Record<string, unknown>): PackageSourceMedia | undefined {
  const source: PackageSourceMedia = {}
  if (man.kind === PACKAGE_KIND) {
    const pkg = man as EikonPackageManifest
    if (pkg.source?.base) source.base = pkg.source.base
    if (pkg.source?.states) source.states = pkg.source.states
  } else {
    if (typeof man.source === "string") source.base = man.source
    const states = man.states && typeof man.states === "object" && !Array.isArray(man.states) ? man.states as Record<string, { file?: unknown }> : {}
    for (const [key, value] of Object.entries(states)) {
      if (typeof value.file !== "string") continue
      source.states ??= {}
      source.states[key] = { file: value.file }
    }
  }
  return source.base || source.states ? source : undefined
}

function sourceDescriptors(dir: string, source?: PackageSourceMedia): PackageFileDescriptor[] {
  const out: PackageFileDescriptor[] = []
  if (source?.base && existsSync(join(dir, source.base))) out.push(fileInfo(dir, source.base, "source.base"))
  for (const [signal, value] of Object.entries(source?.states ?? {})) {
    if (!value?.file || !existsSync(join(dir, value.file))) continue
    out.push(fileInfo(dir, value.file, "source.clip", (signal.startsWith("state.") ? signal : `state.${signal}`) as SignalName))
  }
  return out
}

function packageUrl(base: string, id: string, version: string): string {
  const [namespace = "local", name = id] = id.split("/")
  return new URL(`/packages/${namespace}/${name}/${version}.json`, new URL(base)).toString()
}

function detailUrl(base: string, name: string): string {
  return new URL(name, slash(base)).toString()
}

function packageBlobUrl(base: string, id: string, digest: string): string {
  const [namespace = "local", name = id] = id.split("/")
  return new URL(`/packages/${namespace}/${name}/${blobRel(digest)}`, new URL(base)).toString()
}

function stageBlob(pkgDir: string, src: string, digest: string): void {
  const rel = blobRel(digest)
  const local = join(pkgDir, rel)
  mkdirSync(dirname(local), { recursive: true })
  copyFileSync(src, local)
}

function stageBytes(pkgDir: string, bytes: Uint8Array, digest: string): void {
  const rel = blobRel(digest)
  const local = join(pkgDir, rel)
  mkdirSync(dirname(local), { recursive: true })
  writeFileSync(local, bytes)
}

function runtimeInfo(path: string, text: string, encoding: RuntimeEncoding): PackageFileDescriptor & { bytes: Uint8Array } {
  const info = runtimeBlob(text, { encoding })
  return {
    path,
    role: "runtime",
    mediaType: LAUNCH_MEDIA_TYPE,
    size: info.size,
    digest: info.digest,
    ...(encoding === "gzip" ? { encoding: info.encoding, decodedSize: info.decodedSize, decodedDigest: info.decodedDigest } : {}),
    bytes: info.bytes,
  }
}

function registryRuntime(file: PackageFileDescriptor & { bytes: Uint8Array }): PackageFileDescriptor {
  return {
    path: blobRel(file.digest!),
    role: file.role,
    mediaType: file.mediaType,
    size: file.size,
    digest: file.digest,
    ...(file.encoding ? { encoding: file.encoding } : {}),
    ...(file.decodedSize != null ? { decodedSize: file.decodedSize } : {}),
    ...(file.decodedDigest ? { decodedDigest: file.decodedDigest } : {}),
  }
}

function registrySource(source: PackageSourceMedia | undefined, localFiles: PackageFileDescriptor[]): PackageSourceMedia | undefined {
  if (!source) return undefined
  const byPath = new Map(localFiles.map(file => [file.path, blobRel(file.digest!)]))
  const out: PackageSourceMedia = {}
  if (source.base && byPath.has(source.base)) out.base = byPath.get(source.base)
  for (const [signal, value] of Object.entries(source.states ?? {})) {
    if (!value?.file || !byPath.has(value.file)) continue
    out.states ??= {}
    out.states[signal] = { ...value, file: byPath.get(value.file)! }
  }
  return out.base || out.states ? out : undefined
}

function displayFrom(prior: Record<string, unknown>, launch: ParsedLaunchStream, name: string): EikonPackageManifest["display"] {
  const displayPrior = prior.display && typeof prior.display === "object" && !Array.isArray(prior.display) ? prior.display as Record<string, unknown> : {}
  return {
    title: typeof displayPrior.title === "string" ? displayPrior.title : launch.header.title ?? name,
    author: typeof displayPrior.author === "string" ? displayPrior.author : launch.header.author?.name,
    description: typeof displayPrior.description === "string" ? displayPrior.description : launch.header.description,
    glyph: typeof displayPrior.glyph === "string" ? displayPrior.glyph : undefined,
  }
}

export async function index(input: string | RegistryOptions = DEFAULT_CATALOG) {
  const opts = typeof input === "string" ? { base: input } : input
  const base = opts.base ?? DEFAULT_CATALOG
  const dir = root(opts)
  const site = siteRoot(opts)
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const d = join(dir, e.name)
    const manifestPath = join(d, "manifest.json")
    const streamPath = join(d, `${e.name}.eikon`)
    if (!existsSync(manifestPath) || !existsSync(streamPath)) continue
    const local = validatePackageManifest(JSON.parse(readFileSync(manifestPath, "utf8")), { registry: true })
    const versionManifest = join(site, "packages", ...local.id.split("/"), `${local.version ?? "1.0.0"}.json`)
    const man = existsSync(versionManifest)
      ? validatePackageManifest(JSON.parse(readFileSync(versionManifest, "utf8")), { registry: true })
      : local
    const stream = parseRuntimeFile(streamPath)
    const runtime = man.files?.find(file => file.role === "runtime" && file.path === man.entrypoints.default)
    if (!runtime?.digest) throw new Error(`${e.name}: runtime descriptor missing digest`)
    const pkg = packageUrl(base, man.id, man.version ?? "1.0.0")
    const manifestDigest = existsSync(versionManifest) ? sha256(versionManifest) : undefined
    const normalized = normalizeCatalogEntry({ manifest: man, packageUrl: pkg, sourceKey: `registry:${new URL(base).host}:${man.id}@${man.version ?? "1.0.0"}`, detailUrl: detailUrl(base, e.name) }, base)
    const entry = validateCatalogEntry({
      ...normalized,
      poster: poster(stream),
      runtimeUrl: packageBlobUrl(base, man.id, runtime.digest),
      detailUrl: detailUrl(base, e.name),
      trust: {
        ...normalized.trust,
        runtimeDigest: runtime.digest,
        ...(manifestDigest ? { manifestDigest } : {}),
      },
    })
    out.push(entry)
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  await Bun.write(join(dir, "index.json"), JSON.stringify(out, null, 2) + "\n")
  return out.length
}

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const path = join(dir, item.name)
    if (item.isDirectory()) return walk(path, base)
    if (!item.isFile()) return []
    return [relative(base, path)]
  }).sort()
}

function sameFile(a: string, b: string): boolean {
  if (!existsSync(a) || !existsSync(b)) return false
  const left = readFileSync(a)
  const right = readFileSync(b)
  return left.length === right.length && left.every((byte, i) => byte === right[i])
}

export async function verifyArtifacts(opts: RegistryOptions = {}): Promise<FreshnessResult> {
  const srcRoot = root(opts)
  const srcSite = siteRoot(opts)
  const tmp = mkdtempSync(join(tmpdir(), "eikon-fresh-"))
  const tmpRoot = join(tmp, "eikons")
  const tmpSite = dirname(tmpRoot)
  const diffs: string[] = []
  try {
    cpSync(srcRoot, tmpRoot, { recursive: true })
    manifest({ ...opts, root: tmpRoot, encoding: opts.encoding ?? "gzip" })
    await index({ ...opts, root: tmpRoot })
    mkdirSync(join(tmpSite, "dist", "web"), { recursive: true })
    cpSync(tmpRoot, join(tmpSite, "dist", "web", "eikons"), { recursive: true })
    cpSync(join(tmpSite, "packages"), join(tmpSite, "dist", "web", "packages"), { recursive: true })
    const roots = ["eikons", "packages", ...(existsSync(join(srcSite, "dist", "web")) ? ["dist/web/eikons", "dist/web/packages"] : [])]
    for (const rel of roots) {
      const a = join(srcSite, rel)
      const b = join(tmpSite, rel)
      if ((existsSync(a) && statSync(a).isFile()) || (existsSync(b) && statSync(b).isFile())) {
        if (!sameFile(a, b)) diffs.push(rel)
        continue
      }
      const left = walk(a).map(file => join(rel, file))
      const right = walk(b).map(file => join(rel, file))
      for (const file of new Set([...left, ...right])) {
        if (!sameFile(join(srcSite, file), join(tmpSite, file))) diffs.push(file)
      }
    }
    return { ok: diffs.length === 0, diffs }
  } finally {
    rmSync(tmp, { recursive: true, force: true })
  }
}

export function manifest(opts: RegistryOptions = {}) {
  const dir = root(opts)
  const site = siteRoot(opts)
  const encoding = opts.encoding ?? "identity"
  rmSync(join(site, "packages"), { recursive: true, force: true })
  rmSync(join(site, "blobs"), { recursive: true, force: true })
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const d = join(dir, e.name)
    const packed = join(d, `${e.name}.eikon`)
    if (!existsSync(packed)) continue
    const oldManifest = join(d, "manifest.json")
    const prior = existsSync(oldManifest) ? JSON.parse(readFileSync(oldManifest, "utf8")) as Record<string, unknown> : {}
    const text = decodeRuntimeFile(packed)
    const migrated = text.trimStart().startsWith('{"type":"header"') || text.trimStart().startsWith('{"type":"header",')
      ? undefined
      : migrateLegacyEikon(text, { id: `liftaris/${e.name}`, entrypoint: `${e.name}.eikon`, version: "1.0.0" })
    if (migrated) writeFileSync(packed, migrated.stream)
    const runtimeText = migrated?.stream ?? text
    const launch = parseRuntimeFile(packed)
    const source = sourceMedia(prior)
    const localRuntime = localRuntimeInfo(d, `${e.name}.eikon`, runtimeText)
    const runtime = runtimeInfo(`${e.name}.eikon`, runtimeText, encoding)
    const localFiles = [localRuntime, ...sourceDescriptors(d, source)]
    const registryFiles = [registryRuntime(runtime), ...localFiles.slice(1).map(registryInfo)]
    const registrySourceMedia = registrySource(source, localFiles)
    const [namespace = "local", packageName = e.name] = `liftaris/${e.name}`.split("/")
    const pkgDir = join(site, "packages", namespace, packageName)
    mkdirSync(pkgDir, { recursive: true })
    stageBytes(pkgDir, runtime.bytes, runtime.digest!)
    for (const file of localFiles.slice(1)) stageBlob(pkgDir, join(d, file.path), file.digest!)

    const shared = {
      kind: PACKAGE_KIND,
      schemaVersion: "1.0",
      id: `liftaris/${e.name}`,
      name: e.name,
      version: "1.0.0",
      display: displayFrom(prior, launch, e.name),
      compatibility: { eikon: ">=1 <2" },
    } satisfies Omit<EikonPackageManifest, "entrypoints" | "files" | "source">

    const localManifest: EikonPackageManifest = {
      ...shared,
      ...(source ? { source } : {}),
      entrypoints: { default: `${e.name}.eikon` },
      files: localFiles,
    }
    const registryManifest: EikonPackageManifest = {
      ...shared,
      ...(registrySourceMedia ? { source: registrySourceMedia } : {}),
      entrypoints: { default: blobRel(runtime.digest!) },
      files: registryFiles,
    }
    validatePackageManifest(localManifest, { registry: true })
    validatePackageManifest(registryManifest, { registry: true })
    writeFileSync(oldManifest, JSON.stringify(localManifest, null, 2) + "\n")
    writeFileSync(join(pkgDir, "1.0.0.json"), JSON.stringify(registryManifest, null, 2) + "\n")
    writeFileSync(join(pkgDir, "index.json"), JSON.stringify({ kind: "eikon.package.index", id: shared.id, name: e.name, versions: [{ version: "1.0.0", manifest: "1.0.0.json" }] }, null, 2) + "\n")
    n++
  }
  return n
}
