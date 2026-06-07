import { describe, expect, test } from "bun:test"
import { createHash } from "node:crypto"
import { existsSync, mkdirSync, readFileSync, symlinkSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { resolve, install, downloadBytes, resolvePackageIndex, resolveGithubSource, verifyPackageFiles } from "../src/install"
import type { EikonPackageManifest } from "../src"

const root = mkdtempSync(join(tmpdir(), "eikon-u1-"))
const dest = join(root, "dest")

const launch = [
  JSON.stringify({ type: "header", eikon: 1, title: "Mono", size: { cols: 4, rows: 2 }, defaultSignal: "state.idle", signals: { "state.idle": { clip: "idle" } } }),
  JSON.stringify({ type: "clip", name: "idle", fps: 12, frameCount: 1 }),
  JSON.stringify({ type: "frame", clip: "idle", index: 0, rows: ["abcd", "efgh"] }),
].join("\n") + "\n"

function digest(data: string | Uint8Array): `sha256:${string}` {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`
}

function pkg(name: string, files: EikonPackageManifest["files"] = []): EikonPackageManifest {
  return {
    kind: "eikon.package",
    schemaVersion: "1.0",
    id: `liftaris/${name}`,
    name,
    version: "1.0.0",
    display: { title: name, author: "Kaio" },
    compatibility: { eikon: ">=1 <2" },
    entrypoints: { default: "streams/main.eikon" },
    files: files.length ? files : [{ path: "streams/main.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: Buffer.byteLength(launch), digest: digest(launch) }],
  }
}

function writePackage(dir: string, name: string, man = pkg(name)) {
  mkdirSync(join(dir, "streams"), { recursive: true })
  writeFileSync(join(dir, "manifest.json"), JSON.stringify(man, null, 2))
  writeFileSync(join(dir, "streams/main.eikon"), launch)
}

function writeRegistryPackage(repo: string, ns: string, name: string, man = pkg(name)) {
  const dir = join(repo, "packages", ns, name)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, "index.json"), JSON.stringify({ kind: "eikon.package.index", id: `${ns}/${name}`, name, versions: [{ version: "1.0.0", manifest: "1.0.0.json" }] }, null, 2))
  writeFileSync(join(dir, "1.0.0.json"), JSON.stringify(man, null, 2))
  mkdirSync(join(dir, "streams"), { recursive: true })
  writeFileSync(join(dir, "streams/main.eikon"), launch)
}

describe("U1 source identity and trust", () => {
  test("default catalog install uses packageUrl, verifies descriptors, and records catalog source identity", async () => {
    const packageManifest = pkg("ares")
    let cloned = false
    const srv = Bun.serve({
      port: 0,
      fetch: req => {
        const path = new URL(req.url).pathname
        if (path === "/eikons/index.json") return Response.json([{ manifest: packageManifest, packageUrl: "/packages/liftaris/ares/1.0.0.json", sourceKey: "registry:test:liftaris/ares@1.0.0" }])
        if (path === "/packages/liftaris/ares/1.0.0.json") return Response.json(packageManifest)
        if (path === "/packages/liftaris/ares/streams/main.eikon") return new Response(launch)
        return new Response("404", { status: 404 })
      },
    })
    try {
      const out = await install("ares", dest, { catalog: `http://localhost:${srv.port}/eikons`, clone: async () => { cloned = true; throw new Error("should not clone") }, downloader: { allowPrivate: true } })
      expect(cloned).toBe(false)
      expect(out.trust.state).toBe("verified")
      expect(out.origin.kind).toBe("default-catalog")
      expect(out.origin.sourceKey).toBe("registry:test:liftaris/ares@1.0.0")
      expect(out.origin.packageUrl).toBe(`http://localhost:${srv.port}/packages/liftaris/ares/1.0.0.json`)
      expect(existsSync(join(out.dir, "ares.eikon"))).toBe(true)
    } finally {
      srv.stop()
    }
  })

  test("missing descriptor digest downgrades package trust to unverified", async () => {
    const dir = join(root, "missing-digest")
    writePackage(dir, "loose", pkg("loose", [{ path: "streams/main.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: Buffer.byteLength(launch) }]))
    const out = await install(dir, dest)
    expect(out.trust.state).toBe("unverified")
    expect(out.origin.kind).toBe("local")
  })

  test("descriptor digest mismatch blocks before writing local state", async () => {
    const dir = join(root, "bad-digest")
    writePackage(dir, "bad", pkg("bad", [{ path: "streams/main.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: Buffer.byteLength(launch), digest: "sha256:0000" }]))
    await expect(install(dir, dest)).rejects.toThrow(/mismatch.*streams\/main\.eikon/)
    expect(existsSync(join(dest, "bad"))).toBe(false)
  })

  test("symlink and path escape descriptors are rejected before writes", async () => {
    const symlinked = join(root, "symlinked")
    writePackage(symlinked, "symlinked", pkg("symlinked", [{ path: "streams/main.eikon", role: "runtime", mediaType: "application/vnd.eikon.stream+jsonl", size: Buffer.byteLength(launch), digest: digest(launch) }, { path: "linked.png", role: "source.base", mediaType: "image/png", size: 1, digest: digest("x") }]))
    symlinkSync(join(symlinked, "streams/main.eikon"), join(symlinked, "linked.png"))
    await expect(install(symlinked, dest)).rejects.toThrow(/symlink|special file/)
    expect(existsSync(join(dest, "symlinked"))).toBe(false)
  })
})

describe("U1 GitHub catalog resolver", () => {
  test("parses GitHub shorthand, https, and ssh source forms with selector", () => {
    expect(resolveGithubSource("github.com/user/repo/mono")).toMatchObject({ owner: "user", repo: "repo", selector: "mono", cloneUrl: "https://github.com/user/repo.git" })
    expect(resolveGithubSource("https://github.com/user/repo.git/mono")).toMatchObject({ owner: "user", repo: "repo", selector: "mono" })
    expect(resolveGithubSource("git@github.com:user/repo.git/liftaris/mono")).toMatchObject({ owner: "user", repo: "repo", selector: "liftaris/mono" })
    expect(() => resolveGithubSource("https://gitlab.com/user/repo/mono")).toThrow(/only github/i)
    expect(() => resolveGithubSource("github.com/user/repo/../mono")).toThrow(/unsafe selector/i)
    expect(() => resolveGithubSource("github.com/user/repo/--upload-pack=x")).toThrow(/unsafe selector/i)
  })

  test("selector resolves eikons/index.json before registry.json and records repo/catalog identity", async () => {
    const repo = join(root, "catalog-repo")
    writeRegistryPackage(repo, "liftaris", "mono")
    mkdirSync(join(repo, "eikons"), { recursive: true })
    writeFileSync(join(repo, "eikons/index.json"), JSON.stringify([{ manifest: pkg("mono"), packageUrl: "../packages/liftaris/mono/1.0.0.json", sourceKey: "chosen:eikons" }], null, 2))
    writeFileSync(join(repo, "registry.json"), JSON.stringify([{ manifest: pkg("mono"), packageUrl: "../packages/liftaris/mono/1.0.0.json", sourceKey: "wrong:registry" }], null, 2))

    const out = await resolve("github.com/user/repo/mono", { clone: async dst => ({ dir: repo, sha: "abc123", cleanup: false }) })
    expect(out.name).toBe("mono")
    expect(out.origin.kind).toBe("github-catalog")
    expect(out.origin.catalogRoot).toBe("eikons/index.json")
    expect(out.origin.sourceKey).toBe("chosen:eikons")
    expect(out.origin.sha).toBe("abc123")
  })

  test("selector falls back to unambiguous package index and namespace/name selectors", async () => {
    const repo = join(root, "package-index-repo")
    writeRegistryPackage(repo, "liftaris", "mono")
    const out = await resolve("github.com/user/repo/liftaris/mono", { clone: async () => ({ dir: repo, sha: "def456", cleanup: false }) })
    expect(out.origin.kind).toBe("github-catalog")
    expect(out.origin.catalogRoot).toBe("packages/liftaris/mono/index.json")
    expect(out.name).toBe("mono")
  })

  test("ambiguous package-index selector fails instead of picking first", async () => {
    const repo = join(root, "ambiguous-repo")
    writeRegistryPackage(repo, "liftaris", "mono")
    writeRegistryPackage(repo, "other", "mono")
    await expect(resolve("github.com/user/repo/mono", { clone: async () => ({ dir: repo, sha: "def456", cleanup: false }) })).rejects.toThrow(/ambiguous.*namespace\/name/i)
  })

  test("selector mismatch does not fall back to single-package root", async () => {
    const repo = join(root, "single-with-selector")
    writePackage(repo, "root")
    await expect(resolve("github.com/user/repo/mono", { clone: async () => ({ dir: repo, sha: "fff999", cleanup: false }) })).rejects.toThrow(/no eikon.*mono/i)
  })
})

describe("U1 production downloader boundary", () => {
  test("blocks private hosts by default, supports explicit fixture allowance", async () => {
    await expect(downloadBytes("http://127.0.0.1/pkg", { fetcher: fetch })).rejects.toThrow(/private host/)
    const bytes = await downloadBytes("http://127.0.0.1/pkg", { allowPrivate: true, fetcher: async () => new Response("ok") })
    expect(new TextDecoder().decode(bytes)).toBe("ok")
  })

  test("blocks redirect-to-private and byte cap overflow", async () => {
    await expect(downloadBytes("https://cdn.example/pkg", { fetcher: async () => new Response("", { status: 302, headers: { location: "http://127.0.0.1/pkg" } }) })).rejects.toThrow(/private host/)
    await expect(downloadBytes("https://cdn.example/pkg", { maxBytes: 2, fetcher: async () => new Response("toolong") })).rejects.toThrow(/byte limit/)
  })

  test("redacts credentials in download failures", async () => {
    await expect(downloadBytes("https://user:secret@cdn.example/pkg", { fetcher: async () => new Response("nope", { status: 404 }) })).rejects.toThrow(/https:\/\/\[redacted\]@cdn\.example\/pkg/)
  })
})

describe("U1 public export surface", () => {
  test("root exports host resolver/trust primitives and catalog subpath stays browser safe", async () => {
    const eikon = await import("eikon")
    expect("resolveGithubSource" in eikon).toBe(true)
    expect("downloadBytes" in eikon).toBe(true)
    expect("verifyPackageFiles" in eikon).toBe(true)
    expect("TRUST_STATES" in eikon).toBe(true)

    const catalog = await import("eikon/catalog")
    expect("resolveGithubSource" in catalog).toBe(false)
    expect("downloadBytes" in catalog).toBe(false)
    expect("verifyPackageFiles" in catalog).toBe(false)
  })
})
