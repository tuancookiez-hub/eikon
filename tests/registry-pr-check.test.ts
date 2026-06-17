import { describe, expect, test } from "bun:test"
import { validate, type Plan } from "../scripts/registry-pr-check"

const baseIndex = JSON.stringify([
  { kind: "eikon.catalog.entry", id: "liftaris/ares", name: "ares", packageUrl: "https://eikon.liftaris.dev/packages/liftaris/ares/1.0.0.json" },
  { kind: "eikon.catalog.entry", id: "liftaris/ovo", name: "ovo", packageUrl: "https://eikon.liftaris.dev/packages/liftaris/ovo/1.0.0.json" },
])

const withCat = JSON.stringify([
  { kind: "eikon.catalog.entry", id: "liftaris/ares", name: "ares", packageUrl: "https://eikon.liftaris.dev/packages/liftaris/ares/1.0.0.json" },
  { kind: "eikon.catalog.entry", id: "liftaris/nous-cat", name: "nous-cat", packageUrl: "https://eikon.liftaris.dev/packages/liftaris/nous-cat/1.0.0.json" },
  { kind: "eikon.catalog.entry", id: "liftaris/ovo", name: "ovo", packageUrl: "https://eikon.liftaris.dev/packages/liftaris/ovo/1.0.0.json" },
])

const goodFiles = [
  { status: "M", path: "eikons/index.json" },
  { status: "A", path: "eikons/nous-cat/nous-cat.eikon" },
  { status: "A", path: "eikons/nous-cat/manifest.json" },
  { status: "A", path: "packages/liftaris/nous-cat/1.0.0.json" },
  { status: "A", path: "packages/liftaris/nous-cat/index.json" },
  { status: "A", path: "packages/liftaris/nous-cat/blobs/sha256/abc" },
]

function plan(overrides: Partial<Plan> = {}): Plan {
  return { baseIndex, index: withCat, files: goodFiles, ...overrides }
}

describe("registry PR validation", () => {
  test("accepts generated submit additions that preserve existing catalog entries", () => {
    expect(validate(plan())).toEqual([])
  })

  test("rejects submit PRs that remove existing catalog entries", () => {
    const errors = validate(plan({ index: JSON.stringify([{ id: "liftaris/nous-cat", name: "nous-cat" }]) }))
    expect(errors.join("\n")).toContain("must not remove existing entry 'ares'")
    expect(errors.join("\n")).toContain("must not remove existing entry 'ovo'")
  })

  test("rejects new catalog entries without package artifacts", () => {
    const errors = validate(plan({ files: goodFiles.filter(file => !file.path.startsWith("packages/")) }))
    expect(errors.join("\n")).toContain("must include packages/liftaris/nous-cat/ artifacts")
  })

  test("rejects destructive file changes in submit PRs", () => {
    const errors = validate(plan({ files: [...goodFiles, { status: "D", path: "eikons/ares/manifest.json" }] }))
    expect(errors.join("\n")).toContain("must not delete registry files")
  })

  test("allows strict delist PRs to be handled by the delist workflow", () => {
    expect(validate(plan({ title: "eikons: delist ovo", index: JSON.stringify([{ id: "liftaris/ares", name: "ares" }]), files: [{ status: "D", path: "eikons/ovo/ovo.eikon" }] }))).toEqual([])
  })
})
