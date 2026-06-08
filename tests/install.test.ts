import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { resolve, install, peek, entries, dirty } from "../src/install"
import { decodeRuntimeBytes, runtimeDescriptor, sha256Bytes } from "../src"

const root = mkdtempSync(join(tmpdir(), "eikon-install-"))
const dest = join(root, "dest")

function body(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const man = (name: string, extra = {}) => JSON.stringify({
  name, version: 1, source: "base.png",
  states: { idle: { file: "idle.mp4" }, error: { file: "error.mp4" } }, ...extra,
}, null, 2)

const launch = [
  JSON.stringify({ type: "header", eikon: 1, title: "launch", size: { cols: 4, rows: 2 }, defaultSignal: "state.idle", signals: { "state.idle": { clip: "idle" } } }),
  JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd", "efgh"] }),
].join("\n") + "\n"

const pkg = (name: string) => JSON.stringify({
  kind: "eikon.package",
  schemaVersion: "1.0",
  id: `liftaris/${name}`,
  name,
  compatibility: { eikon: ">=1 <2" },
  entrypoints: { default: `streams/${name}.eikon` },
  files: [
    { path: `streams/${name}.eikon`, role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl" },
    { path: "source/base.png", role: "source.base", mediaType: "image/png" },
    { path: "source/idle.mp4", role: "source.clip", mediaType: "video/mp4", signal: "state.idle" },
  ],
  source: { base: "source/base.png", states: { idle: { file: "source/idle.mp4" } } },
}, null, 2)

function gzipPkg(name: string, info = runtimeDescriptor(launch, { encoding: "gzip" })) {
  return JSON.stringify({
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: `liftaris/${name}`,
    name,
    version: "1.0.0",
    compatibility: { eikon: ">=1 <2" },
    entrypoints: { default: `streams/${name}.eikon` },
    files: [{
      path: `streams/${name}.eikon`,
      role: "runtime",
      mediaType: "application/vnd.eikon.stream+jsonl",
      encoding: "gzip",
      size: info.size,
      digest: info.digest,
      decodedSize: info.decodedSize,
      decodedDigest: info.decodedDigest,
    }],
  }, null, 2)
}

function seed(dir: string, name: string, extra = {}) {
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "manifest.json"), man(name, extra))
  writeFileSync(join(dir, "base.png"), Buffer.from([137, 80, 78, 71]))
  writeFileSync(join(dir, "idle.mp4"), Buffer.alloc(1024))
  writeFileSync(join(dir, "error.mp4"), Buffer.alloc(512))
}

describe("entries", () => {
  test("eikon shape + legacy files[]", () => {
    expect(entries(JSON.parse(man("x")))).toEqual([["base", "base.png"], ["idle", "idle.mp4"], ["error", "error.mp4"]])
    expect(entries({ files: ["base.png", "thinking.png", "odd.jpg"] }))
      .toEqual([["base", "base.png"], ["thinking", "thinking.png"], ["base", "odd.jpg"]])
  })

  test("launch package source descriptors map to editable source roles", () => {
    expect(entries(JSON.parse(pkg("launch"))))
      .toEqual([["base", "source/base.png"], ["idle", "source/idle.mp4"]])
  })
})

