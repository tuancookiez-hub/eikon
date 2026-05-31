import { expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { resolve } from "../src/install"
import { lintManifest } from "../src/ui/lint"

test("catalog resolve: enriched index entries remain install-compatible by bare name", async () => {
  const root = mkdtempSync(join(tmpdir(), "eikon-publish-"))
  let srv: ReturnType<typeof Bun.serve> | undefined
  try {
    mkdirSync(join(root, "demo"), { recursive: true })
    writeFileSync(join(root, "index.json"), JSON.stringify([{ name: "demo", source: "demo/", license: "MIT", description: "Demo" }]))
    writeFileSync(join(root, "demo/manifest.json"), JSON.stringify({ name: "demo", version: 1, states: {} }))
    srv = Bun.serve({
      port: 0,
      fetch: req => new Response(Bun.file(join(root, new URL(req.url).pathname.slice(1)))),
    })

    const out = await resolve("demo", { catalog: `http://localhost:${srv.port}` })
    expect(out.name).toBe("demo")
    expect(out.base).toBe(`http://localhost:${srv.port}/demo/`)
  } finally {
    srv?.stop()
    rmSync(root, { recursive: true, force: true })
  }
})

test("registry manifest lint: rejects escaping paths and committed install origin", () => {
  const root = mkdtempSync(join(tmpdir(), "eikon-manifest-"))
  try {
    mkdirSync(join(root, "demo"), { recursive: true })
    const raw = JSON.stringify({
      name: "demo",
      version: 1,
      source: "../secret.png",
      states: { idle: { file: "https://example.com/idle.mp4" } },
      origin: { source: "local", at: new Date().toISOString() },
    })
    expect(() => lintManifest(join(root, "demo/manifest.json"), raw, true)).toThrow(/relative path|origin/)
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
})
