import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync, symlinkSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { githubSubmitBackend, previewSubmitBundle, submission, submit, type SubmitBackend } from "../src/publish"
import { decodeRuntimeFile, lintManifest, runtimeDescriptor } from "../src"

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
    const req = be.calls[0] as { bundle: { files: Array<{ path: string, dest: string }>, catalog: Record<string, unknown>, lint: string[] } }
    expect(req.bundle.catalog).toMatchObject({ name: "demo", trust: {} })
    expect(req.bundle.files.map(f => f.dest)).toEqual(expect.arrayContaining([
      "eikons/demo/demo.eikon",
      "eikons/demo/manifest.json",
      "eikons/index.json",
      "packages/liftaris/demo/1.0.0.json",
      "packages/liftaris/demo/index.json",
    ]))
    expect(req.bundle.lint).toEqual(expect.arrayContaining(["✓ runtime demo.eikon", "✓ registry index eikons/index.json"]));
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

    expect(bundle.files.map(f => f.path).sort()).toEqual(expect.arrayContaining([
      "eikons/demo/base.png",
      "eikons/demo/demo.eikon",
      "eikons/demo/manifest.json",
      "eikons/demo/states/idle/loop.mp4",
      "eikons/index.json",
      "packages/liftaris/demo/1.0.0.json",
      "packages/liftaris/demo/index.json",
    ]))
    expect(bundle.manifest?.source?.base).toBe("base.png")
    expect(bundle.manifest?.source?.states?.idle?.file).toBe("states/idle/loop.mp4")
  })

  test("generates registry package artifacts when no source manifest is present", async () => {
    const fx = seed()

    const bundle = await previewSubmitBundle({ path: fx.file })

    expect(bundle.files.map(f => f.path)).toEqual(expect.arrayContaining([
      "eikons/demo/demo.eikon",
      "eikons/demo/manifest.json",
      "eikons/index.json",
      "packages/liftaris/demo/1.0.0.json",
      "packages/liftaris/demo/index.json",
    ]))
    expect(bundle.manifest?.kind).toBe("eikon.package")
  })

  test("applies submit display metadata to local and registry package manifests", async () => {
    const fx = seed()

    const bundle = await previewSubmitBundle({ path: fx.file, display: { title: "Demo Title", author: "Kai", description: "ready", glyph: "◇" } })
    const remote = JSON.parse(readFileSync(join(bundle.root, "packages", "liftaris", "demo", "1.0.0.json"), "utf8"))

    expect(bundle.manifest?.display).toMatchObject({ title: "Demo Title", author: "Kai", description: "ready", glyph: "◇" })
    expect(remote.display).toMatchObject({ title: "Demo Title", author: "Kai", description: "ready", glyph: "◇" })
    expect(bundle.catalog).toMatchObject({ title: "Demo Title", author: "Kai", description: "ready", glyph: "◇" })
  })

  test("converts gzip legacy runtime submissions to final launch-stream package artifacts", async () => {
    const fx = seed()
    const bytes = runtimeDescriptor(packed(), { encoding: "gzip" }).bytes
    writeFileSync(fx.file, bytes)

    const bundle = await previewSubmitBundle({ path: fx.file })

    expect(bundle.meta.name).toBe("demo")
    expect(decodeRuntimeFile(bundle.packed).startsWith('{"type":"header"')).toBe(true)
    expect(bundle.files.find(f => f.path === "eikons/demo/demo.eikon")?.bytes).not.toBe(bytes.length)
  })

  test("blocks missing source files only when referenced by manifest", async () => {
    const fx = seed()
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({
      name: "demo",
      version: 1,
      states: { idle: { file: "missing.mp4" } },
    }))

    await expect(previewSubmitBundle({ path: fx.file })).rejects.toThrow(/missing source: missing.mp4/)
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

    expect(bundle.files.map(f => f.path).sort()).toEqual(expect.arrayContaining(["eikons/demo/demo.eikon", "eikons/demo/notes.txt"]))
    expect(bundle.files.map(f => f.path).join("\n")).not.toContain(".env")
    expect(bundle.files.map(f => f.path).join("\n")).not.toContain("api.key")
  })

  test("old source manifests are rejected by lint and only accepted through submit conversion", async () => {
    const fx = seed()
    writeFileSync(join(fx.root, "manifest.json"), JSON.stringify({ name: "demo", version: 1, states: {} }))

    expect(() => lintManifest(join(fx.root, "manifest.json"), readFileSync(join(fx.root, "manifest.json"), "utf8"))).toThrow()
    const bundle = await previewSubmitBundle({ path: fx.file })
    expect(bundle.manifest?.kind).toBe("eikon.package")
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
  test("auth preflight checks the active GitHub account only", async () => {
    const calls: string[][] = []
    const backend = githubSubmitBackend("liftaris/eikon", async args => {
      calls.push(args)
      if (args.join(" ") === "api user -q .login") return "kaio"
      throw new Error(`unexpected gh call: ${args.join(" ")}`)
    })

    expect(await backend.check()).toEqual({ ok: true })
    expect(calls).toEqual([["api", "user", "-q", ".login"]])
  })

  test("updates existing files on rerun", async () => {
    const fx = seed()
    const bundle = await previewSubmitBundle({ path: fx.file })
    const puts: Array<{ args: string[]; body: Record<string, string> }> = []
    const existing = new Set<string>()
    const run = async (args: string[], input?: string) => {
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
        puts.push({ args, body: JSON.parse(input ?? "{}") })
        existing.add(path)
        return ""
      }
      if (args[0] === "pr") return "https://example.test/pr/1"
      throw new Error(`unexpected gh call: ${args.join(" ")}`)
    }
    const backend = githubSubmitBackend("liftaris/eikon", run)

    await backend.create(submission(bundle))
    await backend.create(submission(bundle))

    expect(puts).toHaveLength(bundle.files.length * 2)
    expect(puts[0]?.args).toEqual(["api", "-X", "PUT", `repos/kaio/eikon/contents/${bundle.files[0]?.dest}`, "--input", "-"])
    expect(puts[0]?.args.some(a => a.startsWith("content="))).toBe(false)
    expect(puts[0]?.body.sha).toBeUndefined()
    expect(puts[0]?.body.content).toBeString()
    expect(puts[bundle.files.length]?.body.sha).toBe("existing-sha")
  })
})
