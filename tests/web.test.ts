import { describe, expect, test } from "bun:test"
import { stat } from "node:fs/promises"
import { resolve } from "node:path"
import { parse } from "../src/ui/eikon"
import { frameAt, playbackFrame, stateClip } from "../src/player/model"
import { fixedClock, manualClock, systemClock, type Clock } from "../src/player/clock"
import { browserInstructions, createWebCatalog, webPlaybackFrame } from "../src/web/player"

const raw = [
  JSON.stringify({ eikon: 1, name: "cycle", width: 2, height: 1, states: ["idle", "error"] }),
  JSON.stringify({ state: "idle", fps: 2, loop_from: 1 }),
  JSON.stringify({ f: 0, data: "A" }),
  JSON.stringify({ f: 1, data: "B" }),
  JSON.stringify({ f: 2, data: "C" }),
  JSON.stringify({ state: "error", fps: 4, loop: false }),
  JSON.stringify({ f: 0, data: "X" }),
  JSON.stringify({ f: 1, data: "Y" }),
].join("\n")

const entry = {
  name: "cycle",
  author: "Kaio",
  glyph: "⬡",
  w: 2,
  h: 1,
  width: 2,
  height: 1,
  poster: "A",
  trust: {},
  previewUrl: "https://eikon.liftaris.dev/eikons/cycle/cycle.eikon",
  installUrl: "https://eikon.liftaris.dev/eikons/cycle/manifest.json",
  sourceKey: "https://eikon.liftaris.dev/eikons/cycle/",
  identityKey: "cycle-id",
  raw: { name: "cycle" },
}

const index = JSON.stringify([{
  name: "cycle",
  author: "Kaio",
  glyph: "⬡",
  width: 2,
  height: 1,
  poster: "A",
  preview_url: "cycle/cycle.eikon",
  install_url: "cycle/manifest.json",
}])

describe("playback primitives", () => {
  test("selects requested clip with idle fallback", () => {
    const doc = parse(raw)
    expect(stateClip(doc, "idle")?.frames[0]).toEqual(["A"])
    expect(stateClip(doc, "missing")?.frames[0]).toEqual(["A"])
  })

  test("advances intro once then loops from loop_from", () => {
    const clip = stateClip(parse(raw), "idle")!
    expect(frameAt(clip, 0)).toEqual(["A"])
    expect(frameAt(clip, 500)).toEqual(["B"])
    expect(frameAt(clip, 1000)).toEqual(["C"])
    expect(frameAt(clip, 1500)).toEqual(["B"])
    expect(frameAt(clip, 2000)).toEqual(["C"])
  })

  test("holds final frame for non-looping clips", () => {
    const clip = stateClip(parse(raw), "error")!
    expect(frameAt(clip, 0)).toEqual(["X"])
    expect(frameAt(clip, 250)).toEqual(["Y"])
    expect(frameAt(clip, 500)).toEqual(["Y"])
  })

  test("manual and fixed clocks provide deterministic elapsed time", () => {
    const fixed = fixedClock(250)
    const manual = manualClock(1000)
    expect(fixed.now()).toBe(250)
    expect(manual.now()).toBe(1000)
    manual.tick(125)
    expect(manual.now()).toBe(1125)
    expect(typeof systemClock().now()).toBe("number")
  })

  test("playbackFrame uses clock deltas from selection time", () => {
    const doc = parse(raw)
    const clock: Clock = fixedClock(1750)
    expect(playbackFrame(doc, "idle", clock, 1000)).toEqual(["B"])
  })

  test("web preview playback restarts from state selection time and loops play-once clips", () => {
    const doc = parse(raw)
    expect(webPlaybackFrame(doc, "error", 1750, 0)).toEqual(["Y"])
    expect(webPlaybackFrame(doc, "error", 1750, 1700)).toEqual(["X"])
    expect(webPlaybackFrame(doc, "error", 2250, 1700)).toEqual(["X"])
  })
})

