import { describe, expect, test, beforeAll, afterAll } from "bun:test"
import { resolve } from "node:path"
import { remote } from "../src/browse/catalog"
import { lint, lintRegistry } from "../src/ui/lint"
import {
  catalogEntry,
  loadCatalog,
  loadCatalogEntries,
  publicCatalogUrl,
  searchCatalog,
  validateCatalogEntry,
  type CatalogIndexEntry,
} from "../src/catalog"
import { decodeRuntimeFile, runtimeDescriptor } from "../src"

const dir = resolve(import.meta.dir, "../eikons")
let srv: ReturnType<typeof Bun.serve>

function body(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

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
          trust: {},
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
  const good = decodeRuntimeFile(resolve(dir, "ares/ares.eikon"))
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

  test("actual fetch preserves raw gzip bytes only when Content-Encoding is omitted", async () => {
    const info = runtimeDescriptor(raw("wire"), { encoding: "gzip" })
    const srv = Bun.serve({ port: 0, fetch(req) {
      const encoded = new URL(req.url).pathname.includes("encoded")
      return new Response(body(info.bytes), { headers: encoded ? { "content-encoding": "gzip" } : undefined })
    }})
    try {
      const plain = new Uint8Array(await (await fetch(`http://localhost:${srv.port}/plain`)).arrayBuffer())
      const encoded = new Uint8Array(await (await fetch(`http://localhost:${srv.port}/encoded`)).arrayBuffer())
      expect(plain[0]).toBe(0x1f)
      expect(plain[1]).toBe(0x8b)
      expect(encoded[0]).not.toBe(0x1f)
      expect(encoded.length).toBe(info.decodedSize)
    } finally {
      srv.stop()
    }
  })

  test("loads gzip runtime bytes and rejects transparent content encoding", async () => {
    const info = runtimeDescriptor(raw("zip"), { encoding: "gzip" })
    const entry = {
      name: "zip",
      manifest: {
        kind: "eikon.package",
        schemaVersion: "1.0",
        id: "liftaris/zip",
        name: "zip",
        version: "1.0.0",
        compatibility: { eikon: ">=1 <2" },
        entrypoints: { default: "blobs/sha256/abcdef0123456789" },
        files: [{ path: "blobs/sha256/abcdef0123456789", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", encoding: "gzip", size: info.size, digest: info.digest, decodedSize: info.decodedSize, decodedDigest: info.decodedDigest }],
      },
      packageUrl: "https://eikon.liftaris.dev/packages/liftaris/zip/1.0.0.json",
    }
    const fetcher = async (req: string | URL | Request) => {
      const p = new URL(String(req)).pathname
      if (p === "/index.json") return Response.json([entry])
      if (p.includes("/blobs/sha256/")) return new Response(body(info.bytes))
      return new Response("404", { status: 404 })
    }
    const cat = await loadCatalog("https://eikon.liftaris.dev", fetcher, { allowPrivate: true })
    expect(await cat.load("zip")).toBe(raw("zip"))
    const bad = await loadCatalog("https://eikon.liftaris.dev", async req => {
      const p = new URL(String(req)).pathname
      if (p === "/index.json") return Response.json([entry])
      return new Response(body(info.bytes), { headers: { "content-encoding": "gzip" } })
    }, { allowPrivate: true })
    await expect(bad.load("zip")).rejects.toThrow(/Content-Encoding/)
  })

  test("runtime preview verifies package manifest bytes when catalog trust advertises them", async () => {
    const pkg = new TextEncoder().encode(JSON.stringify({ kind: "eikon.package" }))
    const info = runtimeDescriptor(raw("trust"), { encoding: "identity" })
    const entry = catalogEntry({ name: "trust", source: "trust/", runtime_url: "trust/trust.eikon", package_url: "trust/manifest.json", w: 48, h: 24, poster: "P" }, "https://eikon.liftaris.dev/eikons/")
    entry.trust = { manifestDigest: "sha256:bad", runtimeDigest: info.digest, runtimeSize: info.size }
    const fetcher = async (req: string | URL | Request) => {
      const path = new URL(String(req)).pathname
      if (path.endsWith("manifest.json")) return new Response(pkg)
      if (path.endsWith("trust.eikon")) return new Response(body(info.bytes))
      return new Response("404", { status: 404 })
    }
    await expect(loadCatalog("https://eikon.liftaris.dev/eikons", async () => Response.json([entry]), { allowPrivate: true }).then(cat => cat.load("trust"))).rejects.toThrow(/manifest digest/)
    await expect(import("../src/catalog").then(({ loadRuntimeArtifact }) => loadRuntimeArtifact(entry, fetcher))).rejects.toThrow(/manifest digest/)
  })

  test("canonical catalog entries enforce safe URL policy and schema version", () => {
    expect(() => validateCatalogEntry({ kind: "eikon.catalog.entry", schemaVersion: "0.9", id: "xx", sourceKey: "xx", name: "xx", runtimeUrl: "https://cdn.example/x.eikon", packageUrl: "https://cdn.example/x.json", compatibility: { eikon: ">=1 <2" } })).toThrow(/schemaVersion/)
    expect(() => validateCatalogEntry({ kind: "eikon.catalog.entry", schemaVersion: "1.0", id: "xx", sourceKey: "xx", name: "xx", runtimeUrl: "http://127.0.0.1/x.eikon", packageUrl: "https://cdn.example/x.json", compatibility: { eikon: ">=1 <2" } })).toThrow(/runtimeUrl/)
    expect(() => validateCatalogEntry({ kind: "eikon.catalog.entry", schemaVersion: "1.0", id: "xx", sourceKey: "xx", name: "xx", runtimeUrl: "https://cdn.example/x.eikon", packageUrl: "https://user:secret@cdn.example/x.json", compatibility: { eikon: ">=1 <2" } })).toThrow(/packageUrl/)
  })

  test("normalizes legacy URLs", () => {
    const e = catalogEntry({
      name: "echo",
      author: "Nous",
      description: "speaker",
      source: "echo/",
      runtime_url: "echo/echo.eikon",
      package_url: "echo/manifest.json",
      w: 48,
      h: 24,
      poster: "POSTER",
    }, "https://eikon.liftaris.dev/eikons/")
    expect(e.name).toBe("echo")
    expect(e.description).toBe("speaker")
    expect(e.trust).toEqual({})
    expect(e.runtimeUrl).toBe("https://eikon.liftaris.dev/eikons/echo/echo.eikon")
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
    expect(() => catalogEntry({ name: "bad", runtime_url: "https://evil.example/bad.eikon", w: 1, h: 1, poster: "" }, "https://eikon.liftaris.dev/eikons/")).toThrow(/host/)
  })

  test("rejects unsafe catalog bases before fetching", async () => {
    const fetcher = async () => {
      throw new Error("fetch should not run")
    }

    await expect(loadCatalog("file:///tmp/eikons", fetcher)).rejects.toThrow(/public catalog URL/)
    await expect(loadCatalog("http://localhost:1234/eikons", fetcher)).rejects.toThrow(/private host/)
    await expect(loadCatalog("https://eikon.liftaris.dev/eikons/../private", fetcher)).rejects.toThrow(/path escape/)
    await expect(loadCatalog("https://eikon.liftaris.dev/eikons/%2e%2e/private?token=secret", fetcher)).rejects.toThrow(/path escape/)
    try { await loadCatalog("https://eikon.liftaris.dev/eikons/%2e%2e/private?token=secret", fetcher) } catch (err) { expect(String(err)).not.toContain("secret") }
    await expect(loadCatalogEntries("http://169.254.169.254/eikons", fetcher)).rejects.toThrow(/private host/)
  })

  test("defaults legacy trust to an empty object for compatibility", () => {
    const e = catalogEntry({ name: "old", w: 48, h: 24, poster: "P" }, "https://eikon.liftaris.dev/eikons/")
    expect(e.trust).toEqual({})
    expect(e.runtimeUrl).toBe("https://eikon.liftaris.dev/eikons/old/old.eikon")
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
    expect("submit" in eikon).toBe(true)
    expect("previewSubmitBundle" in eikon).toBe(true)
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
