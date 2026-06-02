import { describe, expect, test } from "bun:test"
import type { CatalogEntry } from "../src"
import { browserInstructions, createWebCatalog, parsePreview, webPlaybackFrame } from "../src/web/player"

const legacy = [
  JSON.stringify({ eikon: 1, name: "cycle", width: 2, height: 1, states: ["idle", "error"] }),
  JSON.stringify({ state: "idle", fps: 2, loop_from: 1 }),
  JSON.stringify({ f: 0, data: "A" }),
  JSON.stringify({ f: 1, data: "B" }),
  JSON.stringify({ f: 2, data: "C" }),
  JSON.stringify({ state: "error", fps: 4, loop: false }),
  JSON.stringify({ f: 0, data: "X" }),
  JSON.stringify({ f: 1, data: "Y" }),
].join("\n")

const launch = [
  JSON.stringify({ type: "header", asset: { version: "2.0", width: 2, height: 1 }, name: "cycle" }),
  JSON.stringify({ type: "clip", name: "idle", fps: 2, frameCount: 2, loopFrom: 0 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["A"] }),
  JSON.stringify({ type: "frame", clip: "idle", index: 1, rows: ["B"] }),
].join("\n") + "\n"

const entry: CatalogEntry = {
  kind: "eikon.catalog.entry",
  schemaVersion: "1.0",
  id: "liftaris/cycle",
  sourceKey: "cycle-id",
  name: "cycle",
  title: "Cycle",
  author: "Kaio",
  glyph: "⬡",
  tags: ["loop"],
  poster: "A",
  preview: "https://eikon.liftaris.dev/eikons/cycle/cycle.eikon",
  packageUrl: "https://eikon.liftaris.dev/eikons/cycle/manifest.json",
  installUrl: "https://eikon.liftaris.dev/eikons/cycle/manifest.json",
  compatibility: { eikon: ">=2 <3", available: true },
}

const index = JSON.stringify([entry])

describe("web gallery model", () => {
  test("renders catalog entries and filters by name, author, or tags", async () => {
    const catalog = createWebCatalog({
      loadCatalog: async () => [entry, { ...entry, sourceKey: "mono-id", id: "liftaris/mono", name: "mono", title: "Mono", author: "Nous", tags: [] }],
    })
    await catalog.refresh()
    expect(catalog.search("cycl").map(item => item.name)).toEqual(["cycle"])
    expect(catalog.search("NOUS").map(item => item.name)).toEqual(["mono"])
    expect(catalog.search("loop").map(item => item.name)).toEqual(["cycle"])
    expect(catalog.search("missing")).toEqual([])
  })

  test("loads selected previews and advances playback", async () => {
    const catalog = createWebCatalog({
      fetch: (async () => new Response(legacy)) as unknown as typeof fetch,
      loadCatalog: async () => [entry],
    })
    await catalog.refresh()
    const loaded = await catalog.preview(entry.sourceKey)
    expect(loaded.status).toBe("ready")
    if (loaded.status !== "ready") throw new Error("preview not ready")
    expect(webPlaybackFrame(loaded.eikon, "idle", 1000, 0)).toEqual(["C"])
  })

  test("parses launch stream previews from public exports", () => {
    const doc = parsePreview(launch)
    expect(doc.meta.version).toBe(2)
    expect(webPlaybackFrame(doc, "idle", 500, 0)).toEqual(["B"])
  })

  test("catalog load failure exposes retry state without activation or account actions", async () => {
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
    expect(safe.command).toBe(`herm eikon install ${entry.installUrl}`)
    expect(safe.manual).toContain(entry.preview!)
    expect(() => browserInstructions({ ...entry, installUrl: "javascript:alert(1)" })).toThrow(/unsafe/)
    expect(safe).not.toHaveProperty("hermUrl")
    expect(safe.command).not.toMatch(/publish|auth|login|token|activate|use |herm:\/\//)
  })

  test("fetch policy enforces byte limits before parse", async () => {
    const catalog = createWebCatalog({
      base: "https://eikon.liftaris.dev/eikons",
      maxBytes: 20,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith("/index.json")) return new Response(index)
        if (url.endsWith("/cycle/cycle.eikon")) return new Response(legacy)
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

test("web modules do not import host-only install, publish, OpenTUI, or SSH code", async () => {
  const app = await Bun.file(new URL("../src/web/App.tsx", import.meta.url)).text()
  const player = await Bun.file(new URL("../src/web/player.tsx", import.meta.url)).text()
  expect(`${app}\n${player}`).not.toMatch(/\.\.\/install|\.\.\/registry|@opentui|ssh2|gh |publish\(/)
})
