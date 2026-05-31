import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { previewReviewBundle, submitForReview, type ReviewBackend } from "../src/publish"

const frame = "........\n........\n........\n........"
const packed = (extra: Record<string, unknown> = {}) => [
  JSON.stringify({ eikon: 1, name: "demo", author: "Kaio", glyph: "◆", width: 8, height: 4, states: ["idle", "listening", "thinking", "speaking", "working", "error"], ...extra }),
  ...["idle", "listening", "thinking", "speaking", "working", "error"].flatMap(state => [
    JSON.stringify({ state, fps: 1, frame_count: 1 }),
    JSON.stringify({ f: 0, data: frame }),
  ]),
].join("\n")

function seed(extra: Record<string, unknown> = {}) {
  const parent = mkdtempSync(join(tmpdir(), "eikon-publish-"))
  const root = join(parent, "demo")
  mkdirSync(root)
  writeFileSync(join(root, "demo.eikon"), packed(extra))
  return { root, file: join(root, "demo.eikon") }
}

function backend(): ReviewBackend & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async check() { return { ok: true as const } },
    async create(req) { calls.push(req); return { kind: "review-created" as const, url: "https://example.test/review/1", request: req } },
  }
}

describe("submitForReview", () => {
  test("requires license before backend invocation", async () => {
    const fx = seed()
    const be = backend()

    const res = await submitForReview({ path: fx.file, provenance: "made by Kaio", backend: be })

    expect(res.kind).toBe("validation-failed")
    if (res.kind !== "validation-failed") throw new Error("expected validation failure")
    expect(res.failures).toContainEqual({ code: "missing-license", message: "license required" })
    expect(be.calls).toHaveLength(0)
  })

  test("requires provenance before backend invocation", async () => {
    const fx = seed()
    const be = backend()

    const res = await submitForReview({ path: fx.file, license: "MIT", backend: be })

    expect(res.kind).toBe("validation-failed")
    if (res.kind !== "validation-failed") throw new Error("expected validation failure")
    expect(res.failures).toContainEqual({ code: "missing-provenance", message: "provenance required" })
    expect(be.calls).toHaveLength(0)
  })

  test("returns setup-needed when backend auth preflight fails", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })
    const be = backend()
    be.check = async () => ({ ok: false as const, reason: "gh auth login --web" })

    const res = await submitForReview({ path: fx.file, backend: be })

    expect(res).toEqual({ kind: "setup-needed", failures: [{ code: "missing-auth", message: "gh auth login --web" }] })
    expect(be.calls).toHaveLength(0)
  })

  test("valid file builds a submit/review request through backend boundary", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })
    const be = backend()

    const res = await submitForReview({ path: fx.file, backend: be })

    expect(res.kind).toBe("review-created")
    expect(be.calls).toHaveLength(1)
    const req = be.calls[0] as { bundle: { files: Array<{ path: string }>, catalog: { license?: string, provenance?: string } } }
    expect(req.bundle.catalog).toMatchObject({ name: "demo", trust: { license: "MIT", provenance: "human-made" } })
    expect(req.bundle.files.map(f => f.path)).toEqual(["demo.eikon"])
  })
})

describe("previewReviewBundle", () => {
  test("includes manifest source metadata and referenced source files", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })
    mkdirSync(join(fx.root, "states", "idle"), { recursive: true })
    writeFileSync(join(fx.root, "base.png"), "base")
    writeFileSync(join(fx.root, "states", "idle", "loop.mp4"), "loop")
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({
      name: "demo",
      version: 1,
      source: "base.png",
      states: { idle: { file: "states/idle/loop.mp4" } },
    }))

    const bundle = await previewReviewBundle({ path: fx.file })

    expect(bundle.files.map(f => f.path).sort()).toEqual(["base.png", "demo.eikon", "manifest.json", "states/idle/loop.mp4"])
    expect(bundle.manifest?.source).toBe("base.png")
  })

  test("does not require source media when no manifest references it", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })

    const bundle = await previewReviewBundle({ path: fx.file })

    expect(bundle.files.map(f => f.path)).toEqual(["demo.eikon"])
  })

  test("blocks missing source files only when referenced by manifest", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({
      name: "demo",
      version: 1,
      states: { idle: { file: "missing.mp4" } },
    }))

    await expect(previewReviewBundle({ path: fx.file })).rejects.toThrow(/states.idle.file: missing.mp4 missing/)
  })

  test("classifies missing referenced files as missing-source", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({
      name: "demo",
      version: 1,
      states: { idle: { file: "missing.mp4" } },
    }))

    const res = await submitForReview({ path: fx.file, backend: backend() })

    expect(res.kind).toBe("validation-failed")
    if (res.kind !== "validation-failed") throw new Error("expected validation failure")
    expect(res.failures[0]?.code).toBe("missing-source")
  })

  test("excludes hidden and secret-like files", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })
    writeFileSync(join(fx.root, ".env"), "TOKEN=secret")
    writeFileSync(join(fx.root, "api.key"), "secret")
    writeFileSync(join(fx.root, "notes.txt"), "ok")

    const bundle = await previewReviewBundle({ path: fx.file, extraFiles: [".env", "api.key", "notes.txt"] })

    expect(bundle.files.map(f => f.path).sort()).toEqual(["demo.eikon", "notes.txt"])
  })

  test("rejects parent path escapes", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })

    await expect(previewReviewBundle({ path: fx.file, extraFiles: ["../secret.txt"] })).rejects.toThrow(/path escape/)
  })

  test("rejects symlink escapes", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })
    const outside = mkdtempSync(join(tmpdir(), "eikon-outside-"))
    writeFileSync(join(outside, "secret.txt"), "secret")
    symlinkSync(join(outside, "secret.txt"), join(fx.root, "link.txt"))

    await expect(previewReviewBundle({ path: fx.file, extraFiles: ["link.txt"] })).rejects.toThrow(/symlink escape/)
  })

  test("bounds bundle size", async () => {
    const fx = seed({ license: "MIT", provenance: "human-made" })

    await expect(previewReviewBundle({ path: fx.file, maxBytes: 10 })).rejects.toThrow(/bundle too large/)
  })
})
