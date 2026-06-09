import { expect, test } from "bun:test"
import { resolve } from "node:path"
import { parse, poster, list, STATES } from "../src/ui/eikon"
import { local } from "../src/browse/catalog"
import { emit, picks, MARK } from "../src/browse/ipc"
import { decodeRuntimeFile } from "../src"

const dir = resolve(import.meta.dir, "../eikons")

test("parse: real catalog files round-trip via list+parse", () => {
  const found = list([dir])
  expect(found.length).toBeGreaterThanOrEqual(3)
  expect(found.map(f => f.path)).toContain(resolve(dir, "ares/ares.eikon"))
  for (const f of found) {
    expect(f.meta.width).toBe(48)
    expect(f.meta.height).toBe(24)
  }
})

test("parse: ares has 6 canonical states and a poster", () => {
  const raw = decodeRuntimeFile(resolve(dir, "ares/ares.eikon"))
  const e = parse(raw)
  for (const s of STATES) expect(e.clips.has(s)).toBe(true)
  expect(poster(e).split("\n").length).toBe(24)
})

test("catalog.local: list() returns entries with posters, load() returns raw bytes", async () => {
  const cat = local(dir)
  const xs = await cat.list()
  const ares = xs.find(e => e.name === "ares")
  expect(ares).toBeDefined()
  expect(ares!.poster?.length ?? 0).toBeGreaterThan(100)
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
  for await (const p of picks(src())) got.push({ name: p.name, raw: p.raw })

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

test("ipc: binary picks preserve stored bytes", async () => {
  const chunks: Buffer[] = []
  const sink = { write: (s: string | Uint8Array) => (chunks.push(Buffer.from(s)), true) } as NodeJS.WritableStream
  emit(sink)("gzip", new Uint8Array([0x1f, 0x8b, 0x08, 0xff]))
  async function* src() { for (const c of chunks) yield c }
  const got: number[][] = []
  for await (const p of picks(src())) got.push([...p.bytes])
  expect(got).toEqual([[0x1f, 0x8b, 0x08, 0xff]])
})
