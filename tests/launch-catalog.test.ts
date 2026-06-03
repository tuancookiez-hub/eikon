import { expect, test } from "bun:test"
import {
  loadCatalogEntries,
  normalizeCatalogEntry,
  searchCatalogEntries,
  validatePackageManifest,
  validateCatalogEntry,
  type EikonPackageManifest,
} from "../src"

const manifest: EikonPackageManifest = {
  kind: "eikon.package",
  schemaVersion: "1.0",
  id: "liftaris/nous",
  name: "nous",
  display: { title: "Nous", author: "Liftaris", tags: ["mono"] },
  compatibility: { eikon: ">=2 <3" },
  entrypoints: { default: "streams/nous.eikonl" },
  files: [{ path: "streams/nous.eikonl", role: "stream" }, { path: "poster.txt", role: "poster" }],
  poster: "poster.txt",
  preview: "streams/nous.eikonl",
  signals: { "state.working": { clip: "working", fallback: "state.thinking" } },
}

test("package manifest validates launch fields and signal fallbacks", () => {
  expect(validatePackageManifest(manifest).signals?.["state.working"]?.clip).toBe("working")
  expect(() => validatePackageManifest({ ...manifest, schemaVersion: undefined })).toThrow(/schemaVersion/)
  expect(() => validatePackageManifest({ ...manifest, entrypoints: { default: "../escape.eikonl" } })).toThrow(/entrypoints.default.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, source: { base: "../escape.png" } })).toThrow(/source.base.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, source: { states: { idle: { file: "/abs/idle.mp4" } } } })).toThrow(/source.states.idle.file.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, extensions: { required: ["eikon.future.v1"] } })).toThrow(/extensions.required.*unknown required/)
  expect(() => validatePackageManifest({ ...manifest, compatibility: { eikon: "<2" } })).toThrow(/compatibility.eikon/)
  expect(() => validatePackageManifest({ ...manifest, compatibility: { eikon: ">=1 <2" } })).toThrow(/compatibility.eikon/)
  expect(() => validatePackageManifest({ ...manifest, compatibility: { eikon: ">=99" } })).toThrow(/compatibility.eikon/)
})

test("enriched package registry entries normalize to catalog entries", () => {
  const entry = normalizeCatalogEntry({ manifest, packageUrl: "https://example.test/eikons/nous/manifest.json", sourceKey: "github:liftaris/eikon:nous" })
  expect(entry.id).toBe("liftaris/nous")
  expect(entry.name).toBe("nous")
  expect(entry.title).toBe("Nous")
  expect(entry.author).toBe("Liftaris")
  expect(entry.poster).toBe("https://example.test/eikons/nous/poster.txt")
  expect(entry.compatibility.available).toBe(true)
})

test("simple legacy catalog entries remain readable", () => {
  const entry = normalizeCatalogEntry({ name: "mono", author: "Kaio", source: "mono/", poster: "x" }, "https://example.test/eikons/")
  expect(entry.kind).toBe("eikon.catalog.entry")
  expect(entry.id).toBe("mono")
  expect(entry.sourceKey).toBe("https://example.test/eikons/mono/")
  expect(entry.packageUrl).toBe("https://example.test/eikons/mono/manifest.json")
})

test("catalog search matches name, title, author, and tags case-insensitively", () => {
  const entries = [
    normalizeCatalogEntry({ manifest, packageUrl: "https://example.test/nous/manifest.json", sourceKey: "s1" }),
    normalizeCatalogEntry({ manifest: { ...manifest, id: "liftaris/ares", name: "ares", display: { title: "Ares", author: "Forge" } }, packageUrl: "https://example.test/ares/manifest.json", sourceKey: "s2" }),
  ]
  expect(searchCatalogEntries(entries, "lift").map(e => e.name)).toEqual(["nous"])
  expect(searchCatalogEntries(entries, "ARES").map(e => e.name)).toEqual(["ares"])
})

test("catalog validation rejects unsafe public fields before rendering", () => {
  expect(() => validateCatalogEntry(normalizeCatalogEntry({ name: "bad", source: "file:///tmp/bad" }))).toThrow(/packageUrl.*http/)
  expect(() => normalizeCatalogEntry({ name: "bad<script>", source: "bad/" }, "https://example.test/eikons/")).toThrow(/safe catalog name/)
  expect(() => validatePackageManifest({ ...manifest, display: { title: "<script>" } })).toThrow(/display.title/)
})

test("catalog client loads and normalizes remote index entries", async () => {
  const srv = Bun.serve({
    port: 0,
    fetch: req => {
      const path = new URL(req.url).pathname
      if (path === "/index.json") return Response.json([{ manifest, packageUrl: "/nous/manifest.json", sourceKey: "local:nous" }])
      return new Response("404", { status: 404 })
    },
  })
  try {
    const entries = await loadCatalogEntries(`http://localhost:${srv.port}`)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.packageUrl).toBe(`http://localhost:${srv.port}/nous/manifest.json`)
  } finally {
    srv.stop()
  }
})

test("browser-safe catalog module does not import host-only modules", async () => {
  const source = await Bun.file(new URL("../src/catalog.ts", import.meta.url)).text()
  expect(source).not.toMatch(/node:fs|node:child_process|\.\/install|\.\/registry|@opentui|ssh2/)
})

test("checked-in public index points launch package previews under the catalog base", async () => {
  const index = JSON.parse(await Bun.file(new URL("../eikons/index.json", import.meta.url)).text()) as Array<{ id: string; packageUrl: string; preview: string; compatibility: { eikon: string } }>
  expect(index.length).toBeGreaterThan(0)
  for (const entry of index) {
    expect(entry.id).toMatch(/^liftaris\//)
    expect(entry.packageUrl).toMatch(/^https:\/\/eikon\.liftaris\.dev\/eikons\/[^/]+\/manifest\.json$/)
    expect(entry.preview).toMatch(/^https:\/\/eikon\.liftaris\.dev\/eikons\/[^/]+\/[^/]+\.eikonl$/)
    expect(entry.compatibility.eikon).toBe(">=2 <3")
  }
})
