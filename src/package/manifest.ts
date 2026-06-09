import { EikonValidationError } from "../contract/errors"
import {
  LAUNCH_MAJOR_VERSION,
  LAUNCH_MEDIA_TYPE,
  LAUNCH_STREAM_EXTENSION,
  PACKAGE_KIND,
  PACKAGE_SCHEMA_VERSION,
  RUNTIME_ENCODINGS,
  type EikonPackageManifest,
  type PackageFileDescriptor,
} from "../contract/shape"

export type PackageValidationOptions = {
  /** Registry/publication mode: descriptors must be complete and content-addressed. */
  registry?: boolean
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const SAFE_PATH_RE = /^[a-zA-Z0-9._/-]+$/

const problem = (path: string, message: string) => ({ code: "manifest", path, message: `${path}: ${message}` })
const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const isSafeText = (value: string) => !/[<>\u0000-\u001f]/.test(value)
const SHA256_RE = /^sha256:[a-f0-9]{64}$/
const isSha256 = (value: unknown) => typeof value === "string" && SHA256_RE.test(value)
const isEncoding = (value: unknown): value is PackageFileDescriptor["encoding"] => typeof value === "string" && (RUNTIME_ENCODINGS as readonly string[]).includes(value)
const contentDigestForPath = (path: string): string | undefined => {
  const match = path.match(/^blobs\/sha256\/([a-f0-9]{64})(?:\.eikon)?$/)
  return match ? `sha256:${match[1]}` : undefined
}
const isRuntimePath = (path: string) => path.endsWith(LAUNCH_STREAM_EXTENSION) || contentDigestForPath(path) != null
const safeSize = (value: unknown) => typeof value === "number" && Number.isSafeInteger(value) && value >= 0
const ALLOWED_MANIFEST_KEYS = new Set([
  "kind",
  "schemaVersion",
  "id",
  "name",
  "version",
  "display",
  "compatibility",
  "entrypoints",
  "files",
  "source",
  "editability",
  "poster",
  "bundles",
  "triggers",
  "extensions",
  "legacy",
])
const ALLOWED_DESCRIPTOR_KEYS = new Set(["path", "role", "mediaType", "size", "digest", "encoding", "decodedSize", "decodedDigest", "signal"])
const ALLOWED_DESCRIPTOR_ROLES = new Set<PackageFileDescriptor["role"]>(["runtime", "source.base", "source.clip", "poster", "manifest"])

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("./") || path.includes("../") || path === "..") return false
  if (/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(path)) return false
  if (!SAFE_PATH_RE.test(path)) return false
  return !path.split("/").includes("..")
}

function supportsLaunch(range: string): boolean {
  const parts = [...range.matchAll(/(>=|>|<=|<|==|=)?\s*(\d+)(?:\.\d+)?/g)]
  if (!parts.length) return true
  return parts.every(([, op = "=", raw]) => {
    const n = Number(raw)
    if (op === ">=") return LAUNCH_MAJOR_VERSION >= n
    if (op === ">") return LAUNCH_MAJOR_VERSION > n
    if (op === "<=") return LAUNCH_MAJOR_VERSION <= n
    if (op === "<") return LAUNCH_MAJOR_VERSION < n
    return LAUNCH_MAJOR_VERSION === n
  })
}

function validateDescriptor(file: PackageFileDescriptor, index: number, opts: PackageValidationOptions, errs: ReturnType<typeof problem>[]): void {
  const base = `files.${index}`
  if (!file || typeof file !== "object") {
    errs.push(problem(base, "descriptor object required"))
    return
  }
  for (const key of Object.keys(file as Record<string, unknown>)) {
    if (!ALLOWED_DESCRIPTOR_KEYS.has(key)) errs.push(problem(`${base}.${key}`, "unsupported descriptor field"))
  }
  if (typeof file.path !== "string" || !isSafeRelativePath(file.path)) errs.push(problem(`${base}.path`, "safe relative path required"))
  if (typeof file.role !== "string" || !file.role) errs.push(problem(`${base}.role`, "role required"))
  else if (!ALLOWED_DESCRIPTOR_ROLES.has(file.role as PackageFileDescriptor["role"])) errs.push(problem(`${base}.role`, `unsupported descriptor role "${file.role}"; allowed roles are runtime/source.base/source.clip/poster/manifest`))
  if (typeof file.mediaType !== "string" || !file.mediaType) errs.push(problem(`${base}.mediaType`, "mediaType required"))
  if (file.size != null && !safeSize(file.size)) errs.push(problem(`${base}.size`, "non-negative safe integer required"))
  if (file.digest != null && !isSha256(file.digest)) errs.push(problem(`${base}.digest`, "canonical sha256 digest required"))
  if (file.role === "runtime") {
    if (!isRuntimePath(file.path)) errs.push(problem(`${base}.path`, `runtime descriptor must point at launch ${LAUNCH_STREAM_EXTENSION} stream or content-addressed blob`))
    if (file.mediaType !== LAUNCH_MEDIA_TYPE) errs.push(problem(`${base}.mediaType`, `runtime descriptor must use ${LAUNCH_MEDIA_TYPE}`))
    if (file.encoding != null && !isEncoding(file.encoding)) errs.push(problem(`${base}.encoding`, "runtime encoding must be identity or gzip"))
    const pathDigest = typeof file.path === "string" ? contentDigestForPath(file.path) : undefined
    if (pathDigest && !isSha256(file.digest)) errs.push(problem(`${base}.digest`, "canonical sha256 digest required for content-addressed runtime descriptor"))
    if (pathDigest && isSha256(file.digest) && file.digest !== pathDigest) errs.push(problem(`${base}.digest`, "runtime descriptor digest must match content-addressed path"))
    const enc = file.encoding ?? "identity"
    if (file.decodedSize != null && !safeSize(file.decodedSize)) errs.push(problem(`${base}.decodedSize`, "non-negative safe integer required"))
    if (file.decodedDigest != null && !isSha256(file.decodedDigest)) errs.push(problem(`${base}.decodedDigest`, "canonical sha256 digest required"))
    if (opts.registry && enc === "gzip") {
      const missing: string[] = []
      if (!safeSize(file.size)) missing.push("size")
      if (!isSha256(file.digest)) missing.push("digest")
      if (!safeSize(file.decodedSize)) missing.push("decodedSize")
      if (!isSha256(file.decodedDigest)) missing.push("decodedDigest")
      if (missing.length) errs.push(problem(base, `${missing.join(" ")} required for gzip registry runtime descriptors`))
    }
  } else {
    if (file.encoding != null || file.decodedSize != null || file.decodedDigest != null) errs.push(problem(base, "runtime encoding metadata is only valid on runtime descriptors"))
  }
  if (opts.registry) {
    const missing: string[] = []
    if (!safeSize(file.size)) missing.push("size")
    if (!isSha256(file.digest)) missing.push("digest")
    if (missing.length) errs.push(problem(base, `${missing.join(" ")} required for registry descriptors`))
  }
}

