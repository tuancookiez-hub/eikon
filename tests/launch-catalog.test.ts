import { expect, test } from "bun:test"
import {
  LAUNCH_MEDIA_TYPE,
  loadCatalogEntries,
  normalizeCatalogEntry,
  publicCatalogUrl,
  runtimeDescriptor,
  searchCatalogEntries,
  validateCatalogEntry,
  validatePackageManifest,
  type CatalogEntry,
  type EikonPackageManifest,
} from "../src"
import { loadRuntimeArtifact } from "../src/catalog"

const A = "a".repeat(64)
const B = "b".repeat(64)
const C = "c".repeat(64)
const D = "d".repeat(64)
const E = "e".repeat(64)
const RUNTIME_DIGEST = `sha256:${A}`
const RUNTIME_DIGEST_B = `sha256:${B}`
const POSTER_DIGEST = `sha256:${C}`
const SOURCE_DIGEST = `sha256:${D}`
const MANIFEST_DIGEST = `sha256:${E}`

function body(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer
}

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
    { path: "manifest.json", role: "manifest", mediaType: "application/vnd.eikon.package+json", size: 321, digest: MANIFEST_DIGEST },
    { path: "streams/nous.eikon", role: "runtime", mediaType: LAUNCH_MEDIA_TYPE, size: 123, digest: RUNTIME_DIGEST },
    { path: "source/base.png", role: "source.base", mediaType: "image/png", size: 10, digest: SOURCE_DIGEST },
    { path: "source/idle.png", role: "source.clip", mediaType: "image/png", size: 11, digest: `sha256:${"1".repeat(64)}`, signal: "state.idle" },
    { path: "poster.txt", role: "poster", mediaType: "text/plain", size: 4, digest: POSTER_DIGEST },
  ],
  source: { base: "source/base.png", states: { idle: { file: "source/idle.png", role: "loop" } } },
  poster: "poster.txt",
  triggers: [{ signal: "approval.waiting", when: "reserved.host-rule", fallback: "state.thinking" }],
  extensions: { used: ["eikon.triggers.v1"], required: [] },
}

function canonicalEntry(overrides: Partial<CatalogEntry> = {}): CatalogEntry {
  return {
    kind: "eikon.catalog.entry",
    schemaVersion: "1.0",
    id: "liftaris/nous",
    version: "1.0.0",
    sourceKey: "registry:example.test:liftaris/nous@1.0.0",
    name: "nous",
    title: "Nous",
    author: "Liftaris",
    glyph: "⬡",
    tags: ["mono"],
    poster: "Nous\n⬡",
    runtimeUrl: `https://example.test/packages/liftaris/nous/blobs/sha256/${A}`,
    packageUrl: "https://example.test/packages/liftaris/nous/1.0.0.json",
    compatibility: { eikon: ">=1 <2", available: true },
    trust: { manifestDigest: MANIFEST_DIGEST, runtimeDigest: RUNTIME_DIGEST, runtimeSize: 123 },
    ...overrides,
  }
}

function expectCatalogRejection(value: unknown, pattern: RegExp) {
  expect(() => normalizeCatalogEntry(value as never, "https://example.test/eikons/")).toThrow(pattern)
}

test("package manifest validates final launch descriptors without preview fields", () => {
  const validated = validatePackageManifest(manifest, { registry: true })
  expect(validated.entrypoints.default).toBe("streams/nous.eikon")
  expect(validated.files?.map(file => file.role)).toEqual(["manifest", "runtime", "source.base", "source.clip", "poster"])
  expect(() => validatePackageManifest({ ...manifest, schemaVersion: undefined })).toThrow(/schemaVersion/)
  expect(() => validatePackageManifest({ ...manifest, compatibility: { eikon: ">=2 <3" } })).toThrow(/compatibility.eikon/)
  expect(() => validatePackageManifest({ ...manifest, entrypoints: { default: "../escape.eikon" } })).toThrow(/entrypoints.default.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, source: { base: "../escape.png" } })).toThrow(/source.base.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, source: { states: { idle: { file: "/abs/idle.mp4" } } } })).toThrow(/source.states.idle.file.*safe relative path/)
  expect(() => validatePackageManifest({ ...manifest, signals: { "state.working": { clip: "working" } } } as unknown)).toThrow(/signals/)
  expect(() => validatePackageManifest({ ...manifest, extensions: { required: ["eikon.future.v1"] } })).toThrow(/extensions.required.*unknown required/)
})

