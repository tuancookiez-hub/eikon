import { copyFileSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs"
import { dirname, join } from "node:path"
import { createHash } from "node:crypto"
import { DEFAULT_CATALOG } from "./ui/spec"
import { poster } from "./ui/eikon"
import { migrateLegacyEikon } from "./stream/legacy"
import { parseLaunchStream } from "./stream/parse"
import { normalizeCatalogEntry, validateCatalogEntry } from "./catalog"
import {
  LAUNCH_MEDIA_TYPE,
  PACKAGE_KIND,
  type EikonPackageManifest,
  type PackageFileDescriptor,
  type PackageSourceMedia,
  type SignalName,
} from "./contract/shape"
import { validatePackageManifest } from "./package/manifest"

const root = () => {
  let d = import.meta.dir
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  return join(d, "eikons")
}
const siteRoot = () => dirname(root())
const slash = (s: string) => s.replace(/\/?$/, "/")
const digestHex = (digest: string) => digest.replace(/^sha256:/, "")
const blobRel = (digest: string) => `blobs/sha256/${digestHex(digest)}`

function sha256(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
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

function displayFrom(prior: Record<string, unknown>, launch: ReturnType<typeof parseLaunchStream>, name: string): EikonPackageManifest["display"] {
  const displayPrior = prior.display && typeof prior.display === "object" && !Array.isArray(prior.display) ? prior.display as Record<string, unknown> : {}
  return {
    title: typeof displayPrior.title === "string" ? displayPrior.title : launch.header.title ?? name,
    author: typeof displayPrior.author === "string" ? displayPrior.author : launch.header.author?.name,
    glyph: typeof displayPrior.glyph === "string" ? displayPrior.glyph : undefined,
    description: typeof displayPrior.description === "string" ? displayPrior.description : launch.header.description,
  }
}

export async function index(base = DEFAULT_CATALOG) {
  const dir = root()
  const site = siteRoot()
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const d = join(dir, e.name)
    const manifestPath = join(d, "manifest.json")
    const streamPath = join(d, `${e.name}.eikon`)
    if (!existsSync(manifestPath) || !existsSync(streamPath)) continue
    const man = validatePackageManifest(JSON.parse(readFileSync(manifestPath, "utf8")), { registry: true })
    const stream = parseLaunchStream(readFileSync(streamPath, "utf8"))
    const runtime = man.files?.find(file => file.role === "runtime" && file.path === man.entrypoints.default)
    if (!runtime?.digest) throw new Error(`${e.name}: runtime descriptor missing digest`)
    const pkg = packageUrl(base, man.id, man.version ?? "1.0.0")
    const versionManifest = join(site, "packages", ...man.id.split("/"), `${man.version ?? "1.0.0"}.json`)
    const manifestDigest = existsSync(versionManifest) ? sha256(versionManifest) : undefined
    const normalized = normalizeCatalogEntry({ manifest: man, packageUrl: pkg, sourceKey: `registry:${new URL(base).host}:${man.id}@${man.version ?? "1.0.0"}`, detailUrl: detailUrl(base, e.name) }, base)
    const entry = validateCatalogEntry({
      ...normalized,
      poster: poster(stream),
      preview: packageBlobUrl(base, man.id, runtime.digest),
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

export function manifest() {
  const dir = root()
  const site = siteRoot()
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
    const text = readFileSync(packed, "utf8")
    const migrated = text.trimStart().startsWith('{"type":"header"') || text.trimStart().startsWith('{"type":"header",')
      ? undefined
      : migrateLegacyEikon(text, { id: `liftaris/${e.name}`, entrypoint: `${e.name}.eikon`, version: "1.0.0" })
    if (migrated) writeFileSync(packed, migrated.stream)
    const launch = parseLaunchStream(readFileSync(packed, "utf8"))
    const source = sourceMedia(prior)
    const localFiles = [fileInfo(d, `${e.name}.eikon`, "runtime"), ...sourceDescriptors(d, source)]
    const registryFiles = localFiles.map(registryInfo)
    const registrySourceMedia = registrySource(source, localFiles)
    const runtime = localFiles[0]!
    const [namespace = "local", packageName = e.name] = `liftaris/${e.name}`.split("/")
    const pkgDir = join(site, "packages", namespace, packageName)
    mkdirSync(pkgDir, { recursive: true })
    for (const file of localFiles) stageBlob(pkgDir, join(d, file.path), file.digest!)

    const shared = {
      kind: PACKAGE_KIND,
      schemaVersion: "1.0",
      id: `liftaris/${e.name}`,
      name: e.name,
      version: "1.0.0",
      display: displayFrom(prior, launch, e.name),
      compatibility: { eikon: ">=1 <2" },
      legacy: migrated ? { sourceFormat: "pre-launch .eikon draft", migration: "converted", notes: migrated.warnings } : (prior.legacy as EikonPackageManifest["legacy"] | undefined),
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
