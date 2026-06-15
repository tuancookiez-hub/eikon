// @ts-nocheck
import { admin } from "../_shared/db.ts"
import { user } from "../_shared/auth.ts"
import { preflight } from "../_shared/cors.ts"
import { writeBad, writeJson } from "../_shared/responses.ts"
import { bytes, sha256 } from "../_shared/digest.ts"

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

type UploadFile = { path: string; bytes: number; content?: string }
type Finalize = { uploadId: string; files: UploadFile[] }

const nameRe = /^[a-z0-9][a-z0-9-]{1,63}$/
const safePath = (path: string) => path && !path.startsWith("/") && !path.includes("../") && !path.includes("\\")

async function actor(req: Request) {
  const out = await user(req)
  if (!out) throw new Error("authentication required")
  const db = admin()
  const meta = out.user_metadata ?? {}
  const handle = String(meta.user_name ?? meta.preferred_username ?? out.email?.split("@")[0] ?? out.id.slice(0, 8)).toLowerCase().replace(/[^a-z0-9_.-]/g, "-").slice(0, 63)
  await db.from("profiles").upsert({ id: out.id, handle: nameRe.test(handle) ? handle : `u-${out.id.slice(0, 8)}`, display_name: meta.full_name ?? out.email ?? "Eikon creator" }, { onConflict: "id" })
  return out
}

async function init(req: Request) {
  const u = await actor(req)
  const body = await req.json().catch(() => ({})) as { name?: string; files?: Array<{ path: string; bytes: number }> }
  const db = admin()
  const { data, error } = await db.from("upload_sessions").insert({
    user_id: u.id,
    status: "created",
    allowed_files: body.files ?? [],
    requested_manifest: { name: body.name ?? "unknown" },
  }).select("id").single()
  if (error) throw error
  return writeJson(req, { uploadId: data.id, accepted: true })
}

function find(files: UploadFile[], suffix: string) {
  return files.find(file => file.path.endsWith(suffix))
}

async function upload(db: ReturnType<typeof admin>, path: string, content: string, type: string, upsert = false) {
  const raw = bytes(content)
  const { error } = await db.storage.from("eikon-artifacts").upload(path, raw, { upsert, contentType: type })
  if (error) throw new Error(error.message)
  return raw
}

