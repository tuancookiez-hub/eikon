import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { githubSubmitBackend, previewSubmitBundle, submission, submit, type SubmitBackend } from "../src/publish"

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

function backend(): SubmitBackend & { calls: unknown[] } {
  const calls: unknown[] = []
  return {
    calls,
    async check() { return { ok: true as const } },
    async create(req) { calls.push(req); return { kind: "submitted" as const, url: "https://example.test/submission/1", request: req } },
  }
}

describe("submit", () => {
  test("returns setup-needed when backend auth preflight fails", async () => {
    const fx = seed()
    const be = backend()
    be.check = async () => ({ ok: false as const, reason: "gh auth login --web" })

    const res = await submit({ path: fx.file, backend: be })

    expect(res).toEqual({ kind: "setup-needed", failures: [{ code: "missing-auth", message: "gh auth login --web" }] })
    expect(be.calls).toHaveLength(0)
  })

  test("valid file builds a submit request through backend boundary", async () => {
    const fx = seed()
    const be = backend()

    const res = await submit({ path: fx.file, backend: be })

    expect(res.kind).toBe("submitted")
    expect(be.calls).toHaveLength(1)
    const req = be.calls[0] as { bundle: { files: Array<{ path: string }>, catalog: Record<string, unknown> } }
    expect(req.bundle.catalog).toMatchObject({ name: "demo", trust: {} })
    expect(req.bundle.files.map(f => f.path)).toEqual(["demo.eikon"])
  })
})

describe("previewSubmitBundle", () => {
  test("includes manifest source metadata and referenced source files", async () => {
    const fx = seed()
    mkdirSync(join(fx.root, "states", "idle"), { recursive: true })
    writeFileSync(join(fx.root, "base.png"), "base")
    writeFileSync(join(fx.root, "states", "idle", "loop.mp4"), "loop")
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({
      name: "demo",
      version: 1,
      source: "base.png",
      states: { idle: { file: "states/idle/loop.mp4" } },
    }))

    const bundle = await previewSubmitBundle({ path: fx.file })

    expect(bundle.files.map(f => f.path).sort()).toEqual(["base.png", "demo.eikon", "manifest.json", "states/idle/loop.mp4"])
    expect(bundle.manifest?.source).toBe("base.png")
  })

  test("does not require source media when no manifest references it", async () => {
    const fx = seed()

    const bundle = await previewSubmitBundle({ path: fx.file })

    expect(bundle.files.map(f => f.path)).toEqual(["demo.eikon"])
  })

  test("blocks missing source files only when referenced by manifest", async () => {
    const fx = seed()
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({
      name: "demo",
      version: 1,
      states: { idle: { file: "missing.mp4" } },
    }))

    await expect(previewSubmitBundle({ path: fx.file })).rejects.toThrow(/states.idle.file: missing.mp4 missing/)
  })

  test("classifies missing referenced files as missing-source", async () => {
    const fx = seed()
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({
      name: "demo",
      version: 1,
      states: { idle: { file: "missing.mp4" } },
    }))

    const res = await submit({ path: fx.file, backend: backend() })

    expect(res.kind).toBe("validation-failed")
    if (res.kind !== "validation-failed") throw new Error("expected validation failure")
    expect(res.failures[0]?.code).toBe("missing-source")
  })

  test("excludes hidden and secret-like files", async () => {
    const fx = seed()
    writeFileSync(join(fx.root, ".env"), "TOKEN=secret")
    writeFileSync(join(fx.root, "api.key"), "secret")
    writeFileSync(join(fx.root, "notes.txt"), "ok")

    const bundle = await previewSubmitBundle({ path: fx.file, extraFiles: [".env", "api.key", "notes.txt"] })

    expect(bundle.files.map(f => f.path).sort()).toEqual(["demo.eikon", "notes.txt"])
  })

  test("rejects parent path escapes", async () => {
    const fx = seed()

    await expect(previewSubmitBundle({ path: fx.file, extraFiles: ["../secret.txt"] })).rejects.toThrow(/path escape/)
  })

  test("rejects symlinks", async () => {
    const fx = seed()
    const outside = mkdtempSync(join(tmpdir(), "eikon-outside-"))
    writeFileSync(join(outside, "secret.txt"), "secret")
    symlinkSync(join(outside, "secret.txt"), join(fx.root, "link.txt"))

    await expect(previewSubmitBundle({ path: fx.file, extraFiles: ["link.txt"] })).rejects.toThrow(/symlink unsupported/)
  })

  test("rejects in-root symlinks before backend upload", async () => {
    const fx = seed()
    writeFileSync(join(fx.root, "note.txt"), "safe")
    symlinkSync(join(fx.root, "note.txt"), join(fx.root, "link.txt"))

    await expect(previewSubmitBundle({ path: fx.file, extraFiles: ["link.txt"] })).rejects.toThrow(/symlink/)
  })

  test("bounds bundle size", async () => {
    const fx = seed()

    await expect(previewSubmitBundle({ path: fx.file, maxBytes: 10 })).rejects.toThrow(/bundle too large/)
  })
})

describe("githubSubmitBackend", () => {
  test("updates existing files on rerun", async () => {
    const fx = seed()
    const bundle = await previewSubmitBundle({ path: fx.file })
    const puts: Array<Record<string, string>> = []
    const existing = new Set<string>()
    const run = async (args: string[]) => {
      const path = args[3] ?? ""
      if (args[0] === "repo") return ""
      if (args[1] === "user") return "kaio"
      if (args[1] === "repos/liftaris/eikon/git/ref/heads/main") return "main-sha"
      if (args[1] === "POST") return ""
      if (args[2] === "GET") {
        if (!existing.has(path)) throw new Error("not found")
        return JSON.stringify({ sha: "existing-sha" })
      }
      if (args[2] === "PUT") {
        puts.push(Object.fromEntries(args.filter(a => !a.startsWith("-f") && a.includes("=")).map(a => a.split("=", 2))))
        existing.add(path)
        return ""
      }
      if (args[0] === "pr") return "https://example.test/pr/1"
      throw new Error(`unexpected gh call: ${args.join(" ")}`)
    }
    const backend = githubSubmitBackend("liftaris/eikon", run)

    await backend.create(submission(bundle))
    await backend.create(submission(bundle))

    expect(puts).toHaveLength(2)
    expect(puts[0]?.sha).toBeUndefined()
    expect(puts[1]?.sha).toBe("existing-sha")
  })
})