describe("browser catalog model", () => {
  test("renders catalog entries and filters by name or author", async () => {
    const catalog = createWebCatalog({
      loadCatalog: async () => ({
        base: "https://eikon.liftaris.dev/eikons",
        entries: [entry, { ...entry, name: "mono", author: "Nous", identityKey: "mono-id" }],
        load: async () => raw,
      }),
    })
    await catalog.refresh()
    expect(catalog.search("cycl").map(e => e.name)).toEqual(["cycle"])
    expect(catalog.search("NOUS").map(e => e.name)).toEqual(["mono"])
    expect(catalog.search("missing")).toEqual([])
  })

  test("loads selected full eikon and advances preview through helpers", async () => {
    const catalog = createWebCatalog({
      fetch: (async () => new Response(raw)) as unknown as typeof fetch,
      loadCatalog: async () => ({ base: "https://eikon.liftaris.dev/eikons", entries: [entry], load: async () => raw }),
    })
    await catalog.refresh()
    const loaded = await catalog.preview(entry.identityKey)
    expect(loaded.status).toBe("ready")
    if (loaded.status !== "ready") throw new Error("preview not ready")
    expect(playbackFrame(loaded.eikon, "idle", fixedClock(1000), 0)).toEqual(["C"])
  })

  test("loads gallery previews without selecting entries", async () => {
    const catalog = createWebCatalog({
      fetch: (async () => new Response(raw)) as unknown as typeof fetch,
      loadCatalog: async () => ({ base: "https://eikon.liftaris.dev/eikons", entries: [entry], load: async () => raw }),
    })
    await catalog.refresh()

    const loaded = await catalog.loadPreview(entry.identityKey)

    expect(catalog.selected()).toBeUndefined()
    expect(loaded.status).toBe("ready")
    if (loaded.status !== "ready") throw new Error("preview not ready")
    expect(playbackFrame(loaded.eikon, "idle", fixedClock(1000), 0)).toEqual(["C"])
    expect(catalog.state.previews[entry.identityKey]?.status).toBe("ready")
  })

  test("catalog load failure exposes retry state without install or auth actions", async () => {
    const catalog = createWebCatalog({
      loadCatalog: async () => { throw new Error("network down") },
    })
    await catalog.refresh()
    expect(catalog.state.status).toBe("error")
    expect(catalog.actions()).toEqual(["retry"])
  })

  test("no matches clear stale selection", async () => {
    const catalog = createWebCatalog({
      loadCatalog: async () => ({ base: "https://eikon.liftaris.dev/eikons", entries: [entry], load: async () => raw }),
    })
    await catalog.refresh()
    catalog.select(entry.identityKey)
    expect(catalog.selected()?.name).toBe("cycle")
    expect(catalog.search("missing")).toEqual([])
    expect(catalog.selected()).toBeUndefined()
    expect(catalog.search("").map(e => e.name)).toEqual(["cycle"])
  })

  test("preview load failures keep catalog usable", async () => {
    const catalog = createWebCatalog({
      fetch: (async () => new Response("not json")) as unknown as typeof fetch,
      loadCatalog: async () => ({ base: "https://eikon.liftaris.dev/eikons", entries: [entry], load: async () => "not json" }),
    })
    await catalog.refresh()
    const loaded = await catalog.preview(entry.identityKey)
    expect(loaded.status).toBe("error")
    expect(catalog.search("cycle").map(e => e.name)).toEqual(["cycle"])
    expect(catalog.actions()).toEqual(["copy-instructions", "retry-preview"])
  })

  test("instructions reject dangerous schemes and stay discovery-only", () => {
    const safe = browserInstructions(entry)
    expect(safe.command).toContain("eikon install")
    expect(safe.command).toContain(entry.installUrl)
    expect(safe.manual).toContain(entry.previewUrl)
    expect(() => browserInstructions({ ...entry, installUrl: "javascript:alert(1)" })).toThrow(/unsafe/)
    expect(safe).not.toHaveProperty("hermUrl")
    expect(safe.command).not.toMatch(/publish|auth|login|token|use |herm:\/\//)
  })

  test("fetch policy enforces timeout, byte, concurrency, and cache limits", async () => {
    const catalog = createWebCatalog({
      maxBytes: 20,
      timeoutMs: 50,
      concurrency: 1,
      cacheEntries: 1,
      fetch: (async () => new Response(raw)) as unknown as typeof fetch,
      loadCatalog: async () => ({
        base: "https://eikon.liftaris.dev/eikons",
        entries: [entry],
        load: async e => catalog.fetchText(typeof e === "string" ? entry.previewUrl : e.previewUrl),
      }),
    })
    await catalog.refresh()
    await expect(catalog.fetchText(entry.previewUrl)).rejects.toThrow(/size limit/)
    expect(catalog.policy()).toEqual({ maxBytes: 20, timeoutMs: 50, concurrency: 1, cacheEntries: 1 })
  })

  test("default fetch policy covers packed registry previews", async () => {
    const sizes = await Promise.all([
      stat(resolve(import.meta.dir, "../eikons/ares/ares.eikon")),
      stat(resolve(import.meta.dir, "../eikons/mono/mono.eikon")),
      stat(resolve(import.meta.dir, "../eikons/nous/nous.eikon")),
    ])

    expect(createWebCatalog().policy().maxBytes).toBeGreaterThan(Math.max(...sizes.map(s => s.size)))
  })

  test("default catalog preview fetches enforce the byte policy before parse", async () => {
    const base = "https://eikon.liftaris.dev/eikons"
    const catalog = createWebCatalog({
      base,
      maxBytes: 20,
      fetch: (async (input: string | URL | Request) => {
        const url = String(input)
        if (url.endsWith("/index.json")) return new Response(index)
        if (url.endsWith("/cycle/cycle.eikon")) return new Response(raw)
        return new Response("missing", { status: 404 })
      }) as unknown as typeof fetch,
    })
    await catalog.refresh()

    const loaded = await catalog.preview(catalog.state.entries[0]!.identityKey)

    expect(loaded.status).toBe("error")
    if (loaded.status !== "error") throw new Error("preview unexpectedly loaded")
    expect(loaded.error).toMatch(/size limit/)
  })

  test("default catalog preview fetches enforce timeout and caller cancellation", async () => {
    const base = "https://eikon.liftaris.dev/eikons"
    const stalled = (message: string) => (async (input: string | URL | Request, init?: RequestInit) => {
      const url = String(input)
      if (url.endsWith("/index.json")) return new Response(index)
      return new Promise<Response>((_, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error(message)), { once: true })
      })
    }) as unknown as typeof fetch
    const timed = createWebCatalog({ base, timeoutMs: 1, fetch: stalled("preview fetch timed out") })
    await timed.refresh()

    const timeout = await timed.preview(timed.state.entries[0]!.identityKey)

    expect(timeout.status).toBe("error")
    if (timeout.status !== "error") throw new Error("preview unexpectedly loaded")
    expect(timeout.error).toMatch(/timed out/)

    const cancelled = createWebCatalog({ base, timeoutMs: 1_000, fetch: stalled("preview fetch cancelled") })
    await cancelled.refresh()
    const ctrl = new AbortController()
    const preview = cancelled.preview(cancelled.state.entries[0]!.identityKey, ctrl.signal)
    ctrl.abort()
    const abort = await preview

    expect(abort.status).toBe("error")
    if (abort.status !== "error") throw new Error("preview unexpectedly loaded")
    expect(abort.error).toMatch(/cancelled/)
  })
})