test("package manifest rejects preview fields aliases and retired descriptor roles", () => {
  for (const key of ["preview", "previewUrl", "preview_url", "previewPath", "livePreview"])
    expect(() => validatePackageManifest({ ...manifest, [key]: "preview.mp4" } as unknown)).toThrow(/preview|unsupported/i)

  for (const role of ["preview", "preview.video", "thumbnail", "demo", "stream", "source"])
    expect(() => validatePackageManifest({ ...manifest, files: [{ path: "preview.mp4", role, mediaType: "video/mp4", size: 42, digest: RUNTIME_DIGEST }] } as unknown, { registry: true })).toThrow(/role/)
})

test("strict registry validation requires canonical descriptor size and digest", () => {
  const loose = { ...manifest, files: [{ path: "streams/nous.eikon", role: "runtime", mediaType: LAUNCH_MEDIA_TYPE }] }
  expect(validatePackageManifest(loose).files?.[0]?.path).toBe("streams/nous.eikon")
  expect(() => validatePackageManifest(loose, { registry: true })).toThrow(/files.0.*size.*digest/)
  expect(() => validatePackageManifest({ ...manifest, files: [{ path: "streams/nous.eikon", role: "runtime", mediaType: LAUNCH_MEDIA_TYPE, size: 1.5, digest: RUNTIME_DIGEST }] } as unknown, { registry: true })).toThrow(/size/)
  expect(() => validatePackageManifest({ ...manifest, files: [{ path: "streams/nous.eikon", role: "runtime", mediaType: LAUNCH_MEDIA_TYPE, size: 1, digest: "sha256:runtime" }] } as unknown, { registry: true })).toThrow(/digest/)
})

test("gzip runtime descriptors require stored and decoded identity metadata", () => {
  const gzip = {
    ...manifest,
    files: [{
      path: `blobs/sha256/${A}`,
      role: "runtime",
      mediaType: LAUNCH_MEDIA_TYPE,
      encoding: "gzip",
      size: 12,
      digest: RUNTIME_DIGEST,
      decodedSize: 34,
      decodedDigest: RUNTIME_DIGEST_B,
    }],
    entrypoints: { default: `blobs/sha256/${A}` },
  } satisfies EikonPackageManifest
  expect(validatePackageManifest(gzip, { registry: true }).files?.[0]?.encoding).toBe("gzip")
  expect(() => validatePackageManifest({ ...gzip, files: [{ ...gzip.files![0]!, decodedDigest: undefined }] }, { registry: true })).toThrow(/decodedDigest.*gzip registry runtime/)
  expect(() => validatePackageManifest({ ...gzip, files: [{ ...gzip.files![0]!, encoding: "br" }] } as unknown, { registry: true })).toThrow(/encoding/)
  expect(() => validatePackageManifest({ ...gzip, files: [{ path: "poster.txt", role: "poster", mediaType: "text/plain", encoding: "gzip" }] } as unknown)).toThrow(/runtime encoding metadata/)
})

test("enriched package registry entries normalize to exact launch catalog entries", () => {
  const entry = normalizeCatalogEntry({ manifest, packageUrl: "https://example.test/packages/liftaris/nous/1.0.0.json", sourceKey: "registry:example.test:liftaris/nous@1.0.0" })
  expect(Object.keys(entry).sort()).toEqual(["author", "compatibility", "glyph", "id", "kind", "name", "packageUrl", "poster", "runtimeUrl", "schemaVersion", "sourceKey", "tags", "title", "trust", "version"])
  expect(entry.id).toBe("liftaris/nous")
  expect(entry.version).toBe("1.0.0")
  expect(entry.name).toBe("nous")
  expect(entry.title).toBe("Nous")
  expect(entry.author).toBe("Liftaris")
  expect(entry.poster).toBe("https://example.test/packages/liftaris/nous/poster.txt")
  expect(entry).not.toHaveProperty("preview")
  expect(entry).not.toHaveProperty("previewUrl")
  expect(entry.runtimeUrl).toBe("https://example.test/packages/liftaris/nous/streams/nous.eikon")
  expect(entry.packageUrl).toBe("https://example.test/packages/liftaris/nous/1.0.0.json")
  expect(entry.compatibility.available).toBe(true)
  expect(entry.trust).toEqual({ manifestDigest: MANIFEST_DIGEST, runtimeDigest: RUNTIME_DIGEST, runtimeSize: 123 })
})

test("package-backed gzip catalog entries preserve stored and decoded runtime trust", () => {
  const gzip = normalizeCatalogEntry({
    manifest: {
      ...manifest,
      files: [{
        path: `blobs/sha256/${A}`,
        role: "runtime",
        mediaType: LAUNCH_MEDIA_TYPE,
        encoding: "gzip",
        size: 12,
        digest: RUNTIME_DIGEST,
        decodedSize: 34,
        decodedDigest: RUNTIME_DIGEST_B,
      }],
      entrypoints: { default: `blobs/sha256/${A}` },
    },
    packageUrl: "https://example.test/packages/liftaris/nous/1.0.0.json",
  })
  expect(gzip.runtimeUrl).toBe(`https://example.test/packages/liftaris/nous/blobs/sha256/${A}`)
  expect(gzip.trust).toEqual({ runtimeDigest: RUNTIME_DIGEST, runtimeSize: 12, runtimeEncoding: "gzip", runtimeDecodedSize: 34, runtimeDecodedDigest: RUNTIME_DIGEST_B })
})

