import { expect, test } from "bun:test"
import {
  LAUNCH_FORMAT_VERSION,
  parseLaunchStream,
  serializeLaunchStream,
  legacyToLaunchStream,
  migrateLegacyEikon,
  poster,
  parse,
  type LaunchStreamRecord,
} from "../src"

const rows = ["abcd", "efgh"]

const launchRecords: LaunchStreamRecord[] = [
  { type: "header", asset: { version: LAUNCH_FORMAT_VERSION, width: 4, height: 2 }, name: "unit", glyph: "◇" },
  { type: "clip", name: "idle", fps: 12, frameCount: 1, loopFrom: 0 },
  { type: "frame", clip: "idle", index: 0, rows },
  { type: "clip", name: "thinking", fps: 8, frameCount: 1, fallback: "idle" },
  { type: "frame", clip: "thinking", index: 0, rows: ["....", "----"] },
]

test("typed launch streams parse and serialize round-trip", () => {
  const text = serializeLaunchStream(launchRecords)
  const parsed = parseLaunchStream(text)
  expect(parsed.meta.name).toBe("unit")
  expect(parsed.meta.version).toBe(2)
  expect(parsed.clips.get("idle")?.frames[0]).toEqual(rows)
  expect(serializeLaunchStream(parsed.records)).toBe(text)
})

test("malformed launch streams report line and record context", () => {
  const text = [
    JSON.stringify({ type: "header", asset: { version: LAUNCH_FORMAT_VERSION, width: 4, height: 2 } }),
    JSON.stringify({ type: "frame", clip: "idle", index: 0, rows }),
  ].join("\n")
  expect(() => parseLaunchStream(text)).toThrow(/line 2.*frame.*before clip/)
  expect(() => parseLaunchStream("{nope")).toThrow(/malformed JSON on line 1/)
})

test("launch streams validate frame dimensions and required record extensions", () => {
  const wrongHeight = [
    JSON.stringify({ type: "header", asset: { version: LAUNCH_FORMAT_VERSION, width: 4, height: 2 } }),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
    JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd"] }),
  ].join("\n")
  const wrongWidth = [
    JSON.stringify({ type: "header", asset: { version: LAUNCH_FORMAT_VERSION, width: 4, height: 2 } }),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
    JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd", "x"] }),
  ].join("\n")
  const requiredClipExtension = [
    JSON.stringify({ type: "header", asset: { version: LAUNCH_FORMAT_VERSION, width: 4, height: 2 } }),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 0, extensions: { required: ["eikon.future.v1"] } }),
  ].join("\n")
  const legacyMajor = [
    JSON.stringify({ type: "header", asset: { version: "1.0", width: 4, height: 2 } }),
    JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 0 }),
  ].join("\n")
  expect(() => parseLaunchStream(wrongHeight)).toThrow(/height/)
  expect(() => parseLaunchStream(wrongWidth)).toThrow(/width/)
  expect(() => parseLaunchStream(requiredClipExtension)).toThrow(/unknown required/)
  expect(() => parseLaunchStream(legacyMajor)).toThrow(/unsupported Eikon stream version 1.0/)
})

test("legacy eikon converts to launch stream and package manifest", () => {
  const legacy = [
    JSON.stringify({ eikon: 1, name: "legacy", author: "t", glyph: "◆", width: 4, height: 2, license: "MIT" }),
    JSON.stringify({ state: "idle", fps: 10, frame_count: 1, loop_from: 0 }),
    JSON.stringify({ f: 0, data: rows.join("\n") }),
  ].join("\n") + "\n"
  const migrated = migrateLegacyEikon(legacy, { id: "liftaris/legacy", entrypoint: "streams/legacy.eikonl" })
  const parsed = parseLaunchStream(migrated.stream)
  expect(parsed.clips.get("idle")?.fps).toBe(10)
  expect(migrated.manifest.kind).toBe("eikon.package")
  expect(migrated.manifest.entrypoints.default).toBe("streams/legacy.eikonl")
  expect(migrated.manifest.legacy?.notes).toContain("moved legacy metadata: author, license")
})

test("legacy adapter keeps poster behavior compatible", () => {
  const legacy = [
    JSON.stringify({ eikon: 1, name: "legacy", width: 4, height: 2 }),
    JSON.stringify({ state: "idle", fps: 10, frame_count: 1 }),
    JSON.stringify({ f: 0, data: rows.join("\n") }),
  ].join("\n") + "\n"
  const adapted = legacyToLaunchStream(parse(legacy))
  expect(poster(parseLaunchStream(serializeLaunchStream(adapted.records)))).toBe(rows.join("\n"))
})
