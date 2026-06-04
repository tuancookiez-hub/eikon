import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { resolve } from "node:path"
import { remote } from "../src/browse/catalog"
import { lint, lintRegistry } from "../src/ui/lint"
import {
  catalogEntry,
  loadCatalog,
  publicCatalogUrl,
  searchCatalog,
  type CatalogIndexEntry,
} from "../src/catalog"

const dir = resolve(import.meta.dir, "../eikons")
let srv: ReturnType<typeof Bun.serve>

beforeAll(() => {
  srv = Bun.serve({
    port: 0,
    fetch: async req => {
      const url = new URL(req.url)
      const path = url.pathname
      if (path === "/index.json") {
        const entries = await Bun.file(resolve(dir, "index.json")).json() as Array<Record<string, unknown> & { name: string }>
        return Response.json(entries.map(entry => ({
          ...entry,
          preview: new URL(`${entry.name}/${entry.name}.eikon`, `${url.origin}/`).href,
          runtimeUrl: new URL(`${entry.name}/${entry.name}.eikon`, `${url.origin}/`).href,
          packageUrl: new URL(`${entry.name}/manifest.json`, `${url.origin}/`).href,
        })))
      }
      const pkg = path.match(/^\/packages\/liftaris\/([^/]+)\/blobs\/sha256\//)
      const local = pkg ? `${pkg[1]}/${pkg[1]}.eikon` : path.slice(1)
      return new Response(Bun.file(resolve(dir, local)))
    },
  })
})
afterAll(() => srv.stop())

function raw(name: string, meta: Record<string, unknown> = {}) {
  return JSON.stringify({
    eikon: 1,
    name,
    author: "maker",
    glyph: "◆",
    width: 8,
    height: 4,
    description: `${name} test eikon`,
    homepage_url: `https://example.com/${name}`,
    ...meta,
  }) + "\n" + ["idle", "listening", "thinking", "speaking", "working", "error"]
    .flatMap(state => [JSON.stringify({ state, fps: 12, frame_count: 1 }), JSON.stringify({ f: 0, data: "abcd\\nefgh\\nijkl\\nmnop" })])
    .join("\n") + "\n"
}

test("remote catalog: index + load round-trip over http", async () => {
  const cat = remote(`http://localhost:${srv.port}`)
  const xs = await cat.list()
  expect(xs.length).toBe(3)
  expect(xs.find(e => e.name === "ares")?.glyph).toBe("⚔")
  const raw = await cat.load("mono")
  expect(raw.startsWith('{"type":"header","eikon":1')).toBe(true)
})

test("lint: accepts valid launch streams, rejects missing author", async () => {
  const good = await Bun.file(resolve(dir, "ares/ares.eikon")).text()
  expect(lint(good).meta.name).toBe("ares")

  const bad = good.replace('"author":{"name":"kaio"}', '"author":{}')
  expect(() => lint(bad)).toThrow(/author required/)
})

describe("shared catalog contract", () => {
  test("normalizes old index entries and lazy-loads full bodies", async () => {
    let loaded = false
    const fetcher = async (req: string | URL | Request) => {
      const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url
      const p = new URL(url).pathname
      if (p === "/index.json") return Response.json([{ name: "ares", author: "Kaio", glyph: "⚔", w: 48, h: 24, poster: "POSTER" }])
      if (p === "/ares/ares.eikon") { loaded = true; return new Response('{"eikon":1,"name":"ares","width":48,"height":24}\n') }
      return new Response("404", { status: 404 })
    }
    {
      const cat = await loadCatalog("https://eikon.liftaris.dev", fetcher, { allowPrivate: true })
      expect(loaded).toBe(false)
      expect(cat.entries).toMatchObject([{ name: "ares", author: "Kaio", sourceKey: "https://eikon.liftaris.dev/ares/" }])
      expect(searchCatalog(cat.entries, "kaio").map(e => e.name)).toEqual(["ares"])
      const raw = await cat.load(cat.entries[0]!)
      expect(raw).toContain('"name":"ares"')
      expect(loaded).toBe(true)
    }
  })

  test("normalizes review metadata and legacy URLs", () => {
    const e = catalogEntry({
      name: "echo",
      author: "Nous",
      description: "speaker",
      review_status: "reviewed",
      source: "echo/",
      preview_url: "echo/echo.eikon",
      package_url: "echo/manifest.json",
      w: 48,
      h: 24,
      poster: "POSTER",
    }, "https://eikon.liftaris.dev/eikons/")
    expect(e.name).toBe("echo")
    expect(e.description).toBe("speaker")
    expect(e.trust).toMatchObject({ reviewed: true, source: "reviewed" })
    expect(e.previewUrl).toBe("https://eikon.liftaris.dev/eikons/echo/echo.eikon")
    expect(e.packageUrl).toBe("https://eikon.liftaris.dev/eikons/echo/manifest.json")
    expect(e.sourceKey).toBe("https://eikon.liftaris.dev/eikons/echo/")
    expect(e.identityKey).toBe("https://eikon.liftaris.dev/eikons/echo/")
  })

  test("searches name and author case-insensitively", () => {
    const xs = [
      catalogEntry({ name: "ares", author: "Kaio", w: 48, h: 24, poster: "A" }, "https://eikon.liftaris.dev/eikons/"),
      catalogEntry({ name: "mono", author: "Nous Research", w: 48, h: 24, poster: "M" }, "https://eikon.liftaris.dev/eikons/"),
    ]
    expect(searchCatalog(xs, "NOUS").map(e => e.name)).toEqual(["mono"])
    expect(searchCatalog(xs, "are").map(e => e.name)).toEqual(["ares"])
    expect(searchCatalog(xs, "").length).toBe(2)
  })

  test("colliding names keep distinct identity keys", () => {
    const xs = [
      catalogEntry({ name: "echo", source: "a/", w: 48, h: 24, poster: "A" }, "https://eikon.liftaris.dev/eikons/"),
      catalogEntry({ name: "echo", source: "b/", w: 48, h: 24, poster: "B" }, "https://eikon.liftaris.dev/eikons/"),
    ]
    expect(xs[0]!.identityKey).not.toBe(xs[1]!.identityKey)
    expect(xs.map(e => e.name)).toEqual(["echo", "echo"])
  })

  test("rejects unsafe public catalog urls", () => {
    expect(() => publicCatalogUrl("file:///tmp/eikon.eikon")).toThrow(/public catalog URL/)
    expect(() => publicCatalogUrl("http://127.0.0.1/eikon.eikon")).toThrow(/public catalog URL/)
    expect(() => publicCatalogUrl("http://169.254.169.254/eikon.eikon")).toThrow(/private host/)
    expect(() => publicCatalogUrl("http://[::1]/eikon.eikon")).toThrow(/private host/)
    expect(() => publicCatalogUrl("http://[fe80::1]/eikon.eikon")).toThrow(/private host/)
    expect(() => publicCatalogUrl("http://[fc00::1]/eikon.eikon")).toThrow(/private host/)
    for (const host of [
      "[::ffff:10.0.0.1]",
      "[::ffff:127.0.0.1]",
      "[::ffff:169.254.169.254]",
      "[::ffff:172.16.0.1]",
      "[::ffff:172.31.255.255]",
      "[::ffff:192.168.1.1]",
    ]) {
      expect(() => publicCatalogUrl(`http://${host}/eikon.eikon`)).toThrow(/private host/)
    }
    expect(() => catalogEntry({ name: "bad", source: "../bad/", w: 1, h: 1, poster: "" }, "https://eikon.liftaris.dev/eikons/")).toThrow(/path escape/)
    expect(() => catalogEntry({ name: "bad", preview_url: "https://evil.example/bad.eikon", w: 1, h: 1, poster: "" }, "https://eikon.liftaris.dev/eikons/")).toThrow(/host/)
  })

  test("rejects unsafe catalog bases before fetching", async () => {
    const fetcher = async () => {
      throw new Error("fetch should not run")
    }

    await expect(loadCatalog("file:///tmp/eikons", fetcher)).rejects.toThrow(/public catalog URL/)
    await expect(loadCatalog("http://localhost:1234/eikons", fetcher)).rejects.toThrow(/private host/)
    await expect(loadCatalog("https://eikon.liftaris.dev/eikons/../private", fetcher)).rejects.toThrow(/path escape/)
  })

  test("defaults legacy trust to an empty object for compatibility", () => {
    const e = catalogEntry({ name: "old", w: 48, h: 24, poster: "P" }, "https://eikon.liftaris.dev/eikons/")
    expect(e.trust).toEqual({})
    expect(e.previewUrl).toBe("https://eikon.liftaris.dev/eikons/old/old.eikon")
    expect(e.packageUrl).toBe("https://eikon.liftaris.dev/eikons/old/manifest.json")
  })

  test("browser-safe import avoids host-only install exports", async () => {
    const cat = await import("eikon/catalog")
    expect("searchCatalog" in cat).toBe(true)
    expect("install" in cat).toBe(false)
    expect("resolve" in cat).toBe(false)
  })

  test("root export exposes submit primitives for Herm", async () => {
    const eikon = await import("eikon")
    expect("submitForReview" in eikon).toBe(true)
    expect("previewReviewBundle" in eikon).toBe(true)
  })
})

test("registry lint: rejects non-public metadata URL hosts", () => {
  const urls = [
    "https://169.254.169.254/latest/meta-data/",
    "https://[::]/eikons/bad/",
    "https://[::ffff:127.0.0.1]/eikons/bad/",
    "https://[::ffff:10.0.0.1]/eikons/bad/",
    "https://[::ffff:169.254.169.254]/eikons/bad/",
    "https://[fc00::1]/eikons/bad/",
    "https://[fe80::1]/eikons/bad/",
  ]

  for (const field of ["source_url", "homepage_url", "repository_url"] as const)
    for (const value of urls)
      expect(() => lintRegistry(raw("bad", { [field]: value }))).toThrow(/public host/)
  expect(() => lintRegistry(raw("bad", { homepage_url: "https://[::ffff:192.168.1.1]/" }))).toThrow(/public host/)
})

test("registry lint: rejects metadata control characters with otherwise valid URLs", () => {
  const unsafe = raw("bad", {
    homepage_url: "https://cdn.example/eikons/bad/",
    repository_url: "https://github.com/example/bad",
    description: "bad\u001bdesc",
  })

  expect(() => lintRegistry(unsafe)).toThrow(/metadata contains control characters/)
})