test("loadRuntimeArtifact uses runtimeUrl and descriptor trust metadata", async () => {
  const text = '{"type":"header","eikon":1,"size":{"cols":4,"rows":1},"defaultSignal":"state.idle","signals":{"state.idle":{"clip":"idle"}}}\n{"type":"clip","name":"idle","fps":1}\n{"type":"frame","clip":"idle","index":0,"rows":["nous"]}\n'
  const info = runtimeDescriptor(text, { encoding: "gzip" })
  const entry = canonicalEntry({
    runtimeUrl: `https://example.test/packages/liftaris/nous/blobs/sha256/${info.digest.slice("sha256:".length)}`,
    trust: { runtimeDigest: info.digest, runtimeSize: info.size, runtimeEncoding: "gzip", runtimeDecodedSize: info.decodedSize, runtimeDecodedDigest: info.decodedDigest },
  })
  const artifact = await loadRuntimeArtifact(entry, async () => new Response(body(info.bytes)))
  expect(artifact.bytes[0]).toBe(0x1f)
  expect(artifact.text).toBe(text)
  await expect(loadRuntimeArtifact(entry, async () => new Response(body(info.bytes), { headers: { "content-encoding": "gzip" } }))).rejects.toThrow(/Content-Encoding/)
})

test("normal public catalog readers reject legacy rows aliases and preview fields", () => {
  for (const key of ["preview", "previewUrl", "preview_url"])
    expectCatalogRejection({ ...canonicalEntry(), [key]: "https://example.test/preview.eikon" }, /preview|unsupported/i)

  expectCatalogRejection({ name: "mono", author: "Kaio", source: "mono/", poster: "x" }, /kind|manifest|catalog entry/i)
  expectCatalogRejection({ name: "mono", source_url: "mono/", package_url: "mono/manifest.json", runtime_url: "mono/mono.eikon" }, /kind|manifest|catalog entry/i)
  expectCatalogRejection({ ...canonicalEntry(), runtime_url: "https://example.test/bad.eikon" }, /runtime_url|unsupported/i)
  expectCatalogRejection({ ...canonicalEntry(), package_url: "https://example.test/bad.json" }, /package_url|unsupported/i)
})

test("catalog validation rejects unsupported trust keys and malformed trust metadata", () => {
  for (const key of ["digest", "source", "unknown"])
    expect(() => validateCatalogEntry({ ...canonicalEntry(), trust: { ...canonicalEntry().trust, [key]: "sha256:bad" } } as unknown as CatalogEntry)).toThrow(/trust\./)

  expect(() => validateCatalogEntry(canonicalEntry({ trust: { runtimeDigest: "sha256:runtime" } }))).toThrow(/runtimeDigest.*sha256/)
  expect(() => validateCatalogEntry(canonicalEntry({ trust: { runtimeDigest: RUNTIME_DIGEST, runtimeEncoding: "br" as never } }))).toThrow(/runtimeEncoding/)
  expect(() => validateCatalogEntry(canonicalEntry({ trust: { runtimeDigest: RUNTIME_DIGEST, runtimeSize: Number.MAX_SAFE_INTEGER + 1 } }))).toThrow(/runtimeSize/)
  expect(() => validateCatalogEntry(canonicalEntry({ trust: { runtimeDigest: RUNTIME_DIGEST, runtimeSize: 1.25 } }))).toThrow(/runtimeSize/)
  expect(() => validateCatalogEntry(canonicalEntry({ trust: { runtimeDigest: RUNTIME_DIGEST, runtimeSize: -1 } }))).toThrow(/runtimeSize/)
  expect(() => validateCatalogEntry(canonicalEntry({ trust: { runtimeDigest: RUNTIME_DIGEST, runtimeEncoding: "gzip", runtimeSize: 12, runtimeDecodedSize: 34 } }))).toThrow(/runtimeDecodedDigest/)
})

