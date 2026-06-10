#!/usr/bin/env bun
// eikon CLI — install/pack/lint/show/publish/browse + registry maint.

import { resolve, basename, join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync, writeFileSync, mkdirSync, readdirSync, rmSync } from "node:fs"
import { parse, poster } from "./ui/eikon"
import { lint, lintManifest } from "./ui/lint"
import { resolve as resolveInstall, install, dirty, verifyPackageFiles, TRUST_STATES, type Origin, type TrustState } from "./install"
import { pack } from "./pack"
import * as reg from "./registry"
import { Browser } from "./browse/Browser"
import { local, resolve as cat } from "./browse/catalog"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { PACKAGE_KIND, type EikonPackageManifest } from "./contract/shape"
import { validatePackageManifest } from "./package/manifest"
import { loadCatalogEntries, searchCatalogEntries } from "./catalog"
import { decodeRuntimeFile, writeRuntimeFile } from "./stream"
import { summarizeLifecycle, updatePlan } from "./lifecycle"

const REPO = process.env.EIKON_REPO ?? "liftaris/eikon"
const profileRoot = () => process.env.HERM_CONFIG_DIR ?? join(process.env.HERMES_HOME ?? join(homedir(), ".hermes"), "herm")
const root = () => join(profileRoot(), "eikons")
const prefsFile = () => process.env.HERM_CONFIG_DIR ? join(process.env.HERM_CONFIG_DIR, "tui.json") : join(process.env.HERMES_HOME ?? join(homedir(), ".hermes"), "herm", "tui.json")
const mb = (n: number) => n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`

const die = (msg: string): never => { console.error(`eikon: ${msg}`); process.exit(1) }
const out = (a: ReturnType<typeof args>, data: unknown, human: () => string) => console.log(a.kv.json ? JSON.stringify(data, null, 2) : human())

function args(argv: string[]) {
  const pos: string[] = [], kv: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith("--")) { pos.push(a); continue }
    const next = argv[i + 1]
    kv[a.slice(2)] = next && !next.startsWith("--") ? (i++, next) : true
  }
  return { pos, kv, str: (k: string) => typeof kv[k] === "string" ? kv[k] as string : undefined }
}

function prefs(): Record<string, unknown> {
  const path = prefsFile()
  if (!existsSync(path)) return {}
  const raw = readFileSync(path, "utf8").trim()
  if (!raw) return {}
  const value = JSON.parse(raw) as Record<string, unknown>
  if (!value.eikon && typeof value.eikonPath === "string") value.eikon = basename(value.eikonPath, ".eikon")
  return value
}

function active() {
  const value = prefs().eikon
  return typeof value === "string" ? value : undefined
}

function writePrefs(next: Record<string, unknown>) {
  mkdirSync(profileRoot(), { recursive: true })
  writeFileSync(prefsFile(), JSON.stringify(next, null, 2) + "\n")
}

function setActive(name: string | undefined) {
  const next = prefs()
  if (name) next.eikon = name
  else delete next.eikon
  delete next.eikonPath
  writePrefs(next)
}

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/

function lifecycleName(name: string) {
  if (!NAME_RE.test(name)) die(`${name || "<empty>"}: invalid eikon name`)
  return name
}

function requiredLifecycleName(argv: string[], a: ReturnType<typeof args>, usage: string): string {
  if (a.pos[0] !== undefined) return lifecycleName(a.pos[0])
  if (argv[0]?.startsWith("--")) die(`${argv[0]}: invalid eikon name`)
  return die(usage)
}

function installedDir(name: string) { return join(root(), name) }
function manifestPath(name: string) { return join(installedDir(name), "manifest.json") }

function installedNames() {
  if (!existsSync(root())) return []
  return readdirSync(root(), { withFileTypes: true }).filter(e => e.isDirectory() && existsSync(join(root(), e.name, "manifest.json"))).map(e => e.name).sort()
}

type InstalledManifest = Record<string, unknown> & {
  name?: string
  version?: string | number
  display?: { title?: string; author?: string }
  origin?: Origin
  files?: unknown[]
  compatibility?: { eikon?: string }
}

function trustOf(man: InstalledManifest, dir: string): TrustState {
  const originTrust = man.origin?.trust
  if (originTrust && TRUST_STATES.includes(originTrust)) return originTrust
  if (man.kind === PACKAGE_KIND) return verifyPackageFiles(validatePackageManifest(man), dir).state
  return "unverified"
}

function infoFor(name: string) {
  const path = manifestPath(name)
  if (!existsSync(path)) die(`${name}: not installed`)
  const man = JSON.parse(readFileSync(path, "utf8")) as InstalledManifest
  const isActive = active() === name
  const trust = trustOf(man, installedDir(name))
  return {
    name,
    title: man.display?.title ?? man.name,
    author: man.display?.author,
    version: man.version,
    status: isActive ? "active" : "installed",
    active: isActive,
    sourceKind: man.origin?.kind ?? "unknown",
    sourceIdentity: man.origin?.identityKey ?? man.origin?.sourceKey ?? man.origin?.repo ?? man.origin?.source,
    source: man.origin?.source,
    compatibility: man.compatibility?.eikon,
    trust,
    removable: true,
    updateable: !!man.origin?.source,
    dir: installedDir(name),
  }
}

function inspectResult(src: string, r: Awaited<ReturnType<typeof resolveInstall>>, installed: boolean) {
  const man = r.manifest as EikonPackageManifest
  return {
    command: "inspect",
    name: r.name,
    title: man.display?.title ?? man.name,
    author: man.display?.author,
    version: man.version,
    source: src,
    sourceKind: r.origin.kind,
    sourceIdentity: r.origin.identityKey ?? r.origin.sourceKey ?? r.origin.repo ?? r.origin.source,
    compatibility: man.compatibility?.eikon,
    runtime: true,
    poster: !!man.poster,
    installed,
    trust: r.trust.state,
    trustReason: r.trust.reason,
  }
}

async function gh(args: string[], input?: string) {
  const p = Bun.spawn(["gh", ...args], { stdin: input ? new TextEncoder().encode(input) : undefined, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) die(`gh ${args[0]} failed: ${err.trim() || out.trim()}`)
  return out.trim()
}

const cmds: Record<string, (argv: string[]) => Promise<void>> = {
  async lint(argv) {
    const path = argv[0] ?? die("usage: eikon lint <file.eikon|manifest.json>")
    const raw = basename(path) === "manifest.json" ? await Bun.file(resolve(path)).text() : decodeRuntimeFile(resolve(path))
    if (basename(path) === "manifest.json") {
      const parsed = JSON.parse(raw) as Record<string, unknown>
      if (parsed.kind === PACKAGE_KIND) {
        const m = validatePackageManifest(parsed)
        console.log(`✓ ${m.name} · ${m.entrypoints.default} · ${m.compatibility.eikon}`)
        return
      }
      const m = lintManifest(resolve(path), raw)
      console.log(`✓ ${m.name} · ${Object.keys(m.states).length} states${m.source ? ` · ${m.source}` : ""}`)
      return
    }
    const e = lint(raw)
    console.log(`✓ ${e.meta.name} · ${e.meta.width}×${e.meta.height} · ${e.clips.size} states`)
  },

  async publish(argv) {
    if (argv.includes("--help")) {
      console.log(`eikon publish <file.eikon>\n\nGitHub PR contribution helper for ${REPO}. Set EIKON_REPO=owner/repo to target a different catalog. This prepares a normal GitHub contribution with gh; no hosted upload/auth service, dashboard, or moderation product is involved.`)
      return
    }
    const path = argv[0] ?? die("usage: eikon publish <file>")
    const abs = resolve(path)
    const raw = decodeRuntimeFile(abs)
    const e = lint(raw)
    const name = e.meta.name
    const branch = `add/${name}`

    await gh(["repo", "fork", REPO, "--clone=false"]).catch(() => {})
    const user = await gh(["api", "user", "-q", ".login"])
    const fork = `${user}/${REPO.split("/")[1]}`

    // Create branch ref off upstream main, then PUT the file.
    const main = await gh(["api", `repos/${REPO}/git/ref/heads/main`, "-q", ".object.sha"])
    await gh(["api", "-X", "POST", `repos/${fork}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${main}`]).catch(() => {})
    await gh(["api", "-X", "PUT", `repos/${fork}/contents/eikons/${name}/${name}.eikon`,
      "-f", `message=eikons: add ${name}`,
      "-f", `branch=${branch}`,
      "-f", `content=${Buffer.from(await Bun.file(abs).arrayBuffer()).toString("base64")}`])

    const url = await gh(["pr", "create", "-R", REPO, "-H", `${user}:${branch}`, "-B", "main",
      "-t", `eikons: add ${name}`,
      "-b", `Adds \`${name}\` by ${e.meta.author}. ${e.meta.width}×${e.meta.height}, ${e.clips.size} states.`])
    console.log(url)
  },

  async install(argv) {
    const a = args(argv)
    const src = a.pos[0] ?? die("usage: eikon install <name|url|dir> [--name N] [--no-source] [--catalog URL] [--json]")
    const before = active()
    const installed = await install(src, root(), {
      name: a.str("name"), media: !a.kv["no-source"], catalog: a.str("catalog"),
      progress: a.kv.json ? undefined : (d, t) => process.stderr.write(`\r  ${d}/${t}`),
    })
    if (!a.kv.json) process.stderr.write("\r")
    const data = { command: "install", name: installed.name, files: installed.n, bytes: installed.bytes, dir: installed.dir, active: before, trust: installed.trust.state, sourceKind: installed.origin.kind }
    out(a, data, () => `✓ ${installed.name}  ${installed.n} files  ${mb(installed.bytes)}  → ${installed.dir}\n  installed only; run eikon use ${installed.name} to activate`)
  },

  async inspect(argv) {
    const a = args(argv)
    const src = a.pos[0] ?? die("usage: eikon inspect <name|url|dir> [--catalog URL] [--json]")
    const r = await resolveInstall(src, { catalog: a.str("catalog") })
    const data = inspectResult(src, r, existsSync(manifestPath(r.name)))
    out(a, data, () => `${data.name}  ${data.title ?? ""}\n  author: ${data.author ?? "unknown"}\n  source: ${data.sourceKind} ${data.sourceIdentity ?? data.source}\n  trust:  ${data.trust}${data.trustReason ? ` (${data.trustReason})` : ""}\n  installed: ${data.installed}`)
  },

  async search(argv) {
    const a = args(argv)
    const query = a.pos.join(" ")
    const catalog = a.str("catalog")
    const source = catalog ?? "https://eikon.liftaris.dev/eikons"
    const entries = await loadCatalogEntries(source, fetch, { allowPrivate: /^http:\/\/localhost[:/]/.test(source) })
    const rows = searchCatalogEntries(entries, query).map(e => ({ name: e.name, title: e.title ?? e.name, author: e.author, version: e.version, sourceIdentity: e.sourceKey || e.id, trust: e.trust?.manifestDigest || e.trust?.runtimeDigest ? "verified" : "unverified", installed: existsSync(manifestPath(e.name)), active: active() === e.name }))
    out(a, rows, () => rows.map(e => `${e.name}\t${e.title}\t${e.trust}`).join("\n"))
  },

  async list(argv) {
    const a = args(argv)
    const rows = installedNames().map(infoFor)
    out(a, rows, () => rows.map(e => `${e.status === "active" ? "*" : " "} ${e.name}\t${e.sourceKind}\t${e.trust}`).join("\n"))
  },

  async use(argv) {
    const a = args(argv)
    const name = requiredLifecycleName(argv, a, "usage: eikon use <name> [--json]")
    if (!existsSync(manifestPath(name))) die(`${name}: not installed in ${root()}`)
    setActive(name)
    out(a, { command: "use", name, active: name }, () => `✓ active eikon: ${name}`)
  },

  async update(argv) {
    const a = args(argv)
    const name = requiredLifecycleName(argv, a, "usage: eikon update <name> [--force] [--active-ok] [--json]")
    const dir = installedDir(name)
    const mf = manifestPath(name)
    if (!existsSync(mf)) die(`${name}: not installed (no manifest.json)`)
    const man = JSON.parse(readFileSync(mf, "utf8")) as InstalledManifest
    const origin = man.origin
    if (!origin?.source) die(`${name}: no origin recorded; reinstall with a source`)
    const updateOrigin = origin as Origin & { source: string }
    if (active() === name && !a.kv["active-ok"]) die(`${name}: update would change the active avatar backing package; pass --active-ok to acknowledge`)
    if (dirty(dir) && !a.kv.force) die(`${name}: locally modified since install; pass --force to overwrite`)
    const src = updateOrigin.source
    const currentTrust = trustOf(man, dir)
    const current = summarizeLifecycle({ name, manifest: man, origin: updateOrigin, trust: { state: currentTrust } }, updateOrigin.scope)
    const candidate = await resolveInstall(src)
    const next = summarizeLifecycle({ name: candidate.name, manifest: candidate.manifest, origin: candidate.origin, trust: candidate.trust }, updateOrigin.scope)
    const plan = updatePlan(current, next)
    if (candidate.tmp) rmSync(candidate.cleanup ?? candidate.staged, { recursive: true, force: true })
    if (!plan.available) die(`${name}: update unavailable: ${plan.reason}`)
    const installed = await install(src, root(), { name })
    out(a, { command: "update", name: installed.name, source: src, active: active() === name, trust: installed.trust.state, from: plan.from, to: plan.to }, () => `✓ ${installed.name}  ${installed.n} files  ${mb(installed.bytes)}  (${src})`)
  },

  async remove(argv) {
    const a = args(argv)
    const name = requiredLifecycleName(argv, a, "usage: eikon remove <name> [--active-ok] [--json]")
    const dir = installedDir(name)
    if (!existsSync(manifestPath(name))) die(`${name}: not installed`)
    const wasActive = active() === name
    if (wasActive && !a.kv["active-ok"]) die(`${name}: remove would clear the active avatar; pass --active-ok to acknowledge`)
    rmSync(dir, { recursive: true, force: true })
    if (wasActive) setActive(undefined)
    out(a, { command: "remove", name, removed: true, activeCleared: wasActive }, () => `✓ removed ${name}${wasActive ? " and cleared active eikon" : ""}`)
  },

  async info(argv) {
    const a = args(argv)
    const name = requiredLifecycleName(argv, a, "usage: eikon info <name> [--json]")
    const data = infoFor(name)
    out(a, data, () => `${data.name}  ${data.version ? `v${data.version}` : ""}  ${data.status}\n  title:  ${data.title ?? data.name}\n  author: ${data.author ?? "unknown"}\n  from:   ${data.sourceKind} ${data.sourceIdentity ?? data.source ?? "unknown"}\n  trust:  ${data.trust}\n  dir:    ${data.dir}`)
  },

  add: (argv) => cmds.install!(argv),

  async show(argv) {
    const src = argv[0] ?? die("usage: eikon show <name|file>")
    const catalog = src.endsWith(".eikon")
      ? local(resolve(src, ".."))
      : cat(resolve(import.meta.dir, "../eikons"))
    const raw = src.endsWith(".eikon") ? decodeRuntimeFile(resolve(src)) : await catalog.load(src)
    const e = parse(raw)
    // Cheap inline preview: render poster, list states.
    console.log(poster(e))
    console.log(`\n${e.meta.glyph ?? "⬡"} ${e.meta.name} · ${e.meta.author ?? "—"} · ${[...e.clips.keys()].join(" ")}`)
  },

  async pack(argv) {
    const a = args(argv)
    const src = a.pos[0] ?? die("usage: eikon pack <image|video|dir> [out.eikon] [--gzip] [--name N] [--glyph G] [--author A] [--width 48] [--height 24] [--fps 16] [--symbols block|braille|ascii] [--colors none|256|full] [--no-invert]")
    const { doc, text } = pack(resolve(src), {
      name: a.str("name"), author: a.str("author"), glyph: a.str("glyph"),
      width: a.str("width") ? +a.str("width")! : undefined,
      height: a.str("height") ? +a.str("height")! : undefined,
      fps: a.str("fps") ? +a.str("fps")! : undefined,
      symbols: a.str("symbols") as never, colors: a.str("colors") as never,
      invert: !a.kv["no-invert"],
    })
    lint(text)
    const out = resolve(a.pos[1] ?? `${doc.header.name}.eikon`)
    writeRuntimeFile(out, text, { encoding: a.kv.gzip ? "gzip" : "identity" })
    const bytes = await Bun.file(out).arrayBuffer()
    const total = doc.states.reduce((n, s) => n + s.frame_count, 0)
    console.log(`✓ ${out}  (${doc.header.width}×${doc.header.height}, ${total} frames, ${(bytes.byteLength / 1024).toFixed(1)} KB${a.kv.gzip ? ", gzip" : ""})`)
    console.log(`  eikon show ${out}`)
  },

  async browse() {
    const r = await createCliRenderer({ exitOnCtrlC: true })
    createRoot(r).render(<Browser catalog={cat(resolve(import.meta.dir, "../eikons"))} />)
  },

  async index(argv) {
    const a = args(argv)
    const n = await reg.index({ base: a.pos[0], encoding: a.kv.gzip ? "gzip" : "identity" })
    console.log(`wrote ${n} entries → eikons/index.json`)
  },

  async manifest(argv) {
    const a = args(argv)
    console.log(`wrote ${reg.manifest({ encoding: a.kv.gzip ? "gzip" : "identity" })} manifests`)
  },

  async verify(argv) {
    const a = args(argv)
    const result = await reg.verifyArtifacts({ base: a.pos[0], encoding: a.kv.identity ? "identity" : "gzip" })
    if (!result.ok) die(`generated artifacts are stale:\n${result.diffs.join("\n")}`)
    out(a, result, () => "✓ generated artifacts are fresh")
  },
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2)
  const fn = cmd ? cmds[cmd] : undefined
  if (!fn) die(`usage: eikon {${Object.keys(cmds).join("|")}} ...`)
  else await fn(argv).catch(e => die(e instanceof Error ? e.message : String(e)))
}
