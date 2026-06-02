import { EikonCompatibilityError, type CompatibilityProblem } from "./errors"

export const LAUNCH_MAJOR_VERSION = 2
export const LAUNCH_FORMAT_VERSION = "2.0"
export const LAUNCH_MEDIA_TYPE = "application/vnd.eikon.stream+jsonl"
export const LAUNCH_STREAM_EXTENSION = ".eikonl"
export const PACKAGE_KIND = "eikon.package"
export const PACKAGE_SCHEMA_VERSION = "1.0"
export const CATALOG_KIND = "eikon.catalog.entry"
export const CATALOG_SCHEMA_VERSION = "1.0"

export const CANONICAL_STATES = ["idle", "listening", "thinking", "speaking", "working", "error"] as const
export type CanonicalState = typeof CANONICAL_STATES[number]

export type SignalName = `state.${CanonicalState}` | `${string}.${string}`
export type ClipName = CanonicalState | string
export type ExtensionName = `eikon.${string}.v${number}` | `${string}.${string}.v${number}`

export type ExtensionSet = {
  used?: ExtensionName[]
  required?: ExtensionName[]
}

export type LaunchHeaderRecord = {
  type: "header"
  asset: {
    version: string
    minVersion?: string
    width: number
    height: number
    mediaType?: typeof LAUNCH_MEDIA_TYPE
  }
  name?: string
  glyph?: string
  extensions?: ExtensionSet
}

export type LaunchClipRecord = {
  type: "clip"
  name: ClipName
  fps: number
  frameCount?: number
  loopFrom?: number
  fallback?: ClipName
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

export type LaunchStreamRecord = LaunchHeaderRecord | LaunchClipRecord | LaunchFrameRecord

export type LaunchStreamDocument = {
  kind: "eikon.stream"
  records: LaunchStreamRecord[]
}

export type PackageFileDescriptor = {
  path: string
  mediaType?: string
  size?: number
  digest?: string
  role?: "stream" | "poster" | "preview" | "source" | "manifest" | string
}

export type PackageSourceMedia = {
  base?: string
  states?: Partial<Record<CanonicalState | string, { file: string; role?: "start" | "loop" | "source" }>>
}

export type SignalMapping = {
  clip?: ClipName
  state?: ClipName
  decorator?: string
  fallback: SignalName | ClipName
}

export type TriggerRule = {
  signal: SignalName
  when: string
  fallback?: SignalName | ClipName
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
  poster?: string
  preview?: string
  signals?: Partial<Record<SignalName, SignalMapping>>
  triggers?: TriggerRule[]
  extensions?: ExtensionSet
  legacy?: {
    sourceFormat?: ".eikon"
    migration?: "adapt" | "converted"
    notes?: string[]
  }
}

export type CatalogEntry = {
  kind: typeof CATALOG_KIND
  schemaVersion: typeof CATALOG_SCHEMA_VERSION | string
  id: string
  sourceKey: string
  name: string
  title?: string
  author?: string
  description?: string
  glyph?: string
  tags?: string[]
  poster?: string
  preview?: string
  packageUrl: string
  detailUrl?: string
  installUrl?: string
  compatibility: {
    eikon: string
    hosts?: Record<string, string>
    available?: boolean
    reason?: string
  }
  trust?: {
    reviewed?: boolean
    reviewer?: string
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

export function canonicalSignal(state: CanonicalState): SignalName {
  return `state.${state}`
}

export function isCanonicalState(value: string): value is CanonicalState {
  return (CANONICAL_STATES as readonly string[]).includes(value)
}

export function defaultSignalMappings(): Record<`state.${CanonicalState}`, SignalMapping> {
  return Object.fromEntries(CANONICAL_STATES.map(state => [canonicalSignal(state), { clip: state, fallback: "state.idle" }])) as Record<`state.${CanonicalState}`, SignalMapping>
}

export function validateLaunchCompatibility(version: string, extensions: ExtensionSet = {}, support: ExtensionSupport = {}): CompatibilityProblem[] {
  const problems: CompatibilityProblem[] = []
  const major = Number(version.split(".")[0])
  if (!Number.isFinite(major) || major > LAUNCH_MAJOR_VERSION) {
    problems.push({ code: "unsupported-version", version, message: `unsupported Eikon stream version ${version}` })
  }
  const known = new Set([...(support.optional ?? []), ...(support.required ?? [])])
  for (const ext of extensions.required ?? []) {
    if (known.has(ext)) continue
    problems.push({ code: "unknown-required-extension", extension: ext, message: `unknown required Eikon extension ${ext}` })
  }
  return problems
}

export function assertLaunchCompatibility(version: string, extensions?: ExtensionSet, support?: ExtensionSupport): void {
  const problems = validateLaunchCompatibility(version, extensions, support)
  if (problems.length) throw new EikonCompatibilityError(problems)
}
