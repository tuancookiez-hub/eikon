import { copyFileSync, existsSync, lstatSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, statSync, writeFileSync } from "node:fs"
import { tmpdir } from "node:os"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { lint, lintManifest, type Manifest } from "./ui/lint"
import { decodeRuntimeFile, encodeRuntimeText } from "./stream"
import { catalogEntry, normalizeCatalogEntry, type PublicCatalogEntry } from "./catalog"
import type { CatalogEntry } from "./contract/shape"
import { manifest as registryManifest, index as registryIndex } from "./registry"

export const DEFAULT_SUBMIT_REPO = process.env.EIKON_REPO ?? "liftaris/eikon"
export const DEFAULT_MAX_BUNDLE_BYTES = 32 * 1024 * 1024

export type FailureCode = "invalid-eikon" | "missing-auth" | "missing-source" | "backend-failed"
export type SubmitFailure = { code: FailureCode; message: string }
export type BundleFile = { path: string; dest: string; abs: string; bytes: number }
export type SubmitBundle = {
  root: string
  packed: string
  files: BundleFile[]
  meta: ReturnType<typeof lint>["meta"]
  manifest?: Manifest
  catalog: PublicCatalogEntry
  lint: string[]
}
export type SubmitRequest = { bundle: SubmitBundle; title: string; body: string }
export type Submitted = { kind: "submitted"; url: string; request: SubmitRequest }
export type SubmitBackend = {
  check: () => Promise<{ ok: true } | { ok: false; reason: string }>
  create: (req: SubmitRequest) => Promise<Submitted>
}
export type SubmitResult = Submitted
  | { kind: "validation-failed"; failures: SubmitFailure[] }
  | { kind: "setup-needed"; failures: SubmitFailure[] }
  | { kind: "backend-failed"; failures: SubmitFailure[] }

export type BundleOpts = {
  path: string
  extraFiles?: string[]
  allowHidden?: boolean
  allowSecrets?: boolean
  maxBytes?: number
}

export type SubmitOpts = BundleOpts & { backend?: SubmitBackend }

type Gh = (args: string[], input?: string) => Promise<string>

const SECRET = /(\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa$|id_ed25519$|token|secret|credential|password)/i
const TOKEN = /(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+[A-Za-z0-9._~+/=-]+|token\s+[A-Za-z0-9._~+/=-]+)/gi
const hidden = (rel: string) => rel.split(/[\\/]/).some(p => p.startsWith("."))
const secret = (rel: string) => SECRET.test(rel)
const redact = (s: string) => s.replace(TOKEN, "[redacted]")
const posix = (s: string) => s.split(sep).join("/")

function contain(root: string, rel: string) {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel) || rel.split(/[\\/]/).some(p => p === ".."))
    throw new Error(`submission bundle path escape: ${rel}`)
  const abs = resolve(root, rel)
  const back = relative(root, abs)
  if (back.startsWith("..") || back === "" || resolve(root, back) !== abs) throw new Error(`submission bundle path escape: ${rel}`)
  return { abs, rel: posix(back) }
}

function copy(root: string, rel: string, out: string, opts: BundleOpts) {
  const path = contain(root, rel)
  if (!existsSync(path.abs)) throw new Error(`submission bundle missing source: ${path.rel}`)
  if (!opts.allowHidden && hidden(path.rel)) return
  if (!opts.allowSecrets && secret(path.rel)) return
  const parts = path.rel.split("/")
  let cur = root
  for (const part of parts) {
    cur = join(cur, part)
    const st = lstatSync(cur)
    if (st.isSymbolicLink()) throw new Error(`submission bundle symlink unsupported: ${path.rel}`)
    if (part !== parts.at(-1) && !st.isDirectory()) return
    if (part === parts.at(-1) && !st.isFile()) return
  }
  mkdirSync(dirname(join(out, path.rel)), { recursive: true })
  copyFileSync(path.abs, join(out, path.rel))
}