async function finalize(req: Request) {
  const u = await actor(req)
  const body = await req.json() as Finalize
  const db = admin()
  const { data: session, error: serr } = await db.from("upload_sessions").select("id,user_id,status,expires_at").eq("id", body.uploadId).single()
  if (serr) throw serr
  if (session.user_id !== u.id) throw new Error("upload session owner mismatch")
  if (session.status === "finalized") throw new Error("upload session already finalized")
  if (Date.parse(session.expires_at) < Date.now()) throw new Error("upload session expired")
  const manifestFile = body.files.find(file => /packages\/[^/]+\/[^/]+\/[^/]+\.json$/.test(file.path))
  if (!manifestFile?.content) throw new Error("package manifest file required")
  const manifest = JSON.parse(new TextDecoder().decode(bytes(manifestFile.content)))
  if (manifest.kind !== "eikon.package") throw new Error("eikon.package manifest required")
  const [namespace = "liftaris", name = manifest.name] = String(manifest.id ?? `liftaris/${manifest.name}`).split("/")
  if (!nameRe.test(namespace) || !nameRe.test(name)) throw new Error("unsafe package id")
  const version = String(manifest.version ?? "1.0.0")
  const sourceKey = `registry:eikon.liftaris.dev:${namespace}/${name}@${version}`
  const runtime = manifest.files?.find((file: { role?: string; path?: string }) => file.role === "runtime" && file.path === manifest.entrypoints.default)
  if (!runtime?.digest || typeof runtime.size !== "number") throw new Error("runtime descriptor missing digest or size")
  const existing = await db.from("packages").select("id,created_by,visibility,delisted_at,origin_kind").eq("source_key", sourceKey).maybeSingle()
  if (existing.error) throw existing.error
  if (existing.data && existing.data.created_by !== u.id) throw new Error("package already belongs to another creator")
  if (existing.data?.delisted_at || existing.data?.visibility === "delisted") throw new Error("package is delisted; relist requires maintainer action")
  if (existing.data?.origin_kind === "github-mirror") throw new Error("mirrored GitHub package cannot be overwritten by hosted upload")
  const pkg = existing.data ?? (await db.from("packages").insert({
    namespace, name, canonical_id: `${namespace}/${name}`, source_key: sourceKey, created_by: u.id, origin_kind: "supabase", visibility: "public",
  }).select("id").single()).data
  if (!pkg) throw new Error("package insert failed")
  const prior = await db.from("package_versions").select("manifest_digest,runtime_digest").eq("package_id", pkg.id).eq("version", version).maybeSingle()
  const manifestRaw = await upload(db, `packages/${namespace}/${name}/${version}.json`, manifestFile.content, "application/json", !prior.data)
  const digest = await sha256(manifestRaw)
  if (prior.data && (prior.data.manifest_digest !== digest || prior.data.runtime_digest !== runtime.digest)) throw new Error("package version already exists with different content")
  const ver = await db.from("package_versions").upsert({
    package_id: pkg.id,
    version,
    manifest,
    manifest_digest: digest,
    runtime_digest: runtime.digest,
    runtime_size: runtime.size,
    runtime_encoding: runtime.encoding,
    runtime_decoded_size: runtime.decodedSize,
    runtime_decoded_digest: runtime.decodedDigest,
    poster: null,
    published_by: u.id,
    status: "published",
  }, { onConflict: "package_id,version" }).select("id").single()
  if (ver.error) throw ver.error
  if (!prior.data) await db.from("package_files").delete().eq("version_id", ver.data.id)
  for (const desc of manifest.files ?? []) {
    if (!safePath(desc.path)) throw new Error(`unsafe descriptor path: ${desc.path}`)
    const source = body.files.find(file => file.path.endsWith(`/${desc.path}`) || file.path === desc.path)
    if (!source?.content) throw new Error(`missing uploaded descriptor file: ${desc.path}`)
    const raw = await upload(db, `packages/${namespace}/${name}/${desc.path}`, source.content, desc.mediaType, !prior.data)
    if (raw.length !== desc.size) throw new Error(`size mismatch: ${desc.path}`)
    if (await sha256(raw) !== desc.digest) throw new Error(`digest mismatch: ${desc.path}`)
    const row = await db.from("package_files").upsert({
      version_id: ver.data.id,
      path: desc.path,
      role: desc.role,
      media_type: desc.mediaType,
      storage_bucket: "eikon-artifacts",
      storage_path: `packages/${namespace}/${name}/${desc.path}`,
      digest: desc.digest,
      size: desc.size,
      encoding: desc.encoding,
      decoded_size: desc.decodedSize,
      decoded_digest: desc.decodedDigest,
      signal: desc.signal,
    }, { onConflict: "version_id,path" })
    if (row.error) throw row.error
  }
  await db.from("packages").update({ current_version_id: ver.data.id, visibility: "public" }).eq("id", pkg.id)
  await db.rpc("ensure_package_stats", { pid: pkg.id })
  await db.from("upload_sessions").update({ status: "finalized", finalized_at: new Date().toISOString() }).eq("id", session.id)
  return writeJson(req, { url: `${Deno.env.get("EIKON_REGISTRY_PUBLIC_URL") ?? "http://127.0.0.1:55321/functions/v1/registry"}/gallery/${encodeURIComponent(sourceKey)}`, id: sourceKey, name })
}

async function handle(req: Request) {
  const option = preflight(req, true)
  if (option) return option
  if (req.method !== "POST") return writeBad(req, "method not allowed", 405)
  try {
    const path = new URL(req.url).pathname
    if (path.endsWith("/init")) return await init(req)
    if (path.endsWith("/finalize")) return await finalize(req)
    return writeBad(req, "not found", 404)
  } catch (err) {
    return writeBad(req, err instanceof Error ? err.message : JSON.stringify(err), err instanceof Error && err.message.includes("authentication") ? 401 : 500)
  }
}

Deno.serve(handle)
