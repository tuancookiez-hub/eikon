import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { validate, type Plan } from "../scripts/registry-pr-check"

const script = join(import.meta.dir, "..", "scripts", "registry-pr-check.ts")

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

async function run(args: string[], cwd: string) {
  const proc = Bun.spawn(args, { cwd, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  return { code, stdout, stderr }
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

  test("rejects delist-titled PRs that delete unrelated registry files", () => {
    const errors = validate(plan({
      title: "eikons: delist ovo",
      index: JSON.stringify([{ id: "liftaris/ares", name: "ares" }]),
      files: [{ status: "D", path: "eikons/ares/ares.eikon" }],
    }))
    expect(errors.join("\n")).toContain("must not delete unrelated registry file")
  })

  test("CLI rejects stale generated files left dirty by the registry generator", async () => {
    const repo = mkdtempSync(join(tmpdir(), "eikon-pr-check-"))
    mkdirSync(join(repo, "eikons", "cat"), { recursive: true })
    mkdirSync(join(repo, "packages", "liftaris", "cat"), { recursive: true })
    writeFileSync(join(repo, "eikons", "index.json"), JSON.stringify([{ id: "liftaris/ares", name: "ares" }], null, 2))
    expect((await run(["git", "init", "-b", "main"], repo)).code).toBe(0)
    expect((await run(["git", "config", "user.email", "test@example.test"], repo)).code).toBe(0)
    expect((await run(["git", "config", "user.name", "Test"], repo)).code).toBe(0)
    expect((await run(["git", "add", "eikons/index.json"], repo)).code).toBe(0)
    expect((await run(["git", "commit", "-m", "base"], repo)).code).toBe(0)

    writeFileSync(join(repo, "eikons", "index.json"), JSON.stringify([
      { id: "liftaris/ares", name: "ares" },
      { id: "liftaris/cat", name: "cat", packageUrl: "https://eikon.liftaris.dev/packages/liftaris/cat/1.0.0.json" },
    ], null, 2))
    writeFileSync(join(repo, "eikons", "cat", "cat.eikon"), "runtime")
    writeFileSync(join(repo, "packages", "liftaris", "cat", "1.0.0.json"), "{}")

    const out = await run(["bun", script, "HEAD"], repo)
    expect(out.code).toBe(1)
    expect(out.stderr).toContain("Generated registry artifacts are stale or uncommitted")
    expect(out.stderr).toContain("??\tpackages/")
  })
})
