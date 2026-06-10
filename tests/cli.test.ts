import { describe, expect, test } from "bun:test"
import { mkdtempSync, mkdirSync, writeFileSync, existsSync, readFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"

const cli = join(import.meta.dir, "..", "src", "cli.tsx")
const launch = [
  JSON.stringify({ type: "header", eikon: 1, title: "demo", size: { cols: 4, rows: 2 }, defaultSignal: "state.idle", signals: { "state.idle": { clip: "idle" } } }),
  JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd", "efgh"] }),
].join("\n") + "\n"

function sha(data: string | Uint8Array) {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`
}

function pkg(dir: string, name: string) {
  mkdirSync(join(dir, "streams"), { recursive: true })
  mkdirSync(join(dir, "source"), { recursive: true })
  const runtime = new TextEncoder().encode(launch)
  const base = new Uint8Array([1, 2, 3, 4])
  const idle = new Uint8Array([5, 6, 7, 8])
  writeFileSync(join(dir, "streams", `${name}.eikon`), runtime)
  writeFileSync(join(dir, "source", "base.png"), base)
  writeFileSync(join(dir, "source", "idle.mp4"), idle)
  writeFileSync(join(dir, "manifest.json"), JSON.stringify({
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: `liftaris/${name}`,
    name,
    version: "1.0.0",
    display: { title: `${name} title`, author: "Kaio" },
    compatibility: { eikon: ">=1 <2" },
    entrypoints: { default: `streams/${name}.eikon` },
    files: [
      { path: `streams/${name}.eikon`, role: "runtime", size: runtime.length, digest: sha(runtime), mediaType: "application/vnd.eikon.stream+jsonl" },
      { path: "source/base.png", role: "source.base", size: base.length, digest: sha(base), mediaType: "image/png" },
      { path: "source/idle.mp4", role: "source.clip", signal: "state.idle", size: idle.length, digest: sha(idle), mediaType: "video/mp4" },
    ],
    source: { base: "source/base.png", states: { idle: { file: "source/idle.mp4" } } },
  }, null, 2))
}

async function run(args: string[], env: Record<string, string>) {
  const p = Bun.spawn(["bun", cli, ...args], { env: { ...process.env, ...env }, stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([p.exited, new Response(p.stdout).text(), new Response(p.stderr).text()])
  return { code, stdout, stderr }
}

function json(out: string) {
  return JSON.parse(out) as Record<string, unknown>
}

describe("eikon CLI lifecycle", () => {
  test("install leaves active unchanged and use writes active preference", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-cli-"))
    const profile = join(tmp, "profile")
    const src = join(tmp, "ares")
    pkg(src, "ares")
    mkdirSync(profile, { recursive: true })
    writeFileSync(join(profile, "tui.json"), JSON.stringify({ theme: "mono", eikon: "old" }))

    const installed = await run(["install", src, "--json"], { HERM_CONFIG_DIR: profile })
    expect(installed.code).toBe(0)
    expect(json(installed.stdout)).toMatchObject({ command: "install", name: "ares", active: "old", trust: "verified" })
    expect(JSON.parse(readFileSync(join(profile, "tui.json"), "utf8")).eikon).toBe("old")

    const used = await run(["use", "ares", "--json"], { HERM_CONFIG_DIR: profile })
    expect(used.code).toBe(0)
    expect(json(used.stdout)).toMatchObject({ command: "use", name: "ares", active: "ares" })
    const prefs = JSON.parse(readFileSync(join(profile, "tui.json"), "utf8"))
    expect(prefs).toMatchObject({ theme: "mono", eikon: "ares" })
  })

  test("list and info report installed active source and trust state", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-cli-"))
    const profile = join(tmp, "profile")
    const src = join(tmp, "mono")
    pkg(src, "mono")
    await run(["install", src, "--json"], { HERM_CONFIG_DIR: profile })
    await run(["use", "mono", "--json"], { HERM_CONFIG_DIR: profile })

    const listed = await run(["list", "--json"], { HERM_CONFIG_DIR: profile })
    expect(listed.code).toBe(0)
    expect((JSON.parse(listed.stdout) as Array<Record<string, unknown>>)[0]).toMatchObject({ name: "mono", status: "active", trust: "verified", removable: true })

    const info = await run(["info", "mono", "--json"], { HERM_CONFIG_DIR: profile })
    expect(info.code).toBe(0)
    expect(json(info.stdout)).toMatchObject({ name: "mono", status: "active", sourceKind: "local", trust: "verified", version: "1.0.0" })
  })

  test("inspect resolves metadata without writing local install state", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-cli-"))
    const profile = join(tmp, "profile")
    const src = join(tmp, "atlas")
    pkg(src, "atlas")

    const inspected = await run(["inspect", src, "--json"], { HERM_CONFIG_DIR: profile })
    expect(inspected.code).toBe(0)
    expect(json(inspected.stdout)).toMatchObject({ command: "inspect", name: "atlas", title: "atlas title", author: "Kaio", installed: false, trust: "verified" })
    expect(existsSync(join(profile, "eikons", "atlas"))).toBe(false)
  })

  test("update rejects source identity drift before reinstalling", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-cli-"))
    const profile = join(tmp, "profile")
    const src = join(tmp, "drift")
    pkg(src, "drift")
    await run(["install", src, "--json"], { HERM_CONFIG_DIR: profile })
    const installedManifest = join(profile, "eikons", "drift", "manifest.json")
    const man = JSON.parse(readFileSync(installedManifest, "utf8"))
    man.origin.sourceKey = "local:/different/source"
    writeFileSync(installedManifest, JSON.stringify(man, null, 2) + "\n")

    const updated = await run(["update", "drift", "--force", "--json"], { HERM_CONFIG_DIR: profile })
    expect(updated.code).toBe(1)
    expect(updated.stderr).toContain("source identity differs")
  })

  test("remove and update require acknowledgement before active mutations", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-cli-"))
    const profile = join(tmp, "profile")
    const src = join(tmp, "ares")
    pkg(src, "ares")
    await run(["install", src, "--json"], { HERM_CONFIG_DIR: profile })
    await run(["use", "ares", "--json"], { HERM_CONFIG_DIR: profile })

    const blockedRemove = await run(["remove", "ares", "--json"], { HERM_CONFIG_DIR: profile })
    expect(blockedRemove.code).toBe(1)
    expect(blockedRemove.stderr).toContain("active avatar")
    expect(existsSync(join(profile, "eikons", "ares"))).toBe(true)

    const blockedUpdate = await run(["update", "ares", "--json"], { HERM_CONFIG_DIR: profile })
    expect(blockedUpdate.code).toBe(1)
    expect(blockedUpdate.stderr).toContain("active avatar")
    expect(existsSync(join(profile, "eikons", "ares"))).toBe(true)

    const removed = await run(["remove", "ares", "--active-ok", "--json"], { HERM_CONFIG_DIR: profile })
    expect(removed.code).toBe(0)
    expect(json(removed.stdout)).toMatchObject({ command: "remove", name: "ares", activeCleared: true })
    expect(existsSync(join(profile, "eikons", "ares"))).toBe(false)
    expect(JSON.parse(readFileSync(join(profile, "tui.json"), "utf8")).eikon).toBeUndefined()
  })

  test("lifecycle names reject path traversal and leave sibling directories untouched", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-cli-"))
    const profile = join(tmp, "profile")
    const victim = join(profile, "victim")
    mkdirSync(join(profile, "eikons"), { recursive: true })
    mkdirSync(victim, { recursive: true })
    writeFileSync(join(victim, "manifest.json"), JSON.stringify({ name: "victim" }))

    for (const cmd of ["use", "remove", "update", "info"]) {
      const out = await run([cmd, "../victim", "--json"], { HERM_CONFIG_DIR: profile })
      expect(out.code).toBe(1)
      expect(out.stderr).toContain("invalid eikon name")
      expect(existsSync(join(victim, "manifest.json"))).toBe(true)
    }
  })

  test("lifecycle names reject absolute separators controls empty and option-like values", async () => {
    const profile = join(mkdtempSync(join(tmpdir(), "eikon-cli-")), "profile")
    const cases = ["/tmp/victim", "nested/name", "nested\\name", "bad\nname", "", "--force"]

    for (const name of cases) {
      const out = await run(["info", name, "--json"], { HERM_CONFIG_DIR: profile })
      expect(out.code).toBe(1)
      expect(out.stderr).toContain("invalid eikon name")
    }
  })

  test("search returns stable empty JSON results", async () => {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-cli-"))
    const srv = Bun.serve({ port: 0, fetch(req) {
      if (new URL(req.url).pathname === "/index.json") return Response.json([{ name: "ares", package_url: "packages/ares.json", runtime_url: "ares.eikon" }])
      return new Response("missing", { status: 404 })
    }})
    try {
      const searched = await run(["search", "zzz", "--catalog", `http://localhost:${srv.port}`, "--json"], { HERM_CONFIG_DIR: join(tmp, "profile") })
      expect(searched.code).toBe(0)
      expect(JSON.parse(searched.stdout)).toEqual([])
    } finally {
      srv.stop()
    }
  })

  test("publish help frames GitHub contribution helper without hosted marketplace upload", async () => {
    const out = await run(["publish", "--help"], { HERM_CONFIG_DIR: mkdtempSync(join(tmpdir(), "eikon-cli-")) })
    expect(out.code).toBe(0)
    expect(out.stdout).toContain("GitHub PR contribution helper")
    expect(out.stdout).toContain("EIKON_REPO")
    expect(out.stdout).not.toContain("marketplace account")
    expect(out.stdout).not.toContain("upload token")
  })
})