function refs(raw: string): string[] {
  const man = JSON.parse(raw) as Record<string, unknown>
  if (man.kind === "eikon.package") {
    const source = man.source && typeof man.source === "object" && !Array.isArray(man.source) ? man.source as { base?: unknown; states?: unknown } : {}
    const states = source.states && typeof source.states === "object" && !Array.isArray(source.states) ? source.states as Record<string, { file?: unknown }> : {}
    return [
      ...(typeof source.base === "string" ? [source.base] : []),
      ...Object.values(states).flatMap(v => typeof v.file === "string" ? [v.file] : []),
    ]
  }
  const states = man.states && typeof man.states === "object" && !Array.isArray(man.states) ? man.states as Record<string, { file?: unknown }> : {}
  return [
    ...(typeof man.source === "string" ? [man.source] : []),
    ...Object.values(states).flatMap(v => typeof v.file === "string" ? [v.file] : []),
  ]
}

function walk(dir: string, base = dir): string[] {
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true }).flatMap(item => {
    const abs = join(dir, item.name)
    if (item.isDirectory()) return walk(abs, base)
    if (!item.isFile()) return []
    return [posix(relative(base, abs))]
  }).sort()
}

function artifactFiles(site: string, name: string) {
  const keep = [`eikons/${name}/`, `packages/liftaris/${name}/`]
  return walk(site)
    .filter(path => path === "eikons/index.json" || keep.some(prefix => path.startsWith(prefix)))
    .map(path => ({ path, dest: path, abs: join(site, path), bytes: statSync(join(site, path)).size }))
}

function bundleBytes(files: BundleFile[], opts: BundleOpts) {
  const bytes = files.reduce((n, f) => n + f.bytes, 0)
  const max = opts.maxBytes ?? DEFAULT_MAX_BUNDLE_BYTES
  if (bytes > max) throw new Error(`submission bundle too large: ${bytes} > ${max} bytes`)
}

function catalog(site: string, name: string): PublicCatalogEntry {
  const entries = JSON.parse(readFileSync(join(site, "eikons/index.json"), "utf8")) as CatalogEntry[]
  const entry = entries.find(e => e.name === name)
  if (entry) return { ...normalizeCatalogEntry(entry), w: 0, h: 0, width: 0, height: 0, identityKey: entry.sourceKey || entry.id, raw: entry, trust: entry.trust ?? {}, poster: entry.poster ?? "" }
  return catalogEntry({ name }, "https://eikon.liftaris.dev/eikons/", { allowPrivate: true })
}

function mergeIndex(site: string, name: string) {
  const file = join(site, "eikons/index.json")
  const next = JSON.parse(readFileSync(file, "utf8")) as CatalogEntry[]
  const base = join(import.meta.dir, "..", "eikons", "index.json")
  const prior = existsSync(base) ? JSON.parse(readFileSync(base, "utf8")) as CatalogEntry[] : []
  const merged = [...prior.filter(e => e.name !== name), ...next].sort((a, b) => a.name.localeCompare(b.name))
  writeFileSync(file, JSON.stringify(merged, null, 2) + "\n")
}

export async function previewSubmitBundle(opts: BundleOpts): Promise<SubmitBundle> {
  const input = resolve(opts.path)
  const source = dirname(input)
  let eikon
  let text
  try {
    text = decodeRuntimeFile(input)
    eikon = lint(text)
  } catch (err) {
    throw new Error(`invalid eikon: ${err instanceof Error ? err.message : String(err)}`)
  }
  const name = eikon.meta.name
  const site = mkdtempSync(join(tmpdir(), "eikon-submit-"))
  const root = join(site, "eikons", name)
  mkdirSync(root, { recursive: true })
  const runtime = text.trimStart().startsWith('{"type":"header"') || text.trimStart().startsWith('{"type":"header",')
    ? text
    : (await import("./stream/legacy")).migrateLegacyEikon(text, { id: `liftaris/${name}`, entrypoint: `${name}.eikon`, version: "1.0.0" }).stream
  await Bun.write(join(root, `${name}.eikon`), encodeRuntimeText(runtime, { encoding: "gzip" }))
  const mf = join(source, "manifest.json")
  if (existsSync(mf)) {
    copyFileSync(mf, join(root, "manifest.json"))
    for (const rel of refs(readFileSync(mf, "utf8"))) copy(source, rel, root, opts)
  }
  for (const rel of opts.extraFiles ?? []) copy(source, rel, root, opts)
  registryManifest({ root: join(site, "eikons"), encoding: "gzip" })
  await registryIndex({ root: join(site, "eikons") })
  mergeIndex(site, name)
  const manifest = lintManifest(join(root, "manifest.json"), readFileSync(join(root, "manifest.json"), "utf8"))
  const files = artifactFiles(site, name)
  bundleBytes(files, opts)
  return {
    root: site,
    packed: join(root, `${name}.eikon`),
    files,
    meta: lint(decodeRuntimeFile(join(root, `${name}.eikon`))).meta,
    manifest,
    catalog: catalog(site, name),
    lint: [
      `✓ runtime ${name}.eikon`,
      `✓ package manifest ${manifest.entrypoints.default}`,
      "✓ registry index eikons/index.json",
    ],
  }
}

