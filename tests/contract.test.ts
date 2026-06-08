import { expect, test } from "bun:test"
import {
  assertLaunchCompatibility,
  CANONICAL_SIGNALS,
  defaultSignalMappings,
  EikonCompatibilityError,
  LAUNCH_FORMAT_VERSION,
  LAUNCH_MAJOR_VERSION,
  LAUNCH_STREAM_EXTENSION,
  decodeRuntimeBytes,
  parseRuntimeBytes,
  serializeRuntimeBytes,
  parseLaunchStream,
  resolveSignal,
  serializeLaunchStream,
  type CatalogEntry,
  type EikonPackageManifest,
  type LaunchStreamRecord,
  type PlatformMetadata,
} from "../src"

const rows = ["abcd", "efgh"]

const stream: LaunchStreamRecord[] = [
  {
    type: "header",
    eikon: 1,
    id: "liftaris/unit",
    version: "1.0.0",
    title: "Unit",
    author: { name: "kaio" },
    description: "fixture",
    size: { cols: 4, rows: 2 },
    defaultSignal: "state.idle",
    signals: {
      ...defaultSignalMappings(),
      "approval.waiting": { clip: "thinking" },
      "tool.running": { clip: "working", fallback: "state.thinking" },
    },
    extensions: { used: ["eikon.triggers.v1"], required: [] },
  },
  { type: "clip", name: "idle", fps: 12, frameCount: 1, loopFrom: 0 },
  { type: "frame", clip: "idle", index: 0, rows },
  { type: "clip", name: "thinking", fps: 8, frameCount: 1, loopFrom: 0 },
  { type: "frame", clip: "thinking", index: 0, rows: ["....", "----"] },
  { type: "clip", name: "working", fps: 16, frameCount: 1, loopFrom: 0 },
  { type: "frame", clip: "working", index: 0, rows: ["!!!!", "++++"] },
  { type: "extension", extension: "eikon.triggers.v1", payload: { reserved: true } },
]

test("launch constants use final .eikon v1 stream contract", () => {
  expect(LAUNCH_MAJOR_VERSION).toBe(1)
  expect(LAUNCH_FORMAT_VERSION).toBe("1.0")
  expect(LAUNCH_STREAM_EXTENSION).toBe(".eikon")
})

test("launch stream shape keeps signal mappings in the header", () => {
  const header = stream[0]
  if (!header || header.type !== "header") throw new Error("fixture header missing")
  expect(header.eikon).toBe(1)
  expect(header.size).toEqual({ cols: 4, rows: 2 })
  expect(header.defaultSignal).toBe("state.idle")
  expect(Object.keys(header.signals).sort()).toContain("state.working")
  expect(Object.keys(header).sort()).toEqual(["author", "defaultSignal", "description", "eikon", "extensions", "id", "signals", "size", "title", "type", "version"])
  expect(stream.filter(record => record.type === "clip").map(record => record.name)).toEqual(["idle", "thinking", "working"])
})

test("typed launch streams parse, resolve signals, and serialize round-trip", () => {
  const text = serializeLaunchStream(stream)
  const parsed = parseLaunchStream(text)
  expect(parsed.header.eikon).toBe(1)
  expect(parsed.meta.version).toBe(1)
  expect(parsed.meta.width).toBe(4)
  expect(parsed.clips.get("idle")?.frames[0]).toEqual(rows)
  expect(resolveSignal(parsed, "state.working").clip).toBe("working")
  expect(resolveSignal(parsed, "tool.running").fallbackPath).toEqual(["tool.running"])
  expect(resolveSignal(parsed, "approval.waiting").clip).toBe("thinking")
  expect(resolveSignal(parsed, "approval.unknown").clip).toBe("idle")
  expect(serializeLaunchStream(parsed.records)).toBe(text)
})

test("runtime byte boundary preserves plain launch parsing", () => {
  const text = serializeLaunchStream(stream)
  const bytes = new TextEncoder().encode(text)
  const parsed = parseRuntimeBytes(bytes)
  expect(parsed.meta).toEqual(parseLaunchStream(text).meta)
  expect(parsed.records).toEqual(parseLaunchStream(text).records)
})

