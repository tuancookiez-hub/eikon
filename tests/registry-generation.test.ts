import { expect, test } from "bun:test"
import { createHash, randomUUID } from "node:crypto"
import { mkdirSync, readFileSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"
import { index, manifest } from "../src/registry"
import { decodeRuntimeBytes } from "../src"

const text = [
  JSON.stringify({ type: "header", eikon: 1, title: "zip", author: { name: "kaio" }, size: { cols: 1, rows: 1 }, defaultSignal: "state.idle", signals: { "state.idle": { clip: "idle" } } }),
  JSON.stringify({ type: "clip", name: "idle", fps: 1, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["Z"] }),
].join("\n") + "\n"

function sha(bytes: Uint8Array | string) {
  return `sha256:${createHash("sha256").update(bytes).digest("hex")}`
}

function fixture() {
  const root = join(tmpdir(), `eikon-registry-${randomUUID()}`)
  const dir = join(root, "eikons")
  mkdirSync(join(dir, "zip"), { recursive: true })
  writeFileSync(join(dir, "index.json"), "[]\n")
  writeFileSync(join(dir, "zip", "zip.eikon"), text)
  return dir
}

test("registry generation can emit deterministic gzip runtime blobs", async () => {
  const dir = fixture()
  expect(manifest({ root: dir, encoding: "gzip" })).toBe(1)
  const pkg = join(dir, "..", "packages", "liftaris", "zip")
  const man = JSON.parse(readFileSync(join(pkg, "1.0.0.json"), "utf8"))
  const runtime = man.files.find((file: { role: string }) => file.role === "runtime")
  const blob = readFileSync(join(pkg, runtime.path))

  expect(runtime).toMatchObject({ role: "runtime", encoding: "gzip", size: blob.length, digest: sha(blob), decodedSize: new TextEncoder().encode(text).length, decodedDigest: sha(text) })
  expect(blob[0]).toBe(0x1f)
  expect(blob[1]).toBe(0x8b)
  expect(decodeRuntimeBytes(blob, { descriptor: runtime })).toBe(text)

  const first = runtime.digest
  expect(manifest({ root: dir, encoding: "gzip" })).toBe(1)
  const again = JSON.parse(readFileSync(join(pkg, "1.0.0.json"), "utf8"))
  expect(again.files.find((file: { role: string }) => file.role === "runtime").digest).toBe(first)

  expect(await index({ root: dir, base: "https://eikon.liftaris.dev" })).toBe(1)
  const [entry] = JSON.parse(readFileSync(join(dir, "index.json"), "utf8"))
  expect(entry.runtimeUrl.endsWith(runtime.digest.replace("sha256:", ""))).toBe(true)
  expect(entry.runtimeUrl.endsWith(".gz")).toBe(false)
  expect(entry.trust).toMatchObject({ runtimeDigest: runtime.digest, runtimeSize: runtime.size, runtimeEncoding: "gzip", runtimeDecodedSize: runtime.decodedSize, runtimeDecodedDigest: runtime.decodedDigest })
})
