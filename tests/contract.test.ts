import { expect, test } from "bun:test"
import {
  assertLaunchCompatibility,
  CANONICAL_STATES,
  defaultSignalMappings,
  EikonCompatibilityError,
  LAUNCH_FORMAT_VERSION,
  type CatalogEntry,
  type EikonPackageManifest,
  type LaunchStreamRecord,
  type PlatformMetadata,
} from "../src"

const stream: LaunchStreamRecord[] = [
  { type: "header", asset: { version: LAUNCH_FORMAT_VERSION, width: 48, height: 24 } },
  ...CANONICAL_STATES.flatMap(state => [
    { type: "clip", name: state, fps: 16, frameCount: 1, loopFrom: 0 } satisfies LaunchStreamRecord,
    { type: "frame", clip: state, index: 0, rows: Array.from({ length: 24 }, () => " ".repeat(48)) } satisfies LaunchStreamRecord,
  ]),
]

test("launch stream shape preserves six canonical states", () => {
  const clips = stream.filter(record => record.type === "clip").map(record => record.name)
  expect(clips).toEqual([...CANONICAL_STATES])
})

test("package shape reserves signal mappings and trigger extensions", () => {
  const manifest: EikonPackageManifest = {
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: "liftaris/nous",
    name: "nous",
    compatibility: { eikon: ">=2 <3" },
    entrypoints: { default: "streams/nous.eikonl" },
    signals: {
      ...defaultSignalMappings(),
      "approval.waiting": { clip: "thinking", fallback: "state.thinking" },
    },
    triggers: [{ signal: "approval.waiting", when: "reserved.host-rule", fallback: "state.thinking" }],
    extensions: { used: ["eikon.signals.v1", "eikon.triggers.v1"] },
    legacy: { sourceFormat: ".eikon", migration: "adapt", notes: ["v1 NDJSON remains a compatibility input only"] },
  }
  expect(manifest.signals?.["state.working"]?.clip).toBe("working")
  expect(manifest.triggers?.[0]?.fallback).toBe("state.thinking")
})

test("catalog entry is separate from platform metadata", () => {
  const entry: CatalogEntry = {
    kind: "eikon.catalog.entry",
    schemaVersion: "1.0",
    id: "liftaris/nous",
    sourceKey: "github:liftaris/eikon:eikons/nous",
    name: "nous",
    packageUrl: "https://example.test/eikons/nous/manifest.json",
    compatibility: { eikon: ">=2 <3", available: true },
  }
  const platform: PlatformMetadata = {
    kind: "eikon.platform",
    catalogId: entry.id,
    license: "MIT",
    stats: { downloads: 12 },
  }
  expect(entry).not.toHaveProperty("stats")
  expect(platform.catalogId).toBe(entry.id)
})

test("unknown optional extension is compatible", () => {
  expect(() => assertLaunchCompatibility(LAUNCH_FORMAT_VERSION, { used: ["eikon.future.v1"] })).not.toThrow()
})

test("unknown required extension fails with structured error", () => {
  expect(() => assertLaunchCompatibility(LAUNCH_FORMAT_VERSION, { required: ["eikon.future.v1"] })).toThrow(EikonCompatibilityError)
})

test("higher major version fails with structured error", () => {
  expect(() => assertLaunchCompatibility("3.0")).toThrow(EikonCompatibilityError)
})

test("legacy major version fails as non-launch input", () => {
  expect(() => assertLaunchCompatibility("1.0")).toThrow(EikonCompatibilityError)
})
