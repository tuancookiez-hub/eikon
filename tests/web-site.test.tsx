/** @jsxImportSource react */
import { expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import type { CatalogEntry } from "../src/browser"
import { App } from "../src/web/App"
import { EntryCard } from "../src/web/player"

const repo = resolve(import.meta.dir, "..")

test("public page renders", () => {
  expect(renderToStaticMarkup(<App />).length).toBeGreaterThan(0)
})

test("card previews render as container-filling svg rows", () => {
  const entry = { name: "cycle", title: "Cycle", author: "Kaio", poster: "AB\nCD" } as CatalogEntry
  const html = renderToStaticMarkup(<EntryCard entry={entry} selected={false} onPick={() => {}} />)
  expect(html).toContain("<svg")
  expect(html).toContain("class=\"cardPoster\"")
  expect(html).toContain("viewBox=\"0 0 2 2\"")
  expect(html).toContain("textLength=\"2\"")
})

test("web build publishes static assets", async () => {
  const proc = Bun.spawn(["bun", "run", "web:build"], { cwd: repo, stdout: "ignore", stderr: "pipe" })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(await new Response(proc.stderr).text())

  const root = join(repo, "dist/web")
  const index = await Bun.file(join(root, "eikons/index.json")).json()
  expect(Array.isArray(index)).toBe(true)
  expect(index.length).toBeGreaterThan(0)
  expect(await Bun.file(join(root, "eikons/ares/ares.eikon")).exists()).toBe(true)
  expect(await Bun.file(join(root, "index.html")).exists()).toBe(true)
  expect(await Bun.file(join(root, "favicon.svg")).exists()).toBe(true)
  expect(await Bun.file(join(root, "assets/main.js")).exists()).toBe(true)
  expect(await Bun.file(join(root, "assets/main.css")).exists()).toBe(true)
})