export async function submit(opts: SubmitOpts): Promise<SubmitResult> {
  let bundle: SubmitBundle
  try { bundle = await previewSubmitBundle(opts) }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = /missing source|\.file: .* missing/.test(message) ? "missing-source" : "invalid-eikon"
    return { kind: "validation-failed", failures: [{ code, message }] }
  }
  const backend = opts.backend ?? githubSubmitBackend()
  const setup = await backend.check()
  if (!setup.ok) return { kind: "setup-needed", failures: [{ code: "missing-auth", message: redact(setup.reason) }] }
  const req = submission(bundle)
  try { return await backend.create(req) }
  catch (err) { return { kind: "backend-failed", failures: [{ code: "backend-failed", message: redact(err instanceof Error ? err.message : String(err)) }] } }
}

export function submission(bundle: SubmitBundle): SubmitRequest {
  const title = `eikons: submit ${bundle.meta.name}`
  const body = [
    `Submits \`${bundle.meta.name}\` by ${bundle.meta.author ?? "unknown"}.`,
    `${bundle.meta.width}×${bundle.meta.height}; ${bundle.files.length} bundled files.`,
    "",
    "Registry preflight:",
    ...bundle.lint,
    "",
    "Submission bundle:",
    ...bundle.files.map(f => `- ${f.dest} (${f.bytes} bytes)`),
  ].join("\n")
  return { bundle, title, body }
}

async function gh(args: string[], input?: string) {
  const p = Bun.spawn(["gh", ...args], { stdin: input ? new TextEncoder().encode(input) : undefined, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) throw new Error(`gh ${args[0]} failed: ${err.trim() || out.trim()}`)
  return out.trim()
}

async function existingSha(run: Gh, fork: string, branch: string, path: string) {
  try {
    const out = await run(["api", "-X", "GET", `repos/${fork}/contents/${path}`, "-f", `ref=${branch}`])
    const json = JSON.parse(out) as { sha?: unknown }
    return typeof json.sha === "string" ? json.sha : undefined
  } catch {
    return undefined
  }
}

export function githubSubmitBackend(repo = DEFAULT_SUBMIT_REPO, run: Gh = gh): SubmitBackend {
  return {
    async check() {
      try { await run(["api", "user", "-q", ".login"]); return { ok: true } }
      catch (err) { return { ok: false, reason: err instanceof Error ? err.message : String(err) } }
    },
    async create(req) {
      const name = req.bundle.meta.name
      const branch = `submit/${name}`
      await run(["repo", "fork", repo, "--clone=false"]).catch(() => "")
      const user = await run(["api", "user", "-q", ".login"])
      const fork = `${user}/${repo.split("/")[1]}`
      const main = await run(["api", `repos/${repo}/git/ref/heads/main`, "-q", ".object.sha"])
      await run(["api", "-X", "POST", `repos/${fork}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${main}`]).catch(() => "")
      for (const file of req.bundle.files) {
        const content = Buffer.from(await Bun.file(file.abs).arrayBuffer()).toString("base64")
        const sha = await existingSha(run, fork, branch, file.dest)
        await run(["api", "-X", "PUT", `repos/${fork}/contents/${file.dest}`, "--input", "-"], JSON.stringify({
          message: `eikons: submit ${name}`,
          branch,
          content,
          ...(sha ? { sha } : {}),
        }))
      }
      const url = await run(["pr", "create", "-R", repo, "-H", `${user}:${branch}`, "-B", "main", "-t", req.title, "-b", req.body])
      return { kind: "submitted", url, request: req }
    },
  }
}
