import { expect, test, beforeAll, afterAll } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join, resolve } from "node:path"
import { index } from "../src/registry"
import { remote } from "../src/browse/catalog"
import { lint, lintRegistry } from "../src/ui/lint"

const dir = resolve(import.meta.dir, "../eikons")
let srv: ReturnType<typeof Bun.serve>

beforeAll(() => {
  srv = Bun.serve({
    port: 0,
    fetch: req => new Response(Bun.file(resolve(dir, new URL(req.url).pathname.slice(1)))),
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
    license: "MIT",
    description: `${name} test eikon`,
    homepage_url: `https://example.com/${name}`,
    ...meta,
  }) + "\n" + ["idle", "listening", "thinking", "speaking", "working", "error"]
    .flatMap(state => [JSON.stringify({ state, fps: 12 }), JSON.stringify({ data: "abcd\\nefgh\\nijkl\\nmnop" })])
    .join("\n") + "\n"
}

function tmpCatalog() {
  const root = mkdtempSync(join(tmpdir(), "eikon-registry-"))
  mkdirSync(join(root, "eikons"))
  writeFileSync(join(root, "eikons/index.json"), "[]\n")
  return root
}

test("remote catalog: index + load round-trip over http", async () => {
  const cat = remote(`http://localhost:${srv.port}`)
  const xs = await cat.list()
  expect(xs.length).toBe(3)
  expect(xs.find(e => e.name === "ares")?.glyph).toBe("⚔")
  const raw = await cat.load("mono")
  expect(raw.startsWith('{"eikon"')).toBe(true)
})

test("lint: accepts valid, rejects missing glyph", async () => {
  const good = await Bun.file(resolve(dir, "ares/ares.eikon")).text()
  expect(lint(good).meta.name).toBe("ares")

  const bad = good.replace('"glyph":"⚔"', '"x":1')
  expect(() => lint(bad)).toThrow(/glyph required/)
})

test("registry index: emits enriched deterministic entries and stamps canonical source_url", async () => {
  const root = tmpCatalog()
  try {
    for (const name of ["zeta", "alpha"]) {
      mkdirSync(join(root, "eikons", name))
      writeFileSync(join(root, "eikons", name, `${name}.eikon`), raw(name, { tags: ["demo", name], source_url: "http://old.example/" }))
      writeFileSync(join(root, "eikons", name, "manifest.json"), JSON.stringify({
        name,
        version: 2,
        states: {},
      }))
    }

    const cwd = process.cwd()
    process.chdir(root)
    const n = await index("https://cdn.example/eikons/")
    process.chdir(cwd)

    expect(n).toBe(2)
    const entries = JSON.parse(await Bun.file(join(root, "eikons/index.json")).text())
    expect(entries.map((e: { name: string }) => e.name)).toEqual(["alpha", "zeta"])
    expect(entries[0]).toMatchObject({
      name: "alpha",
      author: "maker",
      glyph: "◆",
      w: 8,
      h: 4,
      license: "MIT",
      description: "alpha test eikon",
      source: "alpha/",
      source_url: "https://cdn.example/eikons/alpha/",
      tags: ["alpha", "demo"],
    })
    const stamped = JSON.parse((await Bun.file(join(root, "eikons/alpha/alpha.eikon")).text()).split("\n", 1)[0]!)
    expect(stamped.source_url).toBe("https://cdn.example/eikons/alpha/")
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})

test("registry lint: requires marketplace trust metadata for public entries", () => {
  expect(() => lintRegistry(raw("plain", { license: undefined }))).toThrow(/header.license required/)
  expect(() => lint(raw("plain", { license: undefined }))).not.toThrow()
})

test("registry lint: rejects unsafe public content before indexing", () => {
  const unsafe = raw("bad", { source_url: "http://127.0.0.1/eikons/bad/", description: "bad\u001bdesc" })
  expect(() => lintRegistry(unsafe)).toThrow(/control character|source_url/)
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

  for (const source_url of urls)
    expect(() => lintRegistry(raw("bad", { source_url }))).toThrow(/public host/)
  expect(() => lintRegistry(raw("bad", { homepage_url: "https://[::ffff:192.168.1.1]/" }))).toThrow(/public host/)
})

test("registry lint: rejects metadata control characters with otherwise valid URLs", () => {
  const unsafe = raw("bad", {
    source_url: "https://cdn.example/eikons/bad/",
    repository_url: "https://github.com/example/bad",
    description: "bad\u001bdesc",
  })

  expect(() => lintRegistry(unsafe)).toThrow(/metadata contains control characters/)
})
