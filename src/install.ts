// eikon install resolver — the one shared entry point for obtaining an
// eikon from any of: bare catalog name, git URL, local directory, or
// http(s) manifest base URL. Pure wrt host state: caller supplies
// destRoot; no hermes-home, no prefs, no console.
//
// Writes `manifest.json` at the destination with an `origin` block so
// `update` and profile-distribution can detect local edits.

import { existsSync, mkdirSync, readFileSync, writeFileSync, copyFileSync, rmSync, statSync, readdirSync } from "node:fs"
import { join, extname, basename } from "node:path"
import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { STATES, FORMAT_VERSION, DEFAULT_CATALOG, type State } from "./ui/spec"
import { serialize, type Doc } from "./ui/format"
import { loadCatalogEntries } from "./catalog"
import { PACKAGE_KIND, type EikonPackageManifest } from "./contract/shape"
import { validatePackageManifest } from "./package/manifest"
import { parseLaunchStream } from "./stream"
import type { Manifest } from "./ui/lint"

export type Role = State | "base"
export type Sources = Partial<Record<Role, string>>
export type Origin = { source: string; at: string; sha?: string }

export type Resolved = {
  name: string
  manifest: Manifest | EikonPackageManifest
  /** Local dir where manifest.json + any staged media live. */
  staged: string
  /** When staged came from an http base (no local tree). */
  base?: string
  /** Staged is a clone-owned tempdir; install() rm's it after copy. */
  tmp?: boolean
  origin: Origin
}

export type Installed = Resolved & { dir: string; sources: Sources; n: number; bytes: number }

export type Opts = {
  name?: string
  /** Fetch source media into <dest>/source/. Default true. */
  media?: boolean
  catalog?: string
  progress?: (done: number, total: number) => void
}

/** Role-tagged (role, relpath) pairs from either manifest shape. */
export function entries(man: Manifest | Record<string, unknown>): Array<[Role, string]> {
  if ((man as Record<string, unknown>).kind === PACKAGE_KIND) {
    const pkg = validatePackageManifest(man)
    const xs: Array<[Role, string]> = []
    if (pkg.source?.base) xs.push(["base", pkg.source.base])
    for (const k of STATES) {
      const f = pkg.source?.states?.[k]?.file
      if (f) xs.push([k, f])
    }
    return xs
  }
  const xs: Array<[Role, string]> = []
  const src = (man as Manifest).source
  if (typeof src === "string") xs.push(["base", src])
  const st = (man as Manifest).states as Record<string, { file?: string }> | undefined
  if (st) for (const k of STATES) { const f = st[k]?.file; if (f) xs.push([k, f]) }
  if (xs.length === 0 && Array.isArray((man as Record<string, unknown>).files))
    for (const f of (man as { files: unknown[] }).files) {
      if (typeof f !== "string") continue
      const stem = basename(f, extname(f)).toLowerCase() as Role
      xs.push([stem === "base" || (STATES as readonly string[]).includes(stem) ? stem : "base", f])
    }
  return xs
}

function manifest(value: unknown): Manifest | EikonPackageManifest {
  if ((value as Record<string, unknown>).kind === PACKAGE_KIND) return validatePackageManifest(value)
  return value as Manifest
}

const gitish = (s: string) =>
  /^git@|^ssh:\/\/|^git:\/\/|\.git$/.test(s) ||
  /^(https?:\/\/)?(github|gitlab|bitbucket)\.com\/[\w.-]+\/[\w.-]+\/?$/.test(s)

async function clone(url: string, dst: string): Promise<string | undefined> {
  const full = /^[\w.-]+\.com\/[\w.-]+\/[\w.-]+\/?$/.test(url) ? `https://${url}` : url
  const p = Bun.spawn(["git", "clone", "--depth", "1", full, dst], { stdout: "pipe", stderr: "pipe" })
  const [code, err] = await Promise.all([p.exited, new Response(p.stderr).text()])
  if (code !== 0) throw new Error(`git clone failed: ${err.trim()}`)
  const sha = await new Response(Bun.spawn(["git", "-C", dst, "rev-parse", "HEAD"], { stdout: "pipe" }).stdout).text()
  rmSync(join(dst, ".git"), { recursive: true, force: true })
  return sha.trim() || undefined
}