test("content-addressed runtime URL package descriptor and trust digests must agree", () => {
  expect(() => validateCatalogEntry(canonicalEntry())).not.toThrow()
  expect(() => validateCatalogEntry(canonicalEntry({ trust: { runtimeDigest: RUNTIME_DIGEST_B, runtimeSize: 123 } }))).toThrow(/runtimeDigest.*runtimeUrl|content-addressed/i)
  expect(() => normalizeCatalogEntry({
    manifest: {
      ...manifest,
      entrypoints: { default: `blobs/sha256/${A}` },
      files: [{ path: `blobs/sha256/${A}`, role: "runtime", mediaType: LAUNCH_MEDIA_TYPE, size: 1, digest: RUNTIME_DIGEST_B }],
    },
    packageUrl: "https://example.test/packages/liftaris/nous/1.0.0.json",
  })).toThrow(/runtimeDigest.*runtimeUrl|content-addressed/i)
})

test("catalog validation rejects unsafe URLs paths poster data and unsupported fields", () => {
  expect(() => publicCatalogUrl("https://user:pass@example.test/eikons/index.json")).toThrow(/credentials/)
  expect(() => publicCatalogUrl("https://example.test/eikons/../private/index.json")).toThrow(/path escape/)
  expect(() => publicCatalogUrl("https://example.test/eikons/%2e%2e/private/index.json")).toThrow(/path escape/)
  expect(() => publicCatalogUrl("https://example.test/eikons\\private/index.json")).toThrow(/path escape|backslash/)
  expect(() => publicCatalogUrl("https://example.test/eikons/%0d%0aX:1/index.json")).toThrow(/control|path/)
  expect(() => validateCatalogEntry(canonicalEntry({ runtimeUrl: "https://user:pass@example.test/e.eikon" }))).toThrow(/credentials/)
  expect(() => validateCatalogEntry(canonicalEntry({ runtimeUrl: "javascript:alert(1)" }))).toThrow(/runtimeUrl.*http/)
  expect(() => validateCatalogEntry(canonicalEntry({ poster: "bad\rposter" }))).toThrow(/poster/)
  expect(() => validateCatalogEntry(canonicalEntry({ poster: "x".repeat(20000) }))).toThrow(/poster/)
  expect(() => validateCatalogEntry({ ...canonicalEntry(), extra: true } as unknown as CatalogEntry)).toThrow(/extra|unsupported/)
})

test("catalog search matches name title author and tags case-insensitively", () => {
  const entries = [
    normalizeCatalogEntry({ manifest, packageUrl: "https://example.test/nous/1.0.0.json", sourceKey: "s1" }),
    normalizeCatalogEntry({ manifest: { ...manifest, id: "liftaris/ares", name: "ares", display: { title: "Ares", author: "Forge" } }, packageUrl: "https://example.test/ares/1.0.0.json", sourceKey: "s2" }),
  ]
  expect(searchCatalogEntries(entries, "lift").map(e => e.name)).toEqual(["nous"])
  expect(searchCatalogEntries(entries, "ARES").map(e => e.name)).toEqual(["ares"])
})

test("catalog client loads and normalizes package-backed remote index entries", async () => {
  const srv = Bun.serve({
    port: 0,
    fetch: req => {
      const path = new URL(req.url).pathname
      if (path === "/index.json") return Response.json([{ manifest, packageUrl: "/packages/liftaris/nous/1.0.0.json", sourceKey: "local:nous" }])
      return new Response("404", { status: 404 })
    },
  })
  try {
    const entries = await loadCatalogEntries(`http://localhost:${srv.port}`, fetch, { allowPrivate: true })
    expect(entries).toHaveLength(1)
    expect(entries[0]?.runtimeUrl).toBe(`http://localhost:${srv.port}/packages/liftaris/nous/streams/nous.eikon`)
    expect(entries[0]).not.toHaveProperty("preview")
  } finally {
    srv.stop()
  }
})

test("checked-in public index points launch package runtimes under the catalog base", async () => {
  const index = JSON.parse(await Bun.file(new URL("../eikons/index.json", import.meta.url)).text()) as Array<CatalogEntry>
  expect(index.length).toBeGreaterThan(0)
  for (const entry of index) {
    expect(Object.keys(entry).sort()).toEqual(["author", "compatibility", "detailUrl", "glyph", "id", "kind", "name", "packageUrl", "poster", "runtimeUrl", "schemaVersion", "sourceKey", "title", "trust", "version"])
    expect(entry.id).toMatch(/^liftaris\//)
    expect(entry.packageUrl).toMatch(/^https:\/\/eikon\.liftaris\.dev\/packages\/[^/]+\/[^/]+\/[^/]+\.json$/)
    expect(entry.runtimeUrl).toMatch(/^https:\/\/eikon\.liftaris\.dev\/packages\/[^/]+\/[^/]+\/blobs\/sha256\/[a-f0-9]{64}$/)
    expect(entry).not.toHaveProperty("preview")
    expect(entry.compatibility.eikon).toBe(">=1 <2")
  }
})
