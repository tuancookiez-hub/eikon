import { existsSync, lstatSync, readFileSync } from "node:fs"
import { basename, dirname, join, relative, resolve, sep } from "node:path"
import { lint, lintManifest, type Manifest } from "./ui/lint"
import { poster } from "./ui/eikon"
import { catalogEntry, type CatalogEntry } from "./catalog"

export const DEFAULT_REVIEW_REPO = process.env.EIKON_REPO ?? "liftaris/eikon"
export const DEFAULT_MAX_BUNDLE_BYTES = 32 * 1024 * 1024

export type FailureCode = "invalid-eikon" | "missing-license" | "missing-provenance" | "missing-auth" | "missing-source" | "backend-failed"
export type ReviewFailure = { code: FailureCode; message: string }
export type BundleFile = { path: string; abs: string; bytes: number }
export type ReviewBundle = {
  root: string
  packed: string
  files: BundleFile[]
  meta: ReturnType<typeof lint>["meta"]
  manifest?: Manifest
  catalog: CatalogEntry
  license: string
  provenance: string
}
export type ReviewRequest = { bundle: ReviewBundle; title: string; body: string }
export type ReviewCreated = { kind: "review-created"; url: string; request: ReviewRequest }
export type ReviewBackend = {
  check: () => Promise<{ ok: true } | { ok: false; reason: string }>
  create: (req: ReviewRequest) => Promise<ReviewCreated>
}
export type SubmitResult = ReviewCreated
  | { kind: "validation-failed"; failures: ReviewFailure[] }
  | { kind: "setup-needed"; failures: ReviewFailure[] }
  | { kind: "backend-failed"; failures: ReviewFailure[] }

export type BundleOpts = {
  path: string
  license?: string
  provenance?: string
  extraFiles?: string[]
  allowHidden?: boolean
  allowSecrets?: boolean
  maxBytes?: number
}

export type SubmitOpts = BundleOpts & { backend?: ReviewBackend }

type Gh = (args: string[], input?: string) => Promise<string>

const SECRET = /(\.env($|\.)|\.pem$|\.key$|\.p12$|\.pfx$|id_rsa$|id_ed25519$|token|secret|credential|password)/i
const TOKEN = /(gh[pousr]_[A-Za-z0-9_]+|github_pat_[A-Za-z0-9_]+|Bearer\s+[A-Za-z0-9._~+/=-]+|token\s+[A-Za-z0-9._~+/=-]+)/gi
const hidden = (rel: string) => rel.split(/[\\/]/).some(p => p.startsWith("."))
const secret = (rel: string) => SECRET.test(rel)
const redact = (s: string) => s.replace(TOKEN, "[redacted]")
const posix = (s: string) => s.split(sep).join("/")

function contain(root: string, rel: string) {
  if (rel.startsWith("/") || /^[A-Za-z]:[\\/]/.test(rel) || rel.split(/[\\/]/).some(p => p === ".."))
    throw new Error(`review bundle path escape: ${rel}`)
  const abs = resolve(root, rel)
  const back = relative(root, abs)
  if (back.startsWith("..") || back === "" || resolve(root, back) !== abs) throw new Error(`review bundle path escape: ${rel}`)
  return { abs, rel: posix(back) }
}

function add(root: string, rel: string, out: Map<string, BundleFile>, opts: BundleOpts) {
  const path = contain(root, rel)
  if (!existsSync(path.abs)) throw new Error(`review bundle missing source: ${path.rel}`)
  if (!opts.allowHidden && hidden(path.rel)) return
  if (!opts.allowSecrets && secret(path.rel)) return
  const st = lstatSync(path.abs)
  if (st.isSymbolicLink()) throw new Error(`review bundle symlink unsupported: ${path.rel}`)
  if (!st.isFile()) return
  const bytes = st.size
  out.set(path.rel, { path: path.rel, abs: path.abs, bytes })
}

function bundleFiles(root: string, packed: string, man: Manifest | undefined, opts: BundleOpts) {
  const out = new Map<string, BundleFile>()
  add(root, basename(packed), out, opts)
  if (man) {
    add(root, "manifest.json", out, opts)
    if (man.source) add(root, man.source, out, opts)
    for (const [st, v] of Object.entries(man.states ?? {}))
      if (v?.file) add(root, v.file, out, opts)
      else throw new Error(`manifest states.${st}.file required`)
  }
  for (const rel of opts.extraFiles ?? []) add(root, rel, out, opts)
  const files = [...out.values()].sort((a, b) => a.path.localeCompare(b.path))
  const bytes = files.reduce((n, f) => n + f.bytes, 0)
  const max = opts.maxBytes ?? DEFAULT_MAX_BUNDLE_BYTES
  if (bytes > max) throw new Error(`review bundle too large: ${bytes} > ${max} bytes`)
  return files
}

