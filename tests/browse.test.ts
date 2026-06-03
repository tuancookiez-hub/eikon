import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { parse, poster, list, STATES } from "../src/ui/eikon"
import { local } from "../src/browse/catalog"
import { emit, picks, MARK } from "../src/browse/ipc"

const dir = resolve(import.meta.dir, "../eikons")

test("parse: real catalog files round-trip via list+parse", () => {
  const found = list([dir])
  expect(found.length).toBeGreaterThanOrEqual(3)
  expect(found.map(f => f.path).filter(p => p.endsWith(".eikonl")).length).toBeGreaterThanOrEqual(3)
  expect(found.map(f => f.path)).not.toContain(resolve(dir, "ares/ares.eikon"))
  for (const f of found) {
    expect(f.meta.width).toBe(48)
    expect(f.meta.height).toBe(24)
  }
})

test("parse: ares has 6 canonical states and a poster", async () => {
  const raw = await Bun.file(resolve(dir, "ares/ares.eikon")).text()
  const e = parse(raw)
  for (const s of STATES) expect(e.clips.has(s)).toBe(true)
  expect(poster(e).split("\n").length).toBe(24)
})

test("catalog.local: list() returns entries with posters, load() returns raw bytes", async () => {
  const cat = local(dir)
  const xs = await cat.list()
  expect(xs.find(e => e.name === "ares")?.poster.length).toBeGreaterThan(100)
  const raw = await cat.load("ares")
  expect(raw.startsWith("{")).toBe(true)
  expect(parse(raw).meta.name).toBe("ares")
})

test("ipc: emit → picks round-trip with interleaved noise", async () => {
  const chunks: Buffer[] = []
  const sink = { write: (s: string) => (chunks.push(Buffer.from(s)), true) } as NodeJS.WritableStream
  const send = emit(sink)

  sink.write("stderr noise line\n")
  send("ares", "RAW-ARES-BODY")
  sink.write("more noise\n")
  send("mono", "RAW-MONO-BODY-ΔΔ")  // multibyte → size uses byteLength

  async function* src() { for (const c of chunks) yield c }
  const got: { name: string; raw: string }[] = []
  for await (const p of picks(src())) got.push(p)

  expect(got).toEqual([
    { name: "ares", raw: "RAW-ARES-BODY" },
    { name: "mono", raw: "RAW-MONO-BODY-ΔΔ" },
  ])
})

test("ipc: header split across chunk boundary", async () => {
  const head = MARK + JSON.stringify({ pick: "x", size: 3 }) + "\nABC"
  async function* src() {
    yield Buffer.from(head.slice(0, 5))
    yield Buffer.from(head.slice(5))
  }
  const got: string[] = []
  for await (const p of picks(src())) got.push(p.raw)
  expect(got).toEqual(["ABC"])
})