export function validatePackageManifest(value: unknown, opts: PackageValidationOptions = {}): EikonPackageManifest {
  const errs = []
  if (!isObj(value)) throw new EikonValidationError([problem("manifest", "object required")])
  const raw = value as Record<string, unknown>
  const man = value as EikonPackageManifest
  for (const key of Object.keys(raw)) {
    if (!ALLOWED_MANIFEST_KEYS.has(key)) errs.push(problem(key, "unsupported manifest field"))
  }
  if (man.kind !== PACKAGE_KIND) errs.push(problem("kind", `must be ${PACKAGE_KIND}`))
  if (man.schemaVersion !== PACKAGE_SCHEMA_VERSION) errs.push(problem("schemaVersion", `must be ${PACKAGE_SCHEMA_VERSION}`))
  if (!NAME_RE.test(String(man.name ?? ""))) errs.push(problem("name", "safe package name required"))
  if (!man.id || typeof man.id !== "string" || !isSafeText(man.id)) errs.push(problem("id", "safe id required"))
  if (opts.registry && (typeof man.version !== "string" || !man.version)) errs.push(problem("version", "version required for registry packages"))
  if (!isObj(man.compatibility) || typeof man.compatibility.eikon !== "string" || !supportsLaunch(man.compatibility.eikon)) errs.push(problem("compatibility.eikon", "must support launch major version 1"))
  if (!isObj(man.entrypoints) || typeof man.entrypoints.default !== "string" || !isSafeRelativePath(man.entrypoints.default)) errs.push(problem("entrypoints.default", "safe relative path required"))
  if (typeof man.entrypoints?.default === "string" && !isRuntimePath(man.entrypoints.default)) errs.push(problem("entrypoints.default", `must point at launch ${LAUNCH_STREAM_EXTENSION} runtime stream or content-addressed blob`))
  for (const [key, path] of Object.entries(man.entrypoints ?? {})) {
    if (typeof path !== "string" || !isSafeRelativePath(path)) errs.push(problem(`entrypoints.${key}`, "safe relative path required"))
  }
  if ("signals" in raw) errs.push(problem("signals", "runtime signal mappings belong in the .eikon header"))
  if (opts.registry && !Array.isArray(man.files)) errs.push(problem("files", "files descriptors required for registry packages"))
  for (const [index, file] of (man.files ?? []).entries()) validateDescriptor(file, index, opts, errs)
  const runtime = (man.files ?? []).find(file => file.role === "runtime" && file.path === man.entrypoints.default)
  if (opts.registry && !runtime) errs.push(problem("files", "runtime descriptor for entrypoints.default required"))
  if (man.source?.base && !isSafeRelativePath(man.source.base)) errs.push(problem("source.base", "safe relative path required"))
  for (const [key, source] of Object.entries(man.source?.states ?? {})) {
    if (!source || typeof source !== "object" || typeof source.file !== "string" || !isSafeRelativePath(source.file)) errs.push(problem(`source.states.${key}.file`, "safe relative path required"))
  }
  for (const ext of man.extensions?.required ?? []) errs.push(problem("extensions.required", `unknown required Eikon extension ${ext}`))
  if (man.poster && !isSafeRelativePath(man.poster)) errs.push(problem("poster", "safe relative path required"))
  for (const bundle of man.bundles ?? []) {
    if (!bundle || typeof bundle !== "object" || typeof bundle.url !== "string") errs.push(problem("bundles.url", "bundle URL required"))
  }
  for (const [key, value] of Object.entries(man.display ?? {})) {
    if (typeof value === "string" && !isSafeText(value)) errs.push(problem(`display.${key}`, "unsafe text"))
    if (Array.isArray(value) && value.some(item => typeof item !== "string" || !isSafeText(item))) errs.push(problem(`display.${key}`, "unsafe text"))
  }
  for (const trigger of man.triggers ?? []) {
    if (!trigger || typeof trigger.signal !== "string" || typeof trigger.when !== "string") errs.push(problem("triggers", "signal and when required"))
  }
  if (errs.length) throw new EikonValidationError(errs)
  return man
}
