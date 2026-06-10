import { expect, test } from "bun:test"
import {
  legacyToLaunchStream,
  migrateLegacyEikon,
  parse,
  parseLaunchStream,
  poster,
  serializeLaunchStream,
  validatePackageManifest,
  type LaunchStreamRecord,
} from "../src"

const rows = ["abcd", "efgh"]

const launchRecords: LaunchStreamRecord[] = [
  {
    type: "header",
    eikon: 1,
    id: "liftaris/unit",
    version: "1.0.0",
    title: "Unit",
    author: { name: "kaio" },
    size: { cols: 4, rows: 2 },
    defaultSignal: "state.idle",
    signals: {
      "state.idle": { clip: "idle" },
      "state.thinking": { clip: "thinking", fallback: "state.idle" },
    },
  },
  { type: "clip", name: "idle", fps: 12, frameCount: 1, loopFrom: 0 },
  { type: "frame", clip: "idle", index: 0, rows },
  { type: "clip", name: "thinking", fps: 8, frameCount: 1, loopFrom: 0 },
  { type: "frame", clip: "thinking", index: 0, rows: ["....", "----"] },
]

test("typed launch streams parse and serialize round-trip", () => {
  const text = serializeLaunchStream(launchRecords)
  const parsed = parseLaunchStream(text)
  expect(parsed.meta.name).toBe("Unit")
  expect(parsed.meta.version).toBe(1)
  expect(parsed.clips.get("idle")?.frames[0]).toEqual(rows)
  expect(serializeLaunchStream(parsed.records)).toBe(text)
})

test("malformed launch streams report line and record context", () => {
  const text = [
    JSON.stringify(launchRecords[0]),
    JSON.stringify({ type: "frame", clip: "idle", index: 0, rows }),
  ].join("\n")
  expect(() => parseLaunchStream(text)).toThrow(/line 2.*frame.*before clip/)
  expect(() => parseLaunchStream("{nope")).toThrow(/malformed JSON on line 1/)
})

test("launch streams validate frame dimensions and required record extensions", () => {
  const wrongHeight = [
    JSON.stringify(launchRecords[0]),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
    JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd"] }),
  ].join("\n")
  const wrongWidth = [
    JSON.stringify(launchRecords[0]),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
    JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd", "x"] }),
  ].join("\n")
  const requiredClipExtension = [
    JSON.stringify(launchRecords[0]),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 0, extensions: { required: ["eikon.future.v1"] } }),
  ].join("\n")
  const higherMajor = [
    JSON.stringify({ ...launchRecords[0], eikon: 2 }),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 0 }),
  ].join("\n")
  expect(() => parseLaunchStream(wrongHeight)).toThrow(/height/)
  expect(() => parseLaunchStream(wrongWidth)).toThrow(/width/)
  expect(() => parseLaunchStream(requiredClipExtension)).toThrow(/unknown required/)
  expect(() => parseLaunchStream(higherMajor)).toThrow(/header.eikon must be 1|unsupported Eikon stream version 2/)
})

test("legacy eikon converts to launch stream and package manifest", () => {
  const legacy = [
    JSON.stringify({ eikon: 1, name: "legacy", author: "t", glyph: "◆", width: 4, height: 2, local_note: "draft-only" }),
    JSON.stringify({ state: "idle", fps: 10, frame_count: 1, loop_from: 0 }),
    JSON.stringify({ f: 0, data: rows.join("\n") }),
    JSON.stringify({ state: "thinking", fps: 8, frame_count: 1 }),
    JSON.stringify({ f: 0, data: ["....", "----"].join("\n") }),
  ].join("\n") + "\n"
  const migrated = migrateLegacyEikon(legacy, { id: "liftaris/legacy", entrypoint: "streams/legacy.eikon", version: "1.0.0" })
  const parsed = parseLaunchStream(migrated.stream)
  expect(parsed.header.eikon).toBe(1)
  expect(parsed.header.defaultSignal).toBe("state.idle")
  expect(parsed.header.signals["state.thinking"]?.clip).toBe("thinking")
  expect(parsed.clips.get("idle")?.fps).toBe(10)
  expect(migrated.manifest.kind).toBe("eikon.package")
  expect(migrated.manifest.display).toMatchObject({ title: "legacy", author: "t", glyph: "◆" })
  expect(migrated.manifest.entrypoints.default).toBe("streams/legacy.eikon")
  expect(migrated.manifest.compatibility.eikon).toBe(">=1 <2")
  expect(migrated.manifest.files?.[0]?.role).toBe("runtime")
  expect(migrated.warnings.join("\n")).toMatch(/moved legacy display metadata: author/)
  expect(migrated.warnings.join("\n")).toMatch(/dropped 1 unsupported legacy metadata field/)
  expect("legacy" in migrated.manifest).toBe(false)
  expect(validatePackageManifest(migrated.manifest).entrypoints.default).toBe("streams/legacy.eikon")
})

test("legacy adapter keeps poster behavior compatible", () => {
  const legacy = [
    JSON.stringify({ eikon: 1, name: "legacy", width: 4, height: 2 }),
    JSON.stringify({ state: "idle", fps: 10, frame_count: 1 }),
    JSON.stringify({ f: 0, data: rows.join("\n") }),
  ].join("\n") + "\n"
  const adapted = legacyToLaunchStream(parse(legacy), { id: "liftaris/legacy", version: "1.0.0" })
  expect(poster(parseLaunchStream(serializeLaunchStream(adapted.records)))).toBe(rows.join("\n"))
})

test("launch parser requires a typed header as the first record", () => {
  const clipFirst = JSON.stringify({ type: "clip", name: "idle", fps: 10, frameCount: 1 })
  expect(() => parseLaunchStream(clipFirst)).toThrow(/first record must be header/)
})