test("runtime byte boundary decodes gzip and enforces descriptor encoding", () => {
  const gzip = serializeRuntimeBytes(stream, { encoding: "gzip" })
  expect(gzip[0]).toBe(0x1f)
  expect(gzip[1]).toBe(0x8b)
  expect(parseRuntimeBytes(gzip).meta.name).toBe("Unit")
  expect(parseRuntimeBytes(gzip, { descriptor: { encoding: "gzip" } }).clips.get("idle")?.frames[0]).toEqual(rows)
  expect(() => parseRuntimeBytes(gzip, { descriptor: { encoding: "identity" } })).toThrow(/descriptor says identity/)
  expect(() => parseRuntimeBytes(new TextEncoder().encode(serializeLaunchStream(stream)), { descriptor: { encoding: "gzip" } })).toThrow(/descriptor says gzip/)
})

test("runtime byte boundary rejects invalid encodings gzip failures utf8 and decoded caps", () => {
  const text = serializeLaunchStream(stream)
  const gzip = serializeRuntimeBytes(stream, { encoding: "gzip" })
  expect(() => decodeRuntimeBytes(new Uint8Array([0xff]))).toThrow(/UTF-8/)
  expect(() => parseRuntimeBytes(new Uint8Array([0x1f, 0x8b, 0x08, 0x00]))).toThrow(/gzip/)
  expect(() => parseRuntimeBytes(new TextEncoder().encode(text), { descriptor: { encoding: "br" } })).toThrow(/unsupported runtime encoding/)
  expect(() => parseRuntimeBytes(gzip, { maxDecodedBytes: 8 })).toThrow(/decoded byte limit|larger than/)
})

test("canonical signals remain the six baseline lifecycle inputs", () => {
  expect(CANONICAL_SIGNALS).toEqual([
    "state.idle",
    "state.listening",
    "state.thinking",
    "state.speaking",
    "state.working",
    "state.error",
  ])
})

test("launch stream compatibility handles optional and required extensions", () => {
  expect(() => assertLaunchCompatibility(1, { used: ["eikon.future.v1"] })).not.toThrow()
  expect(() => assertLaunchCompatibility(1, { required: ["eikon.future.v1"] })).toThrow(EikonCompatibilityError)
  expect(() => assertLaunchCompatibility(2)).toThrow(EikonCompatibilityError)
})

test("malformed launch streams report line and record context", () => {
  const frameBeforeClip = [
    JSON.stringify(stream[0]),
    JSON.stringify({ type: "frame", clip: "idle", index: 0, rows }),
  ].join("\n")
  expect(() => parseLaunchStream(frameBeforeClip)).toThrow(/line 2.*frame.*before clip/)
  expect(() => parseLaunchStream("{nope")).toThrow(/malformed JSON on line 1/)
})

test("launch streams reject signal fallback cycles", () => {
  const cycle = [
    JSON.stringify({ ...stream[0], signals: { "state.idle": { clip: "idle", fallback: "state.working" }, "state.working": { clip: "working", fallback: "state.idle" } } }),
    JSON.stringify(stream[1]),
    JSON.stringify(stream[2]),
    JSON.stringify(stream[5]),
    JSON.stringify(stream[6]),
  ].join("\n")
  expect(() => parseLaunchStream(cycle)).toThrow(/fallback cycle/)
})

test("package, catalog, and platform shapes stay separate", () => {
  const manifest: EikonPackageManifest = {
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: "liftaris/unit",
    name: "unit",
    version: "1.0.0",
    compatibility: { eikon: ">=1 <2" },
    entrypoints: { default: "streams/unit.eikon" },
    files: [{ path: "streams/unit.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: 12, digest: "sha256:abc" }],
    triggers: [{ signal: "approval.waiting", when: "reserved.host-rule", fallback: "state.thinking" }],
    extensions: { used: ["eikon.triggers.v1"], required: [] },
  }
  const entry: CatalogEntry = {
    kind: "eikon.catalog.entry",
    schemaVersion: "1.0",
    id: "liftaris/unit",
    version: "1.0.0",
    sourceKey: "registry:eikon.liftaris.dev:liftaris/unit@1.0.0",
    name: "unit",
    runtimeUrl: "https://example.test/packages/liftaris/unit/blobs/sha256/runtime",
    packageUrl: "https://example.test/packages/liftaris/unit/1.0.0.json",
    compatibility: { eikon: ">=1 <2", available: true },
    trust: { runtimeDigest: "sha256:runtime", manifestDigest: "sha256:manifest" },
  }
  const platform: PlatformMetadata = { kind: "eikon.platform", catalogId: entry.id, stats: { downloads: 12 } }
  expect(manifest).not.toHaveProperty("signals")
  expect(entry.runtimeUrl).toContain("/blobs/sha256/")
  expect(entry).not.toHaveProperty("stats")
  expect(platform.catalogId).toBe(entry.id)
})
