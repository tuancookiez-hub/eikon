import { expect, test } from "bun:test"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { randomUUID, createHash } from "node:crypto"
import { index, manifest, verifyArtifacts } from "../src/registry"

const text = [
  JSON.stringify({ type: "header", eikon: 1, title: "fresh", author: { name: "kaio" }, size: { cols: 1, rows: 1 }, defaultSignal: "state.idle", signals: { "state.idle": { clip: "idle" } } }),
  JSON.stringify({ type: "clip", name: "idle", fps: 1, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["F"] }),
].join("\n") + "\n"

const digest = (value: string) => `sha256:${createHash("sha256").update(value).digest("hex")}`

function fixture() {
  const root = join(tmpdir(), `eikon-fresh-src-${randomUUID()}`)
  const dir = join(root, "eikons")
  mkdirSync(join(dir, "fresh"), { recursive: true })
  writeFileSync(join(dir, "index.json"), "[]\n")
  writeFileSync(join(dir, "fresh", "fresh.eikon"), text)
  return dir
}

test("artifact freshness verifier detects stale generated catalog and package artifacts", async () => {
  const dir = fixture()
  expect(manifest({ root: dir, encoding: "gzip" })).toBe(1)
  expect(await index({ root: dir, base: "https://eikon.liftaris.dev" })).toBe(1)
  expect(await verifyArtifacts({ root: dir, base: "https://eikon.liftaris.dev", encoding: "gzip" })).toEqual({ ok: true, diffs: [] })

  const path = join(dir, "index.json")
  writeFileSync(path, readFileSync(path, "utf8").replace("fresh", "stale"))
  const local = join(dir, "fresh", "manifest.json")
  writeFileSync(local, readFileSync(local, "utf8").replace("sha256:", "sha256:stale"))
  const result = await verifyArtifacts({ root: dir, base: "https://eikon.liftaris.dev", encoding: "gzip" })
  expect(result.ok).toBe(false)
  expect(result.diffs).toContain("eikons/index.json")
  expect(result.diffs).toContain("eikons/fresh/manifest.json")
})

test("registry manifest fails when source refs point at missing files", () => {
  const dir = fixture()
  writeFileSync(join(dir, "fresh", "manifest.json"), JSON.stringify({
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: "liftaris/fresh",
    name: "fresh",
    version: "1.0.0",
    display: { title: "fresh", author: "kaio" },
    compatibility: { eikon: ">=1 <2" },
    source: { base: "missing.png" },
    entrypoints: { default: "fresh.eikon" },
    files: [{ path: "fresh.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: text.length, digest: digest(text) }],
  }))

  expect(() => manifest({ root: dir, encoding: "gzip" })).toThrow(/missing\.png: referenced source file missing/)
})
