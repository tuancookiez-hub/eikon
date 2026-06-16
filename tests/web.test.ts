import { describe, expect, test } from "bun:test"
import type { CatalogEntry } from "../src/browser"
import { browserInstructions, createWebCatalog, defaultState, parsePreview, webPlaybackFrame } from "../src/web/player"
import { runtimeDescriptor } from "../src"

function body(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

const launch = [
  JSON.stringify({
    type: "header",
    eikon: 1,
    id: "liftaris/cycle",
    version: "1.0.0",
    title: "Cycle",
    author: { name: "Kaio" },
    size: { cols: 1, rows: 1 },
    defaultSignal: "state.idle",
    signals: {
      "state.idle": { clip: "idle" },
      "state.error": { clip: "error", fallback: "state.idle" },
    },
  }),
  JSON.stringify({ type: "clip", name: "idle", fps: 2, frameCount: 3, loopFrom: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["A"] }),
  JSON.stringify({ type: "frame", clip: "idle", index: 1, rows: ["B"] }),
  JSON.stringify({ type: "frame", clip: "idle", index: 2, rows: ["C"] }),
  JSON.stringify({ type: "clip", name: "error", fps: 4, frameCount: 2, loopFrom: 2 }),
  JSON.stringify({ type: "frame", clip: "error", index: 0, rows: ["X"] }),
  JSON.stringify({ type: "frame", clip: "error", index: 1, rows: ["Y"] }),
].join("\n") + "\n"

const plain = runtimeDescriptor(launch)
const runtimeDigest = plain.digest.replace("sha256:", "")
const runtimePath = `/packages/liftaris/cycle/blobs/sha256/${runtimeDigest}`

const entry: CatalogEntry = {
  kind: "eikon.catalog.entry",
  schemaVersion: "1.0",
  id: "liftaris/cycle",
  version: "1.0.0",
  sourceKey: "registry:eikon.liftaris.dev:liftaris/cycle@1.0.0",
  name: "cycle",
  title: "Cycle",
  author: "Kaio",
  glyph: "⬡",
  tags: ["loop"],
  poster: "A",
  runtimeUrl: `https://eikon.liftaris.dev${runtimePath}`,
  packageUrl: "https://eikon.liftaris.dev/packages/liftaris/cycle/1.0.0.json",
  detailUrl: "https://eikon.liftaris.dev/eikons/cycle",
  compatibility: { eikon: ">=1 <2", available: true },
}

const index = JSON.stringify([entry])

describe("web gallery model", () => {
  test("renders catalog entries and filters by name, author, or tags", async () => {
    const catalog = createWebCatalog({
      loadCatalog: async () => [entry, { ...entry, sourceKey: "registry:eikon.liftaris.dev:liftaris/mono@1.0.0", id: "liftaris/mono", name: "mono", title: "Mono", author: "Nous", tags: [] }],
    })
    await catalog.refresh()
    expect(catalog.search("cycl").map(item => item.name)).toEqual(["cycle"])
    expect(catalog.search("NOUS").map(item => item.name)).toEqual(["mono"])
    expect(catalog.search("loop").map(item => item.name)).toEqual(["cycle"])
    expect(catalog.search("missing")).toEqual([])
  })

  test("loads selected runtime previews and advances playback", async () => {
    const seen: string[] = []
    const catalog = createWebCatalog({
      fetch: (async (input: string | URL | Request) => { seen.push(String(input)); return new Response(launch) }) as unknown as typeof fetch,
      loadCatalog: async () => [entry],
    })
    await catalog.refresh()
    const loaded = await catalog.preview(entry.sourceKey)
    expect(loaded.status).toBe("ready")
    if (loaded.status !== "ready") throw new Error("preview not ready")
    expect(seen[0]).toBe(entry.runtimeUrl)
    expect(webPlaybackFrame(loaded.eikon, "idle", 1000, 0)).toEqual(["C"])
  })

  test("loads ambient card previews by catalog key", async () => {
    const catalog = createWebCatalog({
      fetch: (async () => new Response(launch)) as unknown as typeof fetch,
      loadCatalog: async () => [entry],
    })
    await catalog.refresh()
    expect(catalog.cached(entry.sourceKey)).toBeUndefined()

    await catalog.loadPreview(entry.sourceKey)
    const loaded = catalog.cached(entry.sourceKey)
    expect(loaded?.status).toBe("ready")
    if (loaded?.status !== "ready") throw new Error("preview not ready")
    expect(defaultState(loaded.eikon)).toBe("idle")
    expect(webPlaybackFrame(loaded.eikon, defaultState(loaded.eikon), 500, 0)).toEqual(["B"])
  })

  test("loads gzip runtime preview bytes and rejects content-encoded artifact responses", async () => {
    const info = runtimeDescriptor(launch, { encoding: "gzip" })
    const zip = {
      ...entry,
      trust: {
        runtimeDigest: info.digest,
        runtimeSize: info.size,
        runtimeEncoding: "gzip" as const,
        runtimeDecodedSize: info.decodedSize,
        runtimeDecodedDigest: info.decodedDigest,
      },
    }
    const catalog = createWebCatalog({
      fetch: (async () => new Response(body(info.bytes))) as unknown as typeof fetch,
      loadCatalog: async () => [zip],
    })
    await catalog.refresh()
    const loaded = await catalog.preview(zip.sourceKey)
    expect(loaded.status).toBe("ready")
    if (loaded.status !== "ready") throw new Error("preview not ready")
    expect(webPlaybackFrame(loaded.eikon, "idle", 1000, 0)).toEqual(["C"])

    const bad = createWebCatalog({
      fetch: (async () => new Response(body(info.bytes), { headers: { "content-encoding": "gzip" } })) as unknown as typeof fetch,
      loadCatalog: async () => [zip],
    })
    await bad.refresh()
    const failed = await bad.preview(zip.sourceKey)
    expect(failed.status).toBe("error")
    if (failed.status !== "error") throw new Error("preview unexpectedly loaded")
    expect(failed.error).toMatch(/Content-Encoding/)
  })

  test("loads final checked-in index shape through runtimeUrl", async () => {
    const seen: string[] = []
    const catalog = createWebCatalog({
      base: "https://eikon.liftaris.dev/eikons",
      fetch: (async (input: string | URL | Request) => {
        const url = new URL(String(input))
        seen.push(url.pathname)
        if (url.pathname === "/eikons/index.json") return new Response(index)
        if (url.pathname === runtimePath) return new Response(launch)
        return new Response("missing", { status: 404 })
      }) as unknown as typeof fetch,
    })
    await catalog.refresh()
    const loaded = await catalog.preview(catalog.state.entries[0]!.sourceKey)
    expect(loaded.status).toBe("ready")
    expect(seen).toEqual(["/eikons/index.json", runtimePath])
  })

  test("resolves the default browser catalog against the current origin", async () => {
    const originalLocation = Object.getOwnPropertyDescriptor(globalThis, "location")
    Object.defineProperty(globalThis, "location", { value: new URL("https://preview.example/gallery"), configurable: true })
    try {
      const seen: string[] = []
      const catalog = createWebCatalog({
        fetch: (async (input: string | URL | Request) => {
          seen.push(String(input))
          if (String(input) === "https://preview.example/eikons/index.json") return new Response(index)
          return new Response("missing", { status: 404 })
        }) as unknown as typeof fetch,
      })

      await catalog.refresh()

      expect(catalog.state.status).toBe("ready")
      expect(catalog.state.entries.map(item => item.name)).toEqual(["cycle"])
      expect(seen).toEqual(["https://preview.example/eikons/index.json"])
    } finally {
      if (originalLocation) Object.defineProperty(globalThis, "location", originalLocation)
      else Reflect.deleteProperty(globalThis, "location")
    }
  })

  test("absolute private catalog URLs stay blocked in the browser model", async () => {
    const catalog = createWebCatalog({
      base: "http://169.254.169.254/eikons",
      fetch: (async () => new Response(index)) as unknown as typeof fetch,
    })

    await catalog.refresh()

    expect(catalog.state.status).toBe("error")
    expect(catalog.state.error).toMatch(/private host/)
  })

  test("parses launch stream previews from public exports", () => {
    const doc = parsePreview(launch)
    expect(doc.meta.version).toBe(1)
    expect(webPlaybackFrame(doc, "idle", 500, 0)).toEqual(["B"])
  })

  test("catalog load failure exposes retry action", async () => {
    const catalog = createWebCatalog({ loadCatalog: async () => { throw new Error("network down") } })
    await catalog.refresh()
    expect(catalog.state.status).toBe("error")
    expect(catalog.actions()).toEqual(["retry"])
  })

  test("no matches clear stale selection", async () => {
    const catalog = createWebCatalog({ loadCatalog: async () => [entry] })
    await catalog.refresh()
    catalog.select(entry.sourceKey)
    expect(catalog.selected()?.name).toBe("cycle")
    expect(catalog.search("missing")).toEqual([])
    expect(catalog.selected()).toBeUndefined()
  })

  test("preview failures keep catalog and copy instructions usable", async () => {
    const catalog = createWebCatalog({
      fetch: (async () => new Response("not json")) as unknown as typeof fetch,
      loadCatalog: async () => [entry],
    })
    await catalog.refresh()
    const loaded = await catalog.preview(entry.sourceKey)
    expect(loaded.status).toBe("error")
    expect(catalog.search("cycle").map(item => item.name)).toEqual(["cycle"])
    expect(catalog.actions()).toEqual(["copy-instructions", "retry-preview"])
  })

  test("instructions are copyable and discovery-only", () => {
    const safe = browserInstructions(entry)
    expect(safe).toEqual({ command: `herm eikon install ${entry.packageUrl}` })
    expect(() => browserInstructions({ ...entry, packageUrl: "javascript:alert(1)" })).toThrow(/unsafe/)
  })

  test("instructions quote shell-sensitive package URLs", () => {
    const quoted = browserInstructions({ ...entry, packageUrl: "https://example.test/pkg?name=cycle&run=$(id)" })

    expect(quoted.command).toBe("herm eikon install 'https://example.test/pkg?name=cycle&run=$(id)'")
  })

  test("fetch policy enforces byte limits before parse", async () => {
    const catalog = createWebCatalog({
      base: "https://eikon.liftaris.dev/eikons",
      maxBytes: 20,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith("/index.json")) return new Response(index)
        if (url.endsWith(runtimePath)) return new Response(launch)
        return new Response("missing", { status: 404 })
      }) as unknown as typeof fetch,
    })
    await catalog.refresh()
    const loaded = await catalog.preview(catalog.state.entries[0]!.sourceKey)
    expect(loaded.status).toBe("error")
    if (loaded.status !== "error") throw new Error("preview unexpectedly loaded")
    expect(loaded.error).toMatch(/size limit/)
  })
})

test("web modules import only the browser-safe boundary, not host-only code", async () => {
  const app = await Bun.file(new URL("../src/web/App.tsx", import.meta.url)).text()
  const player = await Bun.file(new URL("../src/web/player.tsx", import.meta.url)).text()
  const browser = await Bun.file(new URL("../src/browser.ts", import.meta.url)).text()
  expect(`${app}\n${player}`).not.toMatch(/from\s+["']\.\.\/(install|registry|browse|ui|stream|contract)(?:["'\/])/)
  expect(`${app}\n${player}`).not.toMatch(/@opentui|ssh2|from\s+["']node:|gh |publish\(/)
  expect(browser).not.toMatch(/node:fs|node:path|\.\/install|\.\/registry|\.\/browse|@opentui|ssh2|gh |publish\(/)
})
