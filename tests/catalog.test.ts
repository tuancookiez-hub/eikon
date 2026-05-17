import { expect, test, beforeAll, afterAll } from "bun:test"
import { resolve } from "node:path"
import { remote } from "../src/browse/catalog"
import { lint } from "../src/ui/lint"

const dir = resolve(import.meta.dir, "../catalog")
let srv: ReturnType<typeof Bun.serve>

beforeAll(() => {
  srv = Bun.serve({
    port: 0,
    fetch: req => new Response(Bun.file(resolve(dir, new URL(req.url).pathname.slice(1)))),
  })
})
afterAll(() => srv.stop())

test("remote catalog: index + load round-trip over http", async () => {
  const cat = remote(`http://localhost:${srv.port}`)
  const xs = await cat.list()
  expect(xs.length).toBe(3)
  expect(xs.find(e => e.name === "ares")?.glyph).toBe("⚔")
  const raw = await cat.load("mono")
  expect(raw.startsWith('{"eikon"')).toBe(true)
})

test("lint: accepts valid, rejects missing glyph", async () => {
  const good = await Bun.file(resolve(dir, "ares.eikon")).text()
  expect(lint(good).meta.name).toBe("ares")

  const bad = good.replace('"glyph":"⚔"', '"x":1')
  expect(() => lint(bad)).toThrow(/glyph required/)
})