describe("resolve + install: local dir", () => {
  const src = join(root, "local-ares")
  beforeAll(() => seed(src, "ares"))

  test("resolve() finds manifest, records origin", async () => {
    const r = await resolve(src)
    expect(r.name).toBe("ares")
    expect(r.staged).toBe(src)
    expect(r.origin.source).toBe(src)
    expect(r.origin.at).toMatch(/^\d{4}-/)
  })

  test("install() copies media role-mapped, writes origin", async () => {
    let seen = 0
    const out = await install(src, dest, { progress: () => seen++ })
    expect(out.dir).toBe(join(dest, "ares"))
    expect(out.n).toBe(3)
    expect(out.bytes).toBe(4 + 1024 + 512)
    expect(seen).toBe(3)
    expect(out.sources).toEqual({ base: "base.png", idle: "idle.mp4", error: "error.mp4" })
    expect(existsSync(join(out.dir, "source", "idle.mp4"))).toBe(true)
    const m = JSON.parse(readFileSync(join(out.dir, "manifest.json"), "utf8"))
    expect(m.origin.source).toBe(src)
  })

  test("--no-source skips media but still writes manifest", async () => {
    const out = await install(src, dest, { name: "ares-lite", media: false })
    expect(out.n).toBe(3); expect(out.bytes).toBe(0)
    expect(existsSync(join(out.dir, "source", "idle.mp4"))).toBe(false)
    expect(existsSync(join(out.dir, "manifest.json"))).toBe(true)
  })

  test("peek() returns size without writing; memoized", async () => {
    const a = peek(src), b = peek(src)
    expect(a).toBe(b)
    const r = await a
    expect(r!.n).toBe(3)
    expect(r!.bytes).toBe(4 + 1024 + 512)
  })

  test("eikon_requires gate", async () => {
    const bad = join(root, "future"); seed(bad, "future", { eikon_requires: ">=99" })
    await expect(install(bad, dest)).rejects.toThrow(/eikon_requires/)
  })

  test("install name rejects path escapes", async () => {
    const sibling = join(dest, "victim")
    mkdirSync(sibling, { recursive: true })
    writeFileSync(join(sibling, "sentinel.txt"), "keep")
    for (const name of ["../victim", "/tmp/victim", "nested/name", "nested\\name", ".", "..", "-bad", ""]) {
      await expect(install(src, dest, { name })).rejects.toThrow(/invalid eikon name/)
      expect(readFileSync(join(sibling, "sentinel.txt"), "utf8")).toBe("keep")
    }
  })

  test("failed replacement preserves existing install", async () => {
    const good = join(root, "existing-good")
    const bad = join(root, "existing-bad")
    mkdirSync(join(bad, "streams"), { recursive: true })
    writeFileSync(join(bad, "manifest.json"), JSON.stringify({
      kind: "eikon.package",
      schemaVersion: "1.0",
      id: "liftaris/existing",
      name: "existing",
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "streams/existing.eikon" },
      files: [{ path: "streams/existing.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: 9, digest: "sha256:60498ebafa3f473a2a72c1242e8c3202bf50a6d81dfc721958be1550f46faf33" }],
    }, null, 2))
    writeFileSync(join(bad, "streams", "existing.eikon"), "not-json\n")
    seed(good, "existing")
    const out = await install(good, dest)
    writeFileSync(join(out.dir, "sentinel.txt"), "keep")
    await expect(install(bad, dest)).rejects.toThrow(/malformed JSON/)
    expect(readFileSync(join(out.dir, "sentinel.txt"), "utf8")).toBe("keep")
  })
})

describe("resolve + install: http base", () => {
  let srv: ReturnType<typeof Bun.serve>, url: string
  beforeAll(() => {
    srv = Bun.serve({ port: 0, fetch(req) {
      const p = new URL(req.url).pathname
      if (p.endsWith("manifest.json")) return new Response(man("remote"))
      if (p.endsWith("base.png")) return new Response(new Uint8Array(4), { headers: { "content-length": "4" } })
      if (p.endsWith(".mp4")) return new Response(new Uint8Array(1000), { headers: { "content-length": "1000" } })
      return new Response("404", { status: 404 })
    }})
    url = `http://localhost:${srv.port}/x/`
  })
  afterAll(() => srv.stop())

  test("resolve() via http sets base not staged", async () => {
    const r = await resolve(url)
    expect(r.name).toBe("remote"); expect(r.base).toBe(url); expect(r.staged).toBe("")
  })

  test("resolve() accepts explicit http manifest URLs", async () => {
    const r = await resolve(url + "manifest.json")
    expect(r.name).toBe("remote"); expect(r.base).toBe(url); expect(r.staged).toBe("")
  })

  test("install() fetches each file in parallel", async () => {
    const out = await install(url, dest)
    expect(out.n).toBe(3); expect(out.bytes).toBe(2004)
    expect(existsSync(join(dest, "remote", "source", "idle.mp4"))).toBe(true)
  })

  test("peek() HEADs content-length", async () => {
    const r = await peek(url)
    expect(r!.bytes).toBe(2004)
  })
})

describe("resolve + install: git", () => {
  const work = join(root, "gitwork"), repo = join(root, "fromgit.git")
  beforeAll(() => {
    seed(work, "fromgit")
    spawnSync("git", ["-C", work, "init", "-q"])
    spawnSync("git", ["-C", work, "add", "-A"])
    spawnSync("git", ["-C", work, "-c", "user.email=t@t", "-c", "user.name=t", "commit", "-q", "-m", "x"])
    spawnSync("git", ["clone", "--bare", "-q", work, repo])
  })

  test("clones, strips .git, records sha; locate() finds manifest at root", async () => {
    const r = await resolve(repo)
    expect(r.name).toBe("fromgit")
    expect(r.origin.sha).toMatch(/^[0-9a-f]{7,}$/)
    expect(r.tmp).toBe(true)
    expect(existsSync(join(r.staged, ".git"))).toBe(false)
    const out = await install(repo, dest)
    expect(existsSync(join(dest, "fromgit", "source", "idle.mp4"))).toBe(true)
    expect(out.origin.sha).toBeDefined()
  })
})

describe("resolve + install: launch package", () => {
  const src = join(root, "launch-pkg")
  beforeAll(() => {
    mkdirSync(join(src, "streams"), { recursive: true })
    mkdirSync(join(src, "source"), { recursive: true })
    writeFileSync(join(src, "manifest.json"), pkg("launch"))
    writeFileSync(join(src, "streams", "launch.eikon"), launch)
    writeFileSync(join(src, "source", "base.png"), Buffer.from([137, 80, 78, 71]))
    writeFileSync(join(src, "source", "idle.mp4"), Buffer.alloc(1024))
  })

  test("install() stages the launch stream and compatibility packed file", async () => {
    const out = await install(src, dest, { name: "launch-local" })
    expect(out.n).toBe(2)
    expect(out.sources).toEqual({ base: "base.png", idle: "idle.mp4" })
    expect(existsSync(join(out.dir, "launch-local.eikon"))).toBe(true)
    const packed = readFileSync(join(out.dir, "launch-local.eikon"), "utf8")
    const first = JSON.parse(packed.split("\n", 1)[0]!)
    expect(first.type).toBe("header")
    expect(first.eikon).toBe(1)
  })

  test("package install requires descriptors for every written file", async () => {
    const bad = join(root, "missing-entrypoint-descriptor")
    mkdirSync(join(bad, "streams"), { recursive: true })
    writeFileSync(join(bad, "manifest.json"), JSON.stringify({
      kind: "eikon.package",
      schemaVersion: "1.0",
      id: "liftaris/uncovered",
      name: "uncovered",
      compatibility: { eikon: ">=1 <2" },
      entrypoints: { default: "streams/uncovered.eikon" },
      files: [{ path: "streams/other.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: 5, digest: "sha256:d9298a10d1b0735837dc4bd85dac641b0f3cef27a47e5d53a54f2f3f5b2fcffa" }],
    }, null, 2))
    writeFileSync(join(bad, "streams", "uncovered.eikon"), launch)
    writeFileSync(join(bad, "streams", "other.eikon"), "other")
    await expect(install(bad, dest)).rejects.toThrow(new RegExp("missing verified descriptor.*streams/uncovered\\.eikon"))
    expect(existsSync(join(dest, "uncovered"))).toBe(false)
  })

  test("local gzip package installs stored bytes and decodes through runtime boundary", async () => {
    const next = join(root, "gzip-local")
    const info = runtimeDescriptor(launch, { encoding: "gzip" })
    mkdirSync(join(next, "streams"), { recursive: true })
    writeFileSync(join(next, "manifest.json"), gzipPkg("gzip-local", info))
    writeFileSync(join(next, "streams", "gzip-local.eikon"), info.bytes)
    const out = await install(next, dest)
    const installed = readFileSync(join(out.dir, "gzip-local.eikon"))
    expect(installed).toEqual(Buffer.from(info.bytes))
    expect(decodeRuntimeBytes(installed)).toBe(launch)
  })

  test("remote gzip package installs exact stored bytes", async () => {
    const info = runtimeDescriptor(launch, { encoding: "gzip" })
    const srv = Bun.serve({ port: 0, fetch(req) {
      const p = new URL(req.url).pathname
      if (p.endsWith("manifest.json")) return new Response(gzipPkg("gzip-remote", info))
      if (p.endsWith("gzip-remote.eikon")) return new Response(body(info.bytes), { headers: { "content-length": String(info.bytes.length) } })
      return new Response("404", { status: 404 })
    }})
    try {
      const out = await install(`http://localhost:${srv.port}/manifest.json`, dest)
      expect(readFileSync(join(out.dir, "gzip-remote.eikon"))).toEqual(Buffer.from(info.bytes))
    } finally { srv.stop() }
  })

  test("descriptor stored size and digest mismatches reject before writes", async () => {
    const info = runtimeDescriptor(launch, { encoding: "gzip" })
    for (const [name, bad] of [
      ["gzip-size", { ...info, size: info.size + 1 }],
      ["gzip-digest", { ...info, digest: "sha256:bad" }],
    ] as const) {
      const next = join(root, name)
      mkdirSync(join(next, "streams"), { recursive: true })
      writeFileSync(join(next, "manifest.json"), gzipPkg(name, bad))
      writeFileSync(join(next, "streams", `${name}.eikon`), info.bytes)
      await expect(install(next, dest)).rejects.toThrow(/runtime stored|mismatch: (size|digest)/)
      expect(existsSync(join(dest, name))).toBe(false)
    }
  })

  test("corrupt gzip descriptor rejects without leaving partial install", async () => {
    const info = runtimeDescriptor(launch, { encoding: "gzip" })
    const corrupt = Buffer.from(info.bytes)
    const last = corrupt.length - 1
    corrupt.set([corrupt[last]! ^ 0xff], last)
    const bad = { ...info, bytes: corrupt, size: corrupt.length, digest: sha256Bytes(corrupt) }
    const next = join(root, "gzip-corrupt")
    mkdirSync(join(next, "streams"), { recursive: true })
    writeFileSync(join(next, "manifest.json"), gzipPkg("gzip-corrupt", bad))
    writeFileSync(join(next, "streams", "gzip-corrupt.eikon"), corrupt)
    await expect(install(next, dest)).rejects.toThrow(/gzip/)
    expect(existsSync(join(dest, "gzip-corrupt"))).toBe(false)
  })

  test("root packed eikon cannot overwrite package entrypoint", async () => {
    const next = join(root, "packed-overwrite")
    mkdirSync(join(next, "streams"), { recursive: true })
    mkdirSync(join(next, "source"), { recursive: true })
    writeFileSync(join(next, "manifest.json"), pkg("packed"))
    writeFileSync(join(next, "streams", "packed.eikon"), launch)
    writeFileSync(join(next, "source", "base.png"), Buffer.from([137, 80, 78, 71]))
    writeFileSync(join(next, "source", "idle.mp4"), Buffer.alloc(1024))
    writeFileSync(join(next, "packed.eikon"), launch.replace("launch", "overwrite"))
    const out = await install(next, dest)
    const packed = readFileSync(join(out.dir, "packed.eikon"), "utf8")
    const first = JSON.parse(packed.split("\n", 1)[0]!)
    expect(first.title).toBe("launch")
  })
})

describe("dirty()", () => {
  test("false right after install; true after touching a file", async () => {
    const src = join(root, "d"); seed(src, "d")
    const out = await install(src, dest)
    expect(dirty(out.dir)).toBe(false)
    // Bump a file's mtime past origin.at + 2s guard.
    const later = Date.now() / 1000 + 10
    utimesSync(join(out.dir, "source", "idle.mp4"), later, later)
    expect(dirty(out.dir)).toBe(true)
  })
})

describe("resolve: catalog name", () => {
  let srv: ReturnType<typeof Bun.serve>, base: string
  beforeAll(() => {
    const avatar = join(root, "cat-ares"); seed(avatar, "ares")
    srv = Bun.serve({ port: 0, fetch(req) {
      const p = new URL(req.url).pathname
      if (p === "/eikons/index.json")
        return Response.json([{ name: "ares" }])
      if (p === "/eikons/ares/manifest.json") return new Response(man("ares"))
      if (p.startsWith("/eikons/ares/")) return new Response(new Uint8Array(100), { headers: { "content-length": "100" } })
      return new Response("404", { status: 404 })
    }})
    base = `http://localhost:${srv.port}/eikons`
  })
  afterAll(() => srv.stop())

  test("bare name → catalog → source URL → install", async () => {
    const out = await install("ares", dest, { name: "ares-cat", catalog: base })
    expect(out.n).toBe(3)
    expect(out.origin.source).toMatch(/\/eikons\/ares\/manifest\.json$/)
  })

  test("unknown name throws", async () => {
    await expect(resolve("nope", { catalog: base })).rejects.toThrow(/no eikon named/)
  })
})
