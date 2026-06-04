import { EikonCompatibilityError, type CompatibilityProblem } from "./errors"

export const LAUNCH_MAJOR_VERSION = 1
export const LAUNCH_FORMAT_VERSION = "1.0"
export const LAUNCH_MEDIA_TYPE = "application/vnd.eikon.stream+jsonl"
export const LAUNCH_STREAM_EXTENSION = ".eikon"
export const PACKAGE_KIND = "eikon.package"
export const PACKAGE_SCHEMA_VERSION = "1.0"
export const CATALOG_KIND = "eikon.catalog.entry"
export const CATALOG_SCHEMA_VERSION = "1.0"

export const CANONICAL_STATES = ["idle", "listening", "thinking", "speaking", "working", "error"] as const
export type CanonicalState = typeof CANONICAL_STATES[number]
export const CANONICAL_SIGNALS = CANONICAL_STATES.map(state => `state.${state}`) as readonly `state.${CanonicalState}`[]

export type CanonicalSignal = `state.${CanonicalState}`
export type SignalName = CanonicalSignal | `${string}.${string}`
export type ClipName = string
export type ExtensionName = `eikon.${string}.v${number}` | `${string}.${string}.v${number}`

export type ExtensionSet = {
  used?: ExtensionName[]
  required?: ExtensionName[]
}

export type SignalMapping = {
  clip: ClipName
  fallback?: SignalName
}

export type LaunchHeaderRecord = {
  type: "header"
  eikon: typeof LAUNCH_MAJOR_VERSION
  id?: string
  version?: string
  title?: string
  author?: { name?: string }
  description?: string
  size: {
    cols: number
    rows: number
  }
  defaultSignal: SignalName
  signals: Record<SignalName, SignalMapping>
  extensions?: ExtensionSet
}

export type LaunchClipRecord = {
  type: "clip"
  name: ClipName
  fps: number
  frameCount?: number
  loopFrom?: number
  color?: string
  extensions?: ExtensionSet
}

export type LaunchFrameRecord = {
  type: "frame"
  clip: ClipName
  index: number
  rows: string[]
  pause?: number
  color?: string
  extensions?: ExtensionSet
}

export type LaunchExtensionRecord = {
  type: "extension"
  extension: ExtensionName
  payload: unknown
}

export type LaunchStreamRecord = LaunchHeaderRecord | LaunchClipRecord | LaunchFrameRecord | LaunchExtensionRecord

export type LaunchStreamDocument = {
  kind: "eikon.stream"
  records: LaunchStreamRecord[]
}

export type PackageFileRole = "runtime" | "source.base" | "source.clip" | "poster" | "preview" | "manifest" | string

export type PackageFileDescriptor = {
  path: string
  role: PackageFileRole
  mediaType: string
  size?: number
  digest?: `sha256:${string}` | string
  signal?: SignalName
}

export type PackageSourceMedia = {
  base?: string
  states?: Partial<Record<CanonicalState | string, { file: string; role?: "start" | "loop" | "source" }>>
}

export type TriggerRule = {
  signal: SignalName
  when: string
  fallback?: SignalName
}

export type EikonPackageManifest = {
  kind: typeof PACKAGE_KIND
  schemaVersion: typeof PACKAGE_SCHEMA_VERSION | string
  id: string
  name: string
  version?: string
  display?: {
    title?: string
    author?: string
    description?: string
    glyph?: string
    tags?: string[]
  }
  compatibility: {
    eikon: string
    hosts?: Record<string, string>
  }
  entrypoints: {
    default: string
    [name: string]: string
  }
  files?: PackageFileDescriptor[]
  source?: PackageSourceMedia
  editability?: {
    sourcesIncluded?: boolean
    mode?: "none" | "partial" | "full" | string
  }
  poster?: string
  preview?: string
  bundles?: Array<{ format: "zip" | string; role?: string; url: string; size?: number; digest?: string }>
  triggers?: TriggerRule[]
  extensions?: ExtensionSet
  legacy?: {
    sourceFormat?: "pre-launch .eikon draft" | ".eikon" | string
    migration?: "adapt" | "converted" | string
    notes?: string[]
  }
}

export type CatalogEntry = {
  kind: typeof CATALOG_KIND
  schemaVersion: typeof CATALOG_SCHEMA_VERSION | string
  id: string
  version?: string
  sourceKey: string
  name: string
  title?: string
  author?: string
  description?: string
  glyph?: string
  tags?: string[]
  poster?: string
  preview?: string
  runtimeUrl: string
  packageUrl: string
  detailUrl?: string
  compatibility: {
    eikon: string
    hosts?: Record<string, string>
    available?: boolean
    reason?: string
  }
  trust?: {
    reviewed?: boolean
    reviewer?: string
    manifestDigest?: string
    runtimeDigest?: string
    source?: string
    digest?: string
  }
}

export type PlatformMetadata = {
  kind: "eikon.platform"
  catalogId: string
  canonicalUrl?: string
  sourceUrl?: string
  license?: string
  provenance?: string
  stats?: Record<string, number>
  review?: Record<string, unknown>
}

export type ExtensionSupport = {
  optional?: ExtensionName[]
  required?: ExtensionName[]
}

export function canonicalSignal(state: CanonicalState): CanonicalSignal {
  return `state.${state}`
}

export function isCanonicalState(value: string): value is CanonicalState {
  return (CANONICAL_STATES as readonly string[]).includes(value)
}

export function defaultSignalMappings(): Record<CanonicalSignal, SignalMapping> {
  return Object.fromEntries(CANONICAL_STATES.map(state => [
    canonicalSignal(state),
    state === "idle" ? { clip: state } : { clip: state, fallback: "state.idle" },
  ])) as Record<CanonicalSignal, SignalMapping>
}

function majorOf(version: string | number): number {
  if (typeof version === "number") return version
  return Number(version.split(".")[0])
}

export function validateLaunchCompatibility(version: string | number, extensions: ExtensionSet = {}, support: ExtensionSupport = {}): CompatibilityProblem[] {
  const problems: CompatibilityProblem[] = []
  const major = majorOf(version)
  if (!Number.isFinite(major) || major !== LAUNCH_MAJOR_VERSION) {
    problems.push({ code: "unsupported-version", version: String(version), message: `unsupported Eikon stream version ${version}` })
  }
  const known = new Set([...(support.optional ?? []), ...(support.required ?? [])])
  for (const ext of extensions.required ?? []) {
    if (known.has(ext)) continue
    problems.push({ code: "unknown-required-extension", extension: ext, message: `unknown required Eikon extension ${ext}` })
  }
  return problems
}

export function assertLaunchCompatibility(version: string | number, extensions?: ExtensionSet, support?: ExtensionSupport): void {
  const problems = validateLaunchCompatibility(version, extensions, support)
  if (problems.length) throw new EikonCompatibilityError(problems)
}
