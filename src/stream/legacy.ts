import {
  CANONICAL_STATES,
  LAUNCH_MEDIA_TYPE,
  PACKAGE_KIND,
  PACKAGE_SCHEMA_VERSION,
  canonicalSignal,
  defaultSignalMappings,
  type EikonPackageManifest,
  type LaunchStreamRecord,
  type SignalMapping,
  type SignalName,
} from "../contract/shape"
import type { Eikon } from "../ui/eikon"
import { parse } from "../ui/eikon"
import { serializeLaunchStream } from "./parse"

export type LegacyMigration = {
  records: LaunchStreamRecord[]
  warnings: string[]
}

export type MigratedEikon = {
  stream: string
  records: LaunchStreamRecord[]
  manifest: EikonPackageManifest
  warnings: string[]
}

export type LegacyMigrationOptions = {
  id?: string
  version?: string
  entrypoint?: string
}

const META_KEYS = new Set(["eikon", "version", "name", "glyph", "width", "height", "states", "description"])
const DISPLAY_META_KEYS = new Set(["author", "glyph", "description"])

function safeClipName(name: string): string {
  return name.trim() || "idle"
}

function customSignalFor(name: string): SignalName {
  return name.includes(".") ? name as SignalName : `custom.${name}` as SignalName
}

function legacyMetadataWarnings(eikon: Eikon): string[] {
  const moved = Object.keys(eikon.meta)
    .filter(key => !META_KEYS.has(key) && eikon.meta[key] != null)
    .sort()
  const displayMoved = moved.filter(key => DISPLAY_META_KEYS.has(key))
  const nonDisplayMoved = moved.filter(key => !DISPLAY_META_KEYS.has(key))
  const warnings: string[] = []
  if (displayMoved.length) warnings.push(`moved legacy display metadata: ${displayMoved.join(", ")}`)
  if (nonDisplayMoved.length) warnings.push(`dropped ${nonDisplayMoved.length} unsupported legacy metadata field${nonDisplayMoved.length === 1 ? "" : "s"}`)
  return warnings
}

export function legacyToLaunchStream(eikon: Eikon, opts: Pick<LegacyMigrationOptions, "id" | "version"> = {}): LegacyMigration {
  const warnings = legacyMetadataWarnings(eikon)
  const declaredStates = eikon.meta.states.length ? eikon.meta.states : Array.from(eikon.clips.keys())
  const usableStates = declaredStates.filter(state => eikon.clips.get(state)?.frames.length)
  const defaultClip = eikon.clips.get("idle")?.frames.length ? "idle" : usableStates[0]
  if (!defaultClip) warnings.push("no legacy frames converted")

  const signals: Record<SignalName, SignalMapping> = { ...defaultSignalMappings() }
  if (defaultClip && defaultClip !== "idle") signals["state.idle"] = { clip: defaultClip }

  for (const state of declaredStates) {
    const clip = eikon.clips.get(state)
    if (!clip?.frames.length) {
      warnings.push(`missing legacy state "${state}" skipped`)
      continue
    }
    if ((CANONICAL_STATES as readonly string[]).includes(state)) {
      signals[canonicalSignal(state as typeof CANONICAL_STATES[number])] = state === "idle" ? { clip: safeClipName(state) } : { clip: safeClipName(state), fallback: "state.idle" }
    } else {
      signals[customSignalFor(state)] = { clip: safeClipName(state), fallback: "state.idle" }
    }
  }

  const records: LaunchStreamRecord[] = [{
    type: "header",
    eikon: 1,
    ...(opts.id ? { id: opts.id } : {}),
    ...(opts.version ? { version: opts.version } : {}),
    title: eikon.meta.name,
    ...(eikon.meta.author ? { author: { name: String(eikon.meta.author) } } : {}),
    ...(typeof eikon.meta.description === "string" ? { description: eikon.meta.description } : {}),
    size: { cols: eikon.meta.width, rows: eikon.meta.height },
    defaultSignal: "state.idle",
    signals,
  }]

  for (const state of usableStates) {
    const clip = eikon.clips.get(state)
    if (!clip?.frames.length) continue
    const name = safeClipName(state)
    records.push({ type: "clip", name, fps: clip.fps, frameCount: clip.frames.length, loopFrom: clip.loopFrom })
    for (let index = 0; index < clip.frames.length; index++) {
      records.push({ type: "frame", clip: name, index, rows: clip.frames[index]! })
    }
  }
  return { records, warnings }
}

export function migrateLegacyEikon(text: string, opts: LegacyMigrationOptions = {}): MigratedEikon {
  const legacy = parse(text)
  const name = legacy.meta.name
  const id = opts.id ?? name
  const entrypoint = opts.entrypoint ?? `${name}.eikon`
  const version = opts.version ?? (typeof legacy.meta.version === "string" ? legacy.meta.version : "1.0.0")
  const migrated = legacyToLaunchStream(legacy, { id, version })
  const manifest: EikonPackageManifest = {
    kind: PACKAGE_KIND,
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    id,
    name,
    version,
    display: {
      title: name,
      author: legacy.meta.author,
      glyph: legacy.meta.glyph,
      description: typeof legacy.meta.description === "string" ? legacy.meta.description : undefined,
    },
    compatibility: { eikon: ">=1 <2" },
    entrypoints: { default: entrypoint },
    files: [{ path: entrypoint, mediaType: LAUNCH_MEDIA_TYPE, role: "runtime" }],
    legacy: { sourceFormat: "pre-launch .eikon draft", migration: "converted", notes: migrated.warnings },
  }
  return { stream: serializeLaunchStream(migrated.records), records: migrated.records, manifest, warnings: migrated.warnings }
}