/** Find a manifest.json at root or exactly one level deep. */
function locate(dir: string): string {
  if (existsSync(join(dir, "manifest.json"))) return dir
  for (const e of readdirSync(dir, { withFileTypes: true }))
    if (e.isDirectory() && existsSync(join(dir, e.name, "manifest.json")))
      return join(dir, e.name)
  throw new Error(`no manifest.json in ${dir} (or one level deep)`)
}

function checkRequires(spec: string | undefined): void {
  if (!spec) return
  const m = spec.match(/^\s*(>=|>|<=|<|==|=)?\s*(\d+)/)
  if (!m) return
  const [, op = ">=", v] = m
  const n = Number(v), cur = FORMAT_VERSION
  const ok = op === ">=" ? cur >= n : op === ">" ? cur > n
           : op === "<=" ? cur <= n : op === "<" ? cur < n : cur === n
  if (!ok) throw new Error(`eikon_requires ${spec}: this build supports format ${cur}`)
}

function legacy(text: string, name: string): string {
  const eikon = parseLaunchStream(text)
  const doc: Doc = {
    header: { eikon: 1, name, width: eikon.meta.width, height: eikon.meta.height, glyph: eikon.meta.glyph },
    states: eikon.meta.states.flatMap(state => {
      const clip = eikon.clips.get(state)
      if (!clip) return []
      return [{
        state,
        fps: clip.fps,
        frame_count: clip.frames.length,
        loop_from: clip.loopFrom,
        frames: clip.frames.map((rows, i) => ({ f: i, data: rows.join("\n") })),
      }]
    }),
  }
  return serialize(doc)
}

type IndexEntry = { name: string; source?: string; packageUrl?: string; installUrl?: string; [k: string]: unknown }

async function catalog(name: string, url: string): Promise<string> {
  const base = url.replace(/\/?$/, "/")
  const entries = await loadCatalogEntries(base)
  const entry = entries.find(e => e.name === name || e.id === name)
  if (entry) return (entry.installUrl ?? entry.packageUrl).replace(/manifest\.json$/, "")

  const res = await fetch(base + "index.json")
  if (!res.ok) throw new Error(`catalog: HTTP ${res.status}`)
  const idx = await res.json() as IndexEntry[]
  const hit = idx.find(e => e.name === name)
  if (!hit) throw new Error(`catalog: no eikon named "${name}"`)
  if (typeof hit.packageUrl === "string") return new URL(hit.packageUrl, base).href.replace(/manifest\.json$/, "")
  return base + (hit.source ?? `${name}/`)
}

