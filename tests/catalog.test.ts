import { expect, test, beforeAll, afterAll } from "bun:test"
import { resolve } from "node:path"
import { remote } from "../src/browse/catalog"
import { lint } from "../src/ui/lint"

const dir = resolve(import.meta.dir, "../eikons")
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
  expect(raw.startsWith('{"type":"header","eikon":1')).toBe(true)
})

test("lint: accepts valid launch streams, rejects missing author", async () => {
  const good = await Bun.file(resolve(dir, "ares/ares.eikon")).text()
  expect(lint(good).meta.name).toBe("ares")

  const bad = good.replace('"author":{"name":"kaio"}', '"author":{}')
  expect(() => lint(bad)).toThrow(/author required/)
})