export async function previewReviewBundle(opts: BundleOpts): Promise<ReviewBundle> {
  const packed = resolve(opts.path)
  const root = dirname(packed)
  let eikon
  try { eikon = lint(await Bun.file(packed).text()) }
  catch (err) { throw new Error(`invalid eikon: ${err instanceof Error ? err.message : String(err)}`) }
  const license = opts.license ?? (typeof eikon.meta.license === "string" ? eikon.meta.license : "")
  const provenance = opts.provenance ?? (typeof eikon.meta.provenance === "string" ? eikon.meta.provenance : "")
  const mf = join(root, "manifest.json")
  const manifest = existsSync(mf) ? lintManifest(mf, readFileSync(mf, "utf8")) : undefined
  const files = bundleFiles(root, packed, manifest, opts)
  const catalog = catalogEntry({
    name: eikon.meta.name,
    author: eikon.meta.author,
    glyph: eikon.meta.glyph,
    width: eikon.meta.width,
    height: eikon.meta.height,
    poster: poster(eikon),
    license,
    provenance,
    review_status: "pending",
    source: `${eikon.meta.name}/`,
    preview_url: `${eikon.meta.name}/${eikon.meta.name}.eikon`,
    install_url: manifest ? `${eikon.meta.name}/manifest.json` : `${eikon.meta.name}/${eikon.meta.name}.eikon`,
  }, "https://eikon.liftaris.dev/eikons/", { allowPrivate: true })
  return { root, packed, files, meta: eikon.meta, ...(manifest ? { manifest } : {}), catalog, license, provenance }
}

function failures(bundle: ReviewBundle) {
  const xs: ReviewFailure[] = []
  if (!bundle.license.trim()) xs.push({ code: "missing-license", message: "license required" })
  if (!bundle.provenance.trim()) xs.push({ code: "missing-provenance", message: "provenance required" })
  return xs
}

export async function submitForReview(opts: SubmitOpts): Promise<SubmitResult> {
  let bundle: ReviewBundle
  try { bundle = await previewReviewBundle(opts) }
  catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    const code = /missing source|\.file: .* missing/.test(message) ? "missing-source" : "invalid-eikon"
    return { kind: "validation-failed", failures: [{ code, message }] }
  }
  const bad = failures(bundle)
  if (bad.length) return { kind: "validation-failed", failures: bad }
  const backend = opts.backend ?? githubReviewBackend()
  const setup = await backend.check()
  if (!setup.ok) return { kind: "setup-needed", failures: [{ code: "missing-auth", message: redact(setup.reason) }] }
  const req = reviewRequest(bundle)
  try { return await backend.create(req) }
  catch (err) { return { kind: "backend-failed", failures: [{ code: "backend-failed", message: redact(err instanceof Error ? err.message : String(err)) }] } }
}

export function reviewRequest(bundle: ReviewBundle): ReviewRequest {
  const title = `eikons: submit ${bundle.meta.name} for review`
  const body = [
    `Submits \`${bundle.meta.name}\` by ${bundle.meta.author ?? "unknown"} for review.`,
    `${bundle.meta.width}×${bundle.meta.height}; ${bundle.files.length} bundled files.`,
    `License: ${bundle.license}`,
    `Provenance: ${bundle.provenance}`,
    "",
    "Review bundle:",
    ...bundle.files.map(f => `- ${f.path} (${f.bytes} bytes)`),
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

export function githubReviewBackend(repo = DEFAULT_REVIEW_REPO, run: Gh = gh): ReviewBackend {
  return {
    async check() {
      try { await run(["auth", "status"]); return { ok: true } }
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
        const dest = `eikons/${name}/${file.path}`
        const content = Buffer.from(await Bun.file(file.abs).arrayBuffer()).toString("base64")
        const sha = await existingSha(run, fork, branch, dest)
        const args = ["api", "-X", "PUT", `repos/${fork}/contents/${dest}`,
          "-f", `message=eikons: submit ${name} for review`, "-f", `branch=${branch}`, "-f", `content=${content}`]
        if (sha) args.push("-f", `sha=${sha}`)
        await run(args)
      }
      const url = await run(["pr", "create", "-R", repo, "-H", `${user}:${branch}`, "-B", "main", "-t", req.title, "-b", req.body])
      return { kind: "review-created", url, request: req }
    },
  }
}
