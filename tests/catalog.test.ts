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
} from "../src/catalog"
import { decodeRuntimeFile, LAUNCH_MEDIA_TYPE, runtimeDescriptor, type EikonPackageManifest } from "../src"

const dir = resolve(import.meta.dir, "../eikons")
const A = "a".repeat(64)
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
        const entries = await Bun.file(resolve(dir, "index.json")).json() as Array<Record<string, unknown> & { runtimeUrl?: string; packageUrl?: string; detailUrl?: string }>
        return Response.json(entries.map(entry => ({
          ...entry,
          runtimeUrl: entry.runtimeUrl?.replace("https://eikon.liftaris.dev", url.origin),
          packageUrl: entry.packageUrl?.replace("https://eikon.liftaris.dev", url.origin),
          detailUrl: entry.detailUrl?.replace("https://eikon.liftaris.dev", url.origin),
        })))
      }
      const pkg = path.match(/^\/packages\/liftaris\/([^/]+)\/(?:blobs\/sha256\/|)(?:[a-f0-9]{64}|[^/]+\.eikon)$/)
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

function pkg(name: string, opts: { author?: string; title?: string; sourceKey?: string; packageUrl?: string; digest?: string; trust?: boolean } = {}) {
  const manifest: EikonPackageManifest = {
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: `liftaris/${name}`,
    name,
    version: "1.0.0",
    display: { title: opts.title ?? name, author: opts.author ?? "Kaio", glyph: "◆" },
    compatibility: { eikon: ">=1 <2" },
    entrypoints: { default: `${name}.eikon` },
    files: [{
      path: `${name}.eikon`,
      role: "runtime",
      mediaType: LAUNCH_MEDIA_TYPE,
      ...(opts.trust === false ? {} : { size: 123, digest: opts.digest ?? `sha256:${A}` }),
    }],
  }
  return {
    manifest,
    packageUrl: opts.packageUrl ?? `https://eikon.liftaris.dev/packages/liftaris/${name}/1.0.0.json`,
    sourceKey: opts.sourceKey ?? `registry:eikon.liftaris.dev:liftaris/${name}@1.0.0`,
  }
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
  test("normalizes package-backed index entries and lazy-loads full bodies", async () => {
    let loaded = false
    const fetcher = async (req: string | URL | Request) => {
      const url = typeof req === "string" ? req : req instanceof URL ? req.href : req.url
      const p = new URL(url).pathname
      if (p === "/index.json") return Response.json([pkg("ares", { trust: false })])
      if (p === "/packages/liftaris/ares/ares.eikon") { loaded = true; return new Response(raw("ares")) }
      return new Response("404", { status: 404 })
    }
    const cat = await loadCatalog("https://eikon.liftaris.dev", fetcher, { allowPrivate: true })
    expect(loaded).toBe(false)
    expect(cat.entries).toMatchObject([{ name: "ares", author: "Kaio", sourceKey: "registry:eikon.liftaris.dev:liftaris/ares@1.0.0" }])
    expect(cat.entries[0]).not.toHaveProperty("preview")
    expect(cat.entries[0]).not.toHaveProperty("previewUrl")
    expect(cat.entries[0]).not.toHaveProperty("raw")
    expect(searchCatalog(cat.entries, "kaio").map(e => e.name)).toEqual(["ares"])
    const text = await cat.load(cat.entries[0]!)
    expect(text).toContain('"name":"ares"')
    expect(loaded).toBe(true)
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
    const hex = info.digest.slice("sha256:".length)
    const entry = {
      manifest: {
        kind: "eikon.package",
        schemaVersion: "1.0",
        id: "liftaris/zip",
        name: "zip",
        version: "1.0.0",
        compatibility: { eikon: ">=1 <2" },
        entrypoints: { default: `blobs/sha256/${hex}` },
        files: [{ path: `blobs/sha256/${hex}`, role: "runtime", mediaType: LAUNCH_MEDIA_TYPE, encoding: "gzip", size: info.size, digest: info.digest, decodedSize: info.decodedSize, decodedDigest: info.decodedDigest }],
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

  test("normalizes package-backed URLs", () => {
    const e = catalogEntry(pkg("echo", { author: "Nous", title: "Echo" }), "https://eikon.liftaris.dev/eikons/")
    expect(e.name).toBe("echo")
    expect(e.title).toBe("Echo")
    expect(e.trust.runtimeDigest).toBe(`sha256:${A}`)
    expect(e.runtimeUrl).toBe("https://eikon.liftaris.dev/packages/liftaris/echo/echo.eikon")
    expect(e.packageUrl).toBe("https://eikon.liftaris.dev/packages/liftaris/echo/1.0.0.json")
    expect(e.sourceKey).toBe("registry:eikon.liftaris.dev:liftaris/echo@1.0.0")
    expect(e.identityKey).toBe("registry:eikon.liftaris.dev:liftaris/echo@1.0.0")
    expect(e).not.toHaveProperty("preview")
  })

  test("searches name and author case-insensitively", () => {
    const xs = [
      catalogEntry(pkg("ares", { author: "Kaio" }), "https://eikon.liftaris.dev/eikons/"),
      catalogEntry(pkg("mono", { author: "Nous Research" }), "https://eikon.liftaris.dev/eikons/"),
    ]
    expect(searchCatalog(xs, "NOUS").map(e => e.name)).toEqual(["mono"])
    expect(searchCatalog(xs, "are").map(e => e.name)).toEqual(["ares"])
    expect(searchCatalog(xs, "").length).toBe(2)
  })

  test("colliding names keep distinct identity keys", () => {
    const xs = [
      catalogEntry(pkg("echo", { sourceKey: "registry:a:liftaris/echo@1.0.0", packageUrl: "https://a.example/packages/liftaris/echo/1.0.0.json" })),
      catalogEntry(pkg("echo", { sourceKey: "registry:b:liftaris/echo@1.0.0", packageUrl: "https://b.example/packages/liftaris/echo/1.0.0.json" })),
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
    expect(() => catalogEntry({ name: "bad", source: "../bad/", w: 1, h: 1, poster: "" } as never, "https://eikon.liftaris.dev/eikons/")).toThrow(/launch catalog entry/)
  })

  test("rejects unsafe catalog bases before fetching", async () => {
    const fetcher = async () => {
      throw new Error("fetch should not run")
    }

    await expect(loadCatalog("file:///tmp/eikons", fetcher)).rejects.toThrow(/public catalog URL/)
    await expect(loadCatalog("http://localhost:1234/eikons", fetcher)).rejects.toThrow(/private host/)
    await expect(loadCatalog("https://eikon.liftaris.dev/eikons/../private", fetcher)).rejects.toThrow(/path escape/)
    await expect(loadCatalogEntries("http://169.254.169.254/eikons", fetcher)).rejects.toThrow(/private host/)
  })

  test("package entries without descriptor trust default to an empty trust object", () => {
    const e = catalogEntry(pkg("old", { trust: false }), "https://eikon.liftaris.dev/eikons/")
    expect(e.trust).toEqual({})
    expect(e.runtimeUrl).toBe("https://eikon.liftaris.dev/packages/liftaris/old/old.eikon")
    expect(e.packageUrl).toBe("https://eikon.liftaris.dev/packages/liftaris/old/1.0.0.json")
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
