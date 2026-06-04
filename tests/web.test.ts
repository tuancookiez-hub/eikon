import { describe, expect, test } from "bun:test"
import type { CatalogEntry } from "../src/browser"
import { browserInstructions, createWebCatalog, parsePreview, webPlaybackFrame } from "../src/web/player"

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

const runtimeDigest = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef"
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
  preview: `https://eikon.liftaris.dev${runtimePath}`,
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
    expect(safe.command).toBe(`herm eikon install ${entry.packageUrl}`)
    expect(safe.manual).toBe(`Copy the command into Herm locally. Preview source: ${entry.runtimeUrl}`)
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
