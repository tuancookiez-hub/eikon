/** @jsxImportSource react */
import { expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { App, WEB_PREVIEW_FPS, WEB_PREVIEW_FRAME_MS } from "../src/web/App"
import { browserInstructions, EntryCard } from "../src/web/player"

const repo = resolve(import.meta.dir, "..")

test("public page copy stays gallery-focused and avoids placeholder names", () => {
  const html = renderToStaticMarkup(<App />)

  expect(html).toContain("<h1>𝝴ikon</h1>")
  expect(html).toContain("A terminal avatar format for Herm")
  expect(html).toContain("Search by name or author")
  expect(html).toContain("Search catalog")
  expect(html).toContain("drawer-collapsed")
  expect(html).not.toContain("Reload preview")
  expect(html).not.toContain("Load preview")
  expect(html).not.toMatch(/\bmirror\b/i)
  expect(html).toContain("<code>herm eikon install &lt;url&gt;</code>")
  expect(html).not.toContain("<code>eikon install &lt;url&gt;</code>")
  expect(html).not.toContain("Open Herm detail")
  expect(html).not.toContain("herm://")
  expect(html).not.toContain("eikon.liftaris.dev")
  expect(html).not.toMatch(/ares,\s*kaio|kaio,\s*nous|nous…/i)
})

test("install instructions use Herm instead of the standalone eikon executable", () => {
  const entry = {
    name: "ares",
    author: "kaio",
    glyph: "⚔",
    width: 48,
    height: 24,
    w: 48,
    h: 24,
    poster: "██",
    trust: {},
    previewUrl: "https://eikon.liftaris.dev/eikons/ares/ares.eikon",
    installUrl: "https://eikon.liftaris.dev/eikons/ares/",
    sourceKey: "https://eikon.liftaris.dev/eikons/ares/",
    identityKey: "ares-id",
    raw: { name: "ares" },
  }

  const instructions = browserInstructions(entry)

  expect(instructions.command).toBe("herm eikon install https://eikon.liftaris.dev/eikons/ares/")
  expect(instructions.command).not.toStartWith("eikon install ")
  expect(instructions).not.toHaveProperty("hermUrl")
})

const cardEntry = {
  name: "ares",
  author: "kaio",
  glyph: "⚔",
  width: 48,
  height: 24,
  w: 48,
  h: 24,
  poster: "STATIC",
  trust: {},
  previewUrl: "https://eikon.liftaris.dev/eikons/ares/ares.eikon",
  installUrl: "https://eikon.liftaris.dev/eikons/ares/",
  sourceKey: "https://eikon.liftaris.dev/eikons/ares/",
  identityKey: "ares-id",
  raw: { name: "ares" },
}

test("catalog cards omit fixed dimensions", () => {
  const html = renderToStaticMarkup(
    <EntryCard
      entry={cardEntry}
      selected={false}
      onPick={() => {}}
    />,
  )

  expect(html).toContain("kaio")
  expect(html).not.toContain("48×24")
})

test("catalog cards render streaming idle frames when available", () => {
  const html = renderToStaticMarkup(
    <EntryCard
      entry={cardEntry}
      selected={false}
      onPick={() => {}}
      frame={["LIVE"]}
    />,
  )

  expect(html).toContain("LIVE")
  expect(html).not.toContain("STATIC")
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
  expect(html).toContain("<title>𝝴ikon</title>")
  expect(html).toContain('<link rel="icon" href="/favicon.svg" type="image/svg+xml" />')

  const favicon = await Bun.file(join(root, "favicon.svg")).text()
  expect(favicon).toContain("𝝴")
  expect(favicon).toContain('fill="#050505"')
  expect(favicon).toContain('fill="#fff"')

  const vercel = await Bun.file(join(repo, "vercel.json")).json()
  expect(vercel.rewrites).toBeUndefined()
})

test("web preview uses terminal-like cells, square cards, mobile drawer, and smooth timing", async () => {
  const css = await Bun.file(join(repo, "src/web/style.css")).text()

  expect(WEB_PREVIEW_FPS).toBeGreaterThanOrEqual(16)
  expect(WEB_PREVIEW_FRAME_MS).toBeLessThanOrEqual(1000 / 16)
  expect(css).toContain("--terminal-line-height: 2.44ch")
  expect(css).toContain("line-height: var(--terminal-line-height)")
  expect(css).toContain("overflow-x: clip")
  expect(css).toContain("aspect-ratio: 1 / 1")
  expect(css).toContain("place-items: center")
  expect(css).toMatch(/\.ascii\s*\{[^}]*width:\s*max-content/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*max-width:\s*100%/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*aspect-ratio:\s*1\s*\/\s*1/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*place-items:\s*center/)
  expect(css).toMatch(/\.asciiArt\s*\{[^}]*width:\s*max-content/)
  expect(css).toMatch(/\.asciiArt\s*\{[^}]*max-width:\s*none/)
  expect(css).not.toMatch(/\.ascii\s*\{[^}]*\n\s*width:\s*100%/)
  expect(css).not.toContain("min-height: 340px")
  expect(css).not.toContain("max-height: 60vh")
  expect(css).toContain("grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr))")
  expect(css).toContain("position: fixed")
  expect(css).toContain(".detail.drawer-collapsed { height: 48px; }")
  expect(css).toContain(".detail.drawer-peek { height: min(58dvh, 500px); }")
  expect(css).toContain(".detail.drawer-expanded { height: calc(100dvh - 10px - env(safe-area-inset-top)); }")
  expect(css).toContain("container-type: inline-size")
  expect(css).toContain("@container (min-width: 640px)")
  expect(css).toMatch(/\.detail\.drawer-peek \.preview\s*\{[^}]*grid-template-columns:\s*max-content minmax\(160px, 1fr\)/)
  expect(css).toMatch(/\.detail\.drawer-peek \.previewOptions\s*\{[^}]*display:\s*grid/)
  expect(css).not.toMatch(/\.detail\.drawer-peek \.drawerExtras,\n\s*\.detail\.drawer-peek \.previewOptions,\n\s*\.detail\.drawer-peek \.previewStatus/)
  expect(css).toContain(".detail.drawer-peek .drawerExtras")
  expect(css).not.toMatch(/\.ascii\s*\{[^}]*line-height:\s*1[;}]/)
  expect(css).not.toMatch(/\.cardPoster\s*\{[^}]*line-height:\s*1[;}]/)
})