export async function resolve(src: string, opts?: Pick<Opts, "catalog">): Promise<Resolved> {
  const at = new Date().toISOString()

  // Bare name → catalog → recurse with the resolved source URL.
  if (!/[\/:]/.test(src))
    return resolve(await catalog(src, opts?.catalog ?? DEFAULT_CATALOG), opts)

  // Local directory.
  const local = src.replace(/^file:\/\//, "")
  if (!gitish(src) && existsSync(local) && statSync(local).isDirectory()) {
    const staged = locate(local)
    const man = manifest(JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8")))
    return { name: man.name, manifest: man, staged, origin: { source: src, at } }
  }

  // Git URL.
  if (gitish(src)) {
    const tmp = mkdtempSync(join(tmpdir(), "eikon-"))
    const sha = await clone(src, tmp)
    const staged = locate(tmp)
    const man = manifest(JSON.parse(readFileSync(join(staged, "manifest.json"), "utf8")))
    return { name: man.name, manifest: man, staged, tmp: true, origin: { source: src, at, sha } }
  }

  // http(s) manifest base.
  if (/^https?:\/\//.test(src)) {
    const raw = new URL(src)
    const href = raw.pathname.endsWith("/manifest.json") ? raw.href : new URL("manifest.json", src.replace(/\/?$/, "/")).href
    const base = new URL(".", href).href
    const res = await fetch(href)
    if (!res.ok) throw new Error(`manifest: HTTP ${res.status}`)
    const man = manifest(await res.json())
    return { name: man.name, manifest: man, staged: "", base, origin: { source: src, at } }
  }

  throw new Error(`cannot resolve "${src}": expected catalog name, git URL, local dir, or http(s) base`)
}

const peeked = new Map<string, Promise<{ n: number; bytes: number } | undefined>>()

/** HEAD the manifest's referenced files; memoized per src. */
export function peek(src: string, opts?: Pick<Opts, "catalog">): Promise<{ n: number; bytes: number } | undefined> {
  const hit = peeked.get(src)
  if (hit) return hit
  const p = resolve(src, opts).then(async r => {
    const xs = entries(r.manifest)
    if (r.base) {
      const sizes = await Promise.all(xs.map(([, rel]) =>
        fetch(new URL(rel, r.base).href, { method: "HEAD" })
          .then(h => Number(h.headers.get("content-length") ?? 0)).catch(() => 0)))
      return { n: xs.length, bytes: sizes.reduce((a, b) => a + b, 0) }
    }
    const bytes = xs.reduce((a, [, rel]) => {
      const p = join(r.staged, rel)
      return a + (existsSync(p) ? statSync(p).size : 0)
    }, 0)
    return { n: xs.length, bytes }
  }).catch(() => undefined)
  peeked.set(src, p)
  return p
}

export async function install(src: string, root: string, opts: Opts = {}): Promise<Installed> {
  const r = await resolve(src, opts)
  checkRequires((r.manifest as Manifest & { eikon_requires?: string }).eikon_requires)
  const name = opts.name ?? r.name
  const dst = join(root, name)
  const srcd = join(dst, "source")
  mkdirSync(srcd, { recursive: true })

  if ((r.manifest as Record<string, unknown>).kind === PACKAGE_KIND) {
    const man = validatePackageManifest(r.manifest)
    const rel = man.entrypoints.default
    const text = r.base
      ? await fetch(new URL(rel, r.base).href).then(res => {
          if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
          return res.text()
        })
      : readFileSync(join(r.staged, rel), "utf8")
    writeFileSync(join(dst, `${name}.eikonl`), text)
    writeFileSync(join(dst, `${name}.eikon`), legacy(text, name))
  }

  // The packed .eikon travels when present in the source.
  const packed = `${r.name}.eikon`
  if (r.staged && existsSync(join(r.staged, packed)))
    copyFileSync(join(r.staged, packed), join(dst, `${name}.eikon`))
  else if (r.base) {
    const res = await fetch(r.base + packed)
    if (res.ok) await Bun.write(join(dst, `${name}.eikon`), new Uint8Array(await res.arrayBuffer()))
  }

  const xs = entries(r.manifest)
  const sources: Sources = {}
  let done = 0, bytes = 0
  const tick = () => opts.progress?.(++done, xs.length)

  if (opts.media !== false) await Promise.all(xs.map(async ([role, rel]) => {
    const fname = `${role}${extname(rel).toLowerCase()}`
    const to = join(srcd, fname)
    if (r.base) {
      const res = await fetch(new URL(rel, r.base).href)
      if (!res.ok) throw new Error(`${rel}: HTTP ${res.status}`)
      const buf = new Uint8Array(await res.arrayBuffer())
      await Bun.write(to, buf); bytes += buf.length
    } else {
      const from = join(r.staged, rel)
      if (!existsSync(from)) throw new Error(`${rel}: missing in ${r.staged}`)
      copyFileSync(from, to); bytes += statSync(to).size
    }
    sources[role] = fname; tick()
  }))

  const out = { ...r.manifest, origin: r.origin }
  writeFileSync(join(dst, "manifest.json"), JSON.stringify(out, null, 2) + "\n")

  if (r.tmp) rmSync(r.staged, { recursive: true, force: true })

  return { ...r, name, dir: dst, sources, n: xs.length, bytes }
}

/** True if <dir> looks locally modified since install (coarse: any
 *  file mtime > origin.at). */
export function dirty(dir: string): boolean {
  const mf = join(dir, "manifest.json")
  if (!existsSync(mf)) return false
  const man = JSON.parse(readFileSync(mf, "utf8")) as Manifest & { origin?: Origin }
  if (!man.origin?.at) return false
  const since = Date.parse(man.origin.at)
  for (const e of readdirSync(dir, { withFileTypes: true, recursive: true }) as Array<{ name: string; parentPath: string }>)
    if (statSync(join(e.parentPath ?? dir, e.name)).mtimeMs > since + 2000) return true
  return false
}
