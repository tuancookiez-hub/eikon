import { PACKAGE_KIND, type CatalogEntry, type EikonPackageManifest, type PackageFileDescriptor } from "./contract/shape"
import { validatePackageManifest } from "./package/manifest"
import { parseSourceSpec, type InstallScope } from "./source"

export type LifecycleTrust = "verified" | "unverified" | "mismatch"
export type LifecycleInput = {
  name?: string
  manifest?: EikonPackageManifest | Record<string, unknown>
  origin?: {
    source?: string
    sourceSpec?: string
    sourceKey?: string
    identityKey?: string
    packageUrl?: string
    runtimeUrl?: string
    sha?: string
    resolvedRef?: string
    resolvedVersion?: string
    kind?: string
  }
  trust?: { state?: LifecycleTrust; reason?: string; verified?: string[] }
}
export type LifecycleSummary = {
  name: string
  sourceSpec?: string
  sourceKind?: string
  sourceKey?: string
  contentDigest?: string
  packageUrl?: string
  runtimeUrl?: string
  resolvedRef?: string
  resolvedVersion?: string
  trust: LifecycleTrust
  trustReason?: string
  sourceAvailable: boolean
  installMode: "runtime-only" | "runtime+source" | "editable"
  scope: InstallScope
}

export function runtimeDescriptor(manifest: EikonPackageManifest): PackageFileDescriptor | undefined {
  const man = validatePackageManifest(manifest)
  return man.files?.find(file => file.role === "runtime" && file.path === man.entrypoints.default)
}

export function sourceDescriptors(manifest: EikonPackageManifest): PackageFileDescriptor[] {
  const man = validatePackageManifest(manifest)
  const paths = new Set([man.source?.base, ...Object.values(man.source?.states ?? {}).map(item => item?.file)].filter(Boolean))
  return (man.files ?? []).filter(file => paths.has(file.path))
}

export function sourceAvailable(manifest: EikonPackageManifest): boolean {
  return sourceDescriptors(manifest).length > 0 || !!manifest.source?.base || !!Object.keys(manifest.source?.states ?? {}).length
}

export function catalogMatchesInstalled(entry: CatalogEntry, installed: LifecycleInput): boolean {
  const origin = installed.origin ?? {}
  const keys = new Set([origin.sourceKey, origin.identityKey, origin.packageUrl, origin.source].filter(Boolean))
  if (keys.has(entry.sourceKey) || keys.has(entry.id) || keys.has(entry.packageUrl)) return true
  return (origin.kind === "local" || origin.kind === "legacy") && !!installed.name && installed.name === entry.name
}

export function summarizeLifecycle(input: LifecycleInput, scope: InstallScope = "profile"): LifecycleSummary {
  const raw = input.manifest && (input.manifest as Record<string, unknown>).kind === PACKAGE_KIND
    ? validatePackageManifest(input.manifest)
    : undefined
  const origin = input.origin ?? {}
  const parsed = origin.sourceSpec || origin.source ? (() => { try { return parseSourceSpec(origin.sourceSpec ?? origin.source!) } catch { return undefined } })() : undefined
  const desc = raw ? runtimeDescriptor(raw) : undefined
  const hasSource = raw ? sourceAvailable(raw) : false
  return {
    name: input.name ?? raw?.name ?? "unknown",
    sourceSpec: origin.sourceSpec ?? origin.source,
    sourceKind: parsed?.kind ?? origin.kind,
    sourceKey: origin.sourceKey ?? origin.identityKey ?? parsed?.sourceKey,
    contentDigest: desc?.digest,
    packageUrl: origin.packageUrl,
    runtimeUrl: origin.runtimeUrl,
    resolvedRef: origin.resolvedRef ?? origin.sha,
    resolvedVersion: origin.resolvedVersion ?? raw?.version,
    trust: input.trust?.state ?? "unverified",
    ...(input.trust?.reason ? { trustReason: input.trust.reason } : {}),
    sourceAvailable: hasSource,
    installMode: hasSource ? raw?.editability?.mode === "full" ? "editable" : "runtime+source" : "runtime-only",
    scope,
  }
}

export function previewLifecycle(entry: CatalogEntry): LifecycleSummary {
  return {
    name: entry.name,
    sourceKind: "catalog",
    sourceKey: entry.sourceKey,
    contentDigest: entry.trust?.runtimeDigest,
    packageUrl: entry.packageUrl,
    runtimeUrl: entry.runtimeUrl,
    resolvedVersion: entry.version,
    trust: "unverified",
    sourceAvailable: false,
    installMode: "runtime-only",
    scope: "temporary",
  }
}

export function updatePlan(current: LifecycleSummary, next: LifecycleSummary): { available: boolean; reason: string; from?: string; to?: string } {
  if (!current.sourceKey || !next.sourceKey) return { available: false, reason: "source identity unavailable" }
  if (current.sourceKey !== next.sourceKey) return { available: false, reason: "source identity differs" }
  if (current.contentDigest && next.contentDigest && current.contentDigest !== next.contentDigest)
    return { available: true, reason: "content digest changed", from: current.contentDigest, to: next.contentDigest }
  return { available: false, reason: "content unchanged" }
}
