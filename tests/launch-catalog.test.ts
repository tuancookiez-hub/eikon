import { expect, test } from "bun:test"
import {
  LAUNCH_MEDIA_TYPE,
  loadCatalogEntries,
  normalizeCatalogEntry,
  searchCatalogEntries,
  validateCatalogEntry,
  validatePackageManifest,
  type EikonPackageManifest,
} from "../src"

const manifest: EikonPackageManifest = {
  kind: "eikon.package",
  schemaVersion: "1.0",
  id: "liftaris/nous",
  name: "nous",
  version: "1.0.0",
  display: { title: "Nous", author: "Liftaris", tags: ["mono"], glyph: "⬡" },
  compatibility: { eikon: ">=1 <2" },
  entrypoints: { default: "streams/nous.eikon" },
  files: [
    { path: "streams/nous.eikon", role: "runtime", mediaType: LAUNCH_MEDIA_TYPE, size: 123, digest: "sha256:runtime" },
    { path: "poster.txt", role: "poster", mediaType: "text/plain", size: 4, digest: "sha256:poster" },
    { path: "preview.mp4", role: "preview", mediaType: "video/mp4", size: 42, digest: "sha256:preview" },
  ],
  poster: "poster.txt",
  preview: "preview.mp4",
  triggers: [{ signal: "approval.waiting", when: "reserved.host-rule", fallback: "state.thinking" }],
  extensions: { used: ["eikon.triggers.v1"], required: [] },
}

test("package manifest validates final launch descriptors", () => {
  expect(validatePackageManifest(manifest, { registry: true }).entrypoints.default).toBe("streams/nous.eikon")
  expect(() => validatePackageManifest({ ...manifest, schemaVersion: undefined })).toThrow(/schemaVersion/)
  expect(() => validatePackageManifest({ ...manifest, compatibility: { eikon: ">=2 <3" } })).toThrow(/compatibility.eikon/)
  expect(() => validatePackageManifest({ ...manifest, files: [...(manifest.files ?? []), { path: "streams/old.eikon", role: "stream", mediaType: LAUNCH_MEDIA_TYPE }] })).toThrow(/files\.3\.role.*stale descriptor role/)
  expect(() => validatePackageManifest({ ...manifest, entrypoints: { default: "../escape.eikon" } })).toThrow(/entrypoints.default.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, source: { base: "../escape.png" } })).toThrow(/source.base.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, source: { states: { idle: { file: "/abs/idle.mp4" } } } })).toThrow(/source.states.idle.file.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, signals: { "state.working": { clip: "working" } } } as unknown)).toThrow(/signals/)
  expect(() => validatePackageManifest({ ...manifest, extensions: { required: ["eikon.future.v1"] } })).toThrow(/extensions.required.*unknown required/)
})

test("strict registry validation requires descriptor size and digest", () => {
  const loose = { ...manifest, files: [{ path: "streams/nous.eikon", role: "runtime", mediaType: LAUNCH_MEDIA_TYPE }] }
  expect(validatePackageManifest(loose).files?.[0]?.path).toBe("streams/nous.eikon")
  expect(() => validatePackageManifest(loose, { registry: true })).toThrow(/files.0.*size.*digest/)
})

test("enriched package registry entries normalize to final catalog entries", () => {
  const entry = normalizeCatalogEntry({ manifest, packageUrl: "https://example.test/packages/liftaris/nous/1.0.0.json", sourceKey: "registry:example.test:liftaris/nous@1.0.0" })
  expect(entry.id).toBe("liftaris/nous")
  expect(entry.version).toBe("1.0.0")
  expect(entry.name).toBe("nous")
  expect(entry.title).toBe("Nous")
  expect(entry.author).toBe("Liftaris")
  expect(entry.poster).toBe("https://example.test/packages/liftaris/nous/poster.txt")
  expect(entry.preview).toBe("https://example.test/packages/liftaris/nous/preview.mp4")
  expect(entry.runtimeUrl).toBe("https://example.test/packages/liftaris/nous/streams/nous.eikon")
  expect(entry.packageUrl).toBe("https://example.test/packages/liftaris/nous/1.0.0.json")
  expect(entry.compatibility.available).toBe(true)
})

test("simple legacy catalog entries remain readable as migration/discovery input", () => {
  const entry = normalizeCatalogEntry({ name: "mono", author: "Kaio", source: "mono/", poster: "x" }, "https://example.test/eikons/")
  expect(entry.kind).toBe("eikon.catalog.entry")
  expect(entry.id).toBe("mono")
  expect(entry.sourceKey).toBe("https://example.test/eikons/mono/")
  expect(entry.runtimeUrl).toBe("https://example.test/eikons/mono/mono.eikon")
  expect(entry.packageUrl).toBe("https://example.test/eikons/mono/manifest.json")
})

test("catalog search matches name, title, author, and tags case-insensitively", () => {
  const entries = [
    normalizeCatalogEntry({ manifest, packageUrl: "https://example.test/nous/1.0.0.json", sourceKey: "s1" }),
    normalizeCatalogEntry({ manifest: { ...manifest, id: "liftaris/ares", name: "ares", display: { title: "Ares", author: "Forge" } }, packageUrl: "https://example.test/ares/1.0.0.json", sourceKey: "s2" }),
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
      if (path === "/index.json") return Response.json([{ manifest, packageUrl: "/packages/liftaris/nous/1.0.0.json", sourceKey: "local:nous" }])
      return new Response("404", { status: 404 })
    },
  })
  try {
    const entries = await loadCatalogEntries(`http://localhost:${srv.port}`)
    expect(entries).toHaveLength(1)
    expect(entries[0]?.runtimeUrl).toBe(`http://localhost:${srv.port}/packages/liftaris/nous/streams/nous.eikon`)
  } finally {
    srv.stop()
  }
})

test("checked-in public index points launch package runtimes under the catalog base", async () => {
  const index = JSON.parse(await Bun.file(new URL("../eikons/index.json", import.meta.url)).text()) as Array<{ id: string; packageUrl: string; runtimeUrl: string; preview?: string; compatibility: { eikon: string } }>
  expect(index.length).toBeGreaterThan(0)
  for (const entry of index) {
    expect(entry.id).toMatch(/^liftaris\//)
    expect(entry.packageUrl).toMatch(/^https:\/\/eikon\.liftaris\.dev\/packages\/[^/]+\/[^/]+\/[^/]+\.json$/)
    expect(entry.runtimeUrl).toMatch(/^https:\/\/eikon\.liftaris\.dev\/packages\/[^/]+\/[^/]+\/blobs\/sha256\/[a-f0-9]{64}$/)
    expect(entry.preview).toBe(entry.runtimeUrl)
    expect(entry.compatibility.eikon).toBe(">=1 <2")
  }
})
