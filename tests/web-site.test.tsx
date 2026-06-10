/** @jsxImportSource react */
import { expect, test } from "bun:test"
import { join, resolve } from "node:path"
import { renderToStaticMarkup } from "react-dom/server"
import { App, WEB_PREVIEW_FPS, WEB_PREVIEW_FRAME_MS, WEB_SELECTED_PREVIEW_SCALE } from "../src/web/App"
import { browserInstructions, EntryCard } from "../src/web/player"
import type { CatalogEntry } from "../src/browser"

const repo = resolve(import.meta.dir, "..")

function entry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    kind: "eikon.catalog.entry",
    schemaVersion: "1.0",
    id: "liftaris/ares",
    name: "ares",
    title: "ares",
    author: "kaio",
    glyph: "⚔",
    poster: "STATIC",
    runtimeUrl: "https://eikon.liftaris.dev/eikons/ares/ares.eikon",
    packageUrl: "https://eikon.liftaris.dev/eikons/ares/manifest.json",
    sourceKey: "registry:eikon.liftaris.dev:liftaris/ares@1.0.0",
    compatibility: { eikon: ">=1 <2", available: true },
    trust: {},
    ...overrides,
  }
}

const cardEntry = entry()

test("public page copy presents gallery search and Herm install flow", () => {
  const html = renderToStaticMarkup(<App />)

  expect(html).toContain("<h1>𝝴ikon</h1>")
  expect(html).toContain("A terminal avatar format for Herm")
  expect(html).toContain("Search by name or author")
  expect(html).toContain("Search catalog")
  expect(html).toContain("drawer-collapsed")
  expect(html).toContain("<code>herm eikon install &lt;url&gt;</code>")
})

test("install instructions use the Herm CLI command", () => {
  const instructions = browserInstructions(cardEntry)

  expect(instructions).toEqual({ command: "herm eikon install https://eikon.liftaris.dev/eikons/ares/manifest.json" })
})

test("catalog cards render poster and author metadata", () => {
  const html = renderToStaticMarkup(
    <EntryCard
      entry={cardEntry}
      selected={false}
      onPick={() => {}}
    />,
  )

  expect(html).toContain("kaio")
  expect(html).toContain("STATIC")
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
  const blob = vercel.headers.find((item: { source?: string }) => item.source?.includes("/blobs/sha256/"))
  expect(blob).toBeDefined()
  expect(blob.headers.some((item: { key: string }) => item.key.toLowerCase() === "content-encoding")).toBe(false)
})

test("web preview uses terminal-like cells, square cards, mobile drawer, and smooth timing", async () => {
  const css = await Bun.file(join(repo, "src/web/style.css")).text()

  expect(WEB_PREVIEW_FPS).toBeGreaterThanOrEqual(16)
  expect(WEB_PREVIEW_FRAME_MS).toBeLessThanOrEqual(1000 / 16)
  expect(WEB_SELECTED_PREVIEW_SCALE).toBe(1.5)
  expect(css).toContain("--terminal-line-height: 2.44ch")
  expect(css).toContain("--preview-surface: #020202")
  expect(css).toContain("line-height: var(--terminal-line-height)")
  expect(css).toContain("overflow-x: clip")
  expect(css).toContain("aspect-ratio: 1 / 1")
  expect(css).toContain("place-items: center")
  expect(css).toMatch(/\.ascii\s*\{[^}]*width:\s*100%/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*max-width:\s*100%/)
  expect(css).not.toMatch(/\.ascii\s*\{[^}]*aspect-ratio/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*display:\s*grid/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*justify-items:\s*center/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*align-items:\s*start/)
  expect(css).toMatch(/\.cardPreview\s*\{[^}]*background:\s*var\(--preview-surface\)/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*background:\s*var\(--preview-surface\)/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*border:\s*0/)
  expect(css).toMatch(/\.ascii\s*\{[^}]*font-size:\s*var\(--selected-preview-font-size,\s*clamp\(5\.5px,\s*\.52vw,\s*8px\)\)/)
  expect(css).not.toMatch(/@media[^}]*\.ascii\s*\{[^}]*font-size/s)
  expect(css).toMatch(/\.asciiArt\s*\{[^}]*width:\s*max-content/)
  expect(css).toMatch(/\.asciiArt\s*\{[^}]*max-width:\s*none/)
  expect(css).not.toContain("min-height: 340px")
  expect(css).not.toContain("max-height: 60vh")
  expect(css).toContain("grid-template-columns: repeat(auto-fill, minmax(min(100%, 230px), 1fr))")
  expect(css).toContain("position: fixed")
  expect(css).toContain(".detail.drawer-collapsed { height: 48px; }")
  expect(css).toContain(".detail.drawer-peek { height: min(58dvh, 500px); }")
  expect(css).toContain(".detail.drawer-expanded { height: calc(100dvh - 10px - env(safe-area-inset-top)); }")
  expect(css).toMatch(/\.detail\s*\{[^}]*border:\s*0/)
  expect(css).toMatch(/\.detail\s*\{[^}]*background:\s*transparent/)
  expect(css).toMatch(/\.detail\s*\{[^}]*box-shadow:\s*none/)
  expect(css).toContain("container-type: inline-size")
  expect(css).toContain("height: var(--detail-height, calc(100dvh - 14px))")
  expect(css).toContain("max-height: none")
  expect(css).toMatch(/\.preview\s*\{[^}]*border:\s*0/)
  expect(css).toMatch(/\.preview\s*\{[^}]*background:\s*transparent/)
  expect(css).toMatch(/\.preview\s*\{[^}]*height:\s*100%/)
  expect(css).toContain("flex: 1 1 0")
  expect(css).toContain("border: 3px double var(--line)")
  expect(css).toContain(".previewMeta div")
  expect(css).toContain(".detail.drawer-peek .previewMeta { display: none; }")
  expect(css).not.toMatch(/\.detail\.drawer-peek \.preview\s*\{[^}]*grid-template-columns/)
  expect(css).not.toMatch(/\.detail\.drawer-peek \.drawerExtras,\n\s*\.detail\.drawer-peek \.previewOptions,\n\s*\.detail\.drawer-peek \.previewStatus/)
  expect(css).toContain(".detail.drawer-peek .drawerExtras")
  expect(css).not.toMatch(/\.ascii\s*\{[^}]*line-height:\s*1[;}]/)
  expect(css).not.toMatch(/\.cardPoster\s*\{[^}]*line-height:\s*1[;}]/)
})
