/** @jsxImportSource react */
import { expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { App, WEB_PREVIEW_FPS, WEB_PREVIEW_FRAME_MS } from "../src/web/App"

const repo = resolve(import.meta.dir, "..")

test("public page copy stays gallery-focused and avoids placeholder names", () => {
  const html = renderToStaticMarkup(<App />)

  expect(html).toContain("<h1>eikon</h1>")
  expect(html).toContain("A terminal avatar format for Herm")
  expect(html).toContain("Search by name or author")
  expect(html).toContain("Search catalog")
  expect(html).toContain("drawer-collapsed")
  expect(html).not.toContain("Reload preview")
  expect(html).not.toContain("Load preview")
  expect(html).not.toMatch(/\bmirror\b/i)
  expect(html).not.toContain("eikon.liftaris.dev")
  expect(html).not.toMatch(/ares,\s*kaio|kaio,\s*nous|nous…/i)
})

test("web build publishes catalog assets and lets eikon paths hit the filesystem", async () => {
  const proc = Bun.spawn(["bun", "run", "web:build"], { cwd: repo, stdout: "ignore", stderr: "pipe" })
  const exit = await proc.exited
  if (exit !== 0) throw new Error(await new Response(proc.stderr).text())

  const root = join(repo, "dist/web")
  const index = await Bun.file(join(root, "eikons/index.json")).json()
  expect(Array.isArray(index)).toBe(true)
  expect(index.length).toBeGreaterThan(0)
  expect(await Bun.file(join(root, "eikons/ares/ares.eikon")).exists()).toBe(true)

  const html = await Bun.file(join(root, "index.html")).text()
  expect(html).toContain("<title>eikon</title>")

  const vercel = await Bun.file(join(repo, "vercel.json")).json()
  expect(vercel.rewrites).toBeUndefined()
})

test("web preview uses terminal-like cells, square cards, mobile drawer, and smooth timing", async () => {
  const css = await Bun.file(join(repo, "src/web/style.css")).text()

  expect(WEB_PREVIEW_FPS).toBeGreaterThanOrEqual(16)
  expect(WEB_PREVIEW_FRAME_MS).toBeLessThanOrEqual(1000 / 16)
  expect(css).toContain("--terminal-line-height: 1.18")
  expect(css).toContain("line-height: var(--terminal-line-height)")
  expect(css).toContain("overflow-x: clip")
  expect(css).toContain("aspect-ratio: 1 / 1")
  expect(css).toContain("place-items: center")
  expect(css).toContain("grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr))")
  expect(css).toContain("position: fixed")
  expect(css).toContain(".detail.drawer-collapsed { height: 48px; }")
  expect(css).toContain(".detail.drawer-peek { height: min(58dvh, 500px); }")
  expect(css).toContain(".detail.drawer-expanded { height: calc(100dvh - 10px - env(safe-area-inset-top)); }")
  expect(css).toContain(".detail.drawer-peek .drawerExtras")
  expect(css).not.toMatch(/\.ascii\s*\{[^}]*line-height:\s*1[;}]/)
  expect(css).not.toMatch(/\.cardPoster\s*\{[^}]*line-height:\s*1[;}]/)
})
