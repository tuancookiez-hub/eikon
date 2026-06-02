import {
  CANONICAL_STATES,
  LAUNCH_FORMAT_VERSION,
  LAUNCH_MEDIA_TYPE,
  PACKAGE_KIND,
  PACKAGE_SCHEMA_VERSION,
  defaultSignalMappings,
  type EikonPackageManifest,
  type LaunchStreamRecord,
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

const META_KEYS = new Set(["eikon", "version", "name", "glyph", "width", "height", "states"])

export function legacyToLaunchStream(eikon: Eikon): LegacyMigration {
  const warnings: string[] = []
  const records: LaunchStreamRecord[] = [{
    type: "header",
    asset: {
      version: LAUNCH_FORMAT_VERSION,
      minVersion: LAUNCH_FORMAT_VERSION,
      width: eikon.meta.width,
      height: eikon.meta.height,
      mediaType: LAUNCH_MEDIA_TYPE,
    },
    name: eikon.meta.name,
    glyph: eikon.meta.glyph,
  }]

  const moved = Object.keys(eikon.meta).filter(key => !META_KEYS.has(key) && eikon.meta[key] != null)
  if (moved.length) warnings.push(`moved legacy metadata: ${moved.sort().join(", ")}`)

  for (const state of eikon.meta.states.length ? eikon.meta.states : CANONICAL_STATES) {
    const clip = eikon.clips.get(state)
    if (!clip?.frames.length) {
      warnings.push(`missing legacy state "${state}" skipped`)
      continue
    }
    records.push({ type: "clip", name: state, fps: clip.fps, frameCount: clip.frames.length, loopFrom: clip.loopFrom, fallback: state === "idle" ? undefined : "idle" })
    for (let index = 0; index < clip.frames.length; index++) {
      records.push({ type: "frame", clip: state, index, rows: clip.frames[index]! })
    }
  }
  return { records, warnings }
}

export function migrateLegacyEikon(text: string, opts: { id?: string; entrypoint?: string } = {}): MigratedEikon {
  const legacy = parse(text)
  const migrated = legacyToLaunchStream(legacy)
  const name = legacy.meta.name
  const entrypoint = opts.entrypoint ?? `${name}.eikonl`
  const manifest: EikonPackageManifest = {
    kind: PACKAGE_KIND,
    schemaVersion: PACKAGE_SCHEMA_VERSION,
    id: opts.id ?? name,
    name,
    display: {
      title: name,
      author: legacy.meta.author,
      glyph: legacy.meta.glyph,
      description: typeof legacy.meta.description === "string" ? legacy.meta.description : undefined,
    },
    compatibility: { eikon: ">=2 <3" },
    entrypoints: { default: entrypoint },
    files: [{ path: entrypoint, mediaType: LAUNCH_MEDIA_TYPE, role: "stream" }],
    signals: defaultSignalMappings(),
    extensions: { used: ["eikon.signals.v1"] },
    legacy: { sourceFormat: ".eikon", migration: "converted", notes: migrated.warnings },
  }
  return { stream: serializeLaunchStream(migrated.records), records: migrated.records, manifest, warnings: migrated.warnings }
}
