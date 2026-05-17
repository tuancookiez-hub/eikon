import { describe, test, expect, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync, utimesSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { spawnSync } from "node:child_process"
import { resolve, install, peek, entries, dirty } from "../src/install"

const root = mkdtempSync(join(tmpdir(), "eikon-install-"))
const dest = join(root, "dest")

const man = (name: string, extra = {}) => JSON.stringify({
  name, version: 1, source: "base.png",
  states: { idle: { file: "idle.mp4" }, error: { file: "error.mp4" } }, ...extra,
}, null, 2)

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
    expect(out.origin.source).toMatch(/\/eikons\/ares\/$/)
  })

  test("unknown name throws", async () => {
    await expect(resolve("nope", { catalog: base })).rejects.toThrow(/no eikon named/)
  })
})
