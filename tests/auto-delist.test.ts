import { describe, expect, test } from "bun:test"
import { delistName, validate, type Plan } from "../scripts/auto-delist"

const base: Plan = {
  name: "ovo",
  id: "liftaris/ovo",
  actor: "liftaris",
  submitter: "liftaris",
  baseFiles: [
    "eikons/index.json",
    "eikons/ovo/manifest.json",
    "eikons/ovo/ovo.eikon",
    "packages/liftaris/ovo/1.0.0.json",
    "packages/liftaris/ovo/index.json",
    "packages/liftaris/ovo/blobs/sha256/abc",
  ],
  files: [
    { filename: "eikons/index.json", status: "modified" },
    { filename: "eikons/ovo/manifest.json", status: "removed" },
    { filename: "eikons/ovo/ovo.eikon", status: "removed" },
    { filename: "packages/liftaris/ovo/1.0.0.json", status: "removed" },
    { filename: "packages/liftaris/ovo/index.json", status: "removed" },
    { filename: "packages/liftaris/ovo/blobs/sha256/abc", status: "removed" },
  ],
  index: JSON.stringify([{ name: "ares", id: "liftaris/ares" }]),
}

describe("auto-delist validation", () => {
  test("parses strict delist titles", () => {
    expect(delistName("eikons: delist ovo")).toBe("ovo")
    expect(delistName("delist ovo")).toBeUndefined()
  })

  test("accepts complete delist by original submitter", () => {
    expect(validate(base)).toEqual([])
  })

  test("rejects non-submitters", () => {
    expect(validate({ ...base, actor: "someone", submitter: "liftaris" }).join("\n")).toContain("not original submitter")
  })

  test("rejects partial and overbroad changes", () => {
    expect(validate({ ...base, files: base.files.slice(0, 2) }).join("\n")).toContain("Missing removal")
    expect(validate({ ...base, files: [...base.files, { filename: "src/publish.ts", status: "modified" }] }).join("\n")).toContain("Unexpected file")
  })

  test("rejects index entries that still list the eikon", () => {
    expect(validate({ ...base, index: JSON.stringify([{ name: "ovo", id: "liftaris/ovo" }]) }).join("\n")).toContain("still contains")
  })
})
