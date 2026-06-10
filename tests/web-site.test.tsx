/** @jsxImportSource react */
import { expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { App } from "../src/web/App"

const repo = resolve(import.meta.dir, "..")

test("public page renders", () => {
  expect(renderToStaticMarkup(<App />).length).toBeGreaterThan(0)
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
