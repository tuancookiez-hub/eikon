// @ts-nocheck
import { admin } from "../_shared/db.ts"
import { preflight } from "../_shared/cors.ts"
import { artifact, bad, gone, json, notFound } from "../_shared/responses.ts"
import { CATALOG_KIND, CATALOG_SCHEMA_VERSION, safeDigest, safePart } from "../_shared/eikon_contract.ts"

declare const Deno: { env: { get(key: string): string | undefined }; serve(handler: (req: Request) => Response | Promise<Response>): void }

type CatalogRow = {
  package_id: string
  version_id: string
  canonical_id: string
  namespace: string
  name: string
  version: string
  source_key: string
  title?: string | null
  author?: string | null
  description?: string | null
  glyph?: string | null
  tags?: unknown
  poster?: string | null
  package_path: string
  package_index_path: string
  runtime_path: string
  trust: Record<string, unknown>
}

type MetaRow = {
  package_id: string
  catalog_id: string
  source_key: string
  origin_kind: string
  submit_pr_url?: string | null
  downloads: number
  likes: number
  shares: number
}

function base(req: Request) {
  const configured = Deno.env.get("EIKON_REGISTRY_PUBLIC_URL")
  if (configured) return configured.replace(/\/$/, "")
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host")
  const port = req.headers.get("x-forwarded-port")
  const proto = req.headers.get("x-forwarded-proto") ?? new URL(req.url).protocol.replace(/:$/, "")
  const root = host ? `${proto}://${host}${host.includes(":") || !port ? "" : `:${port}`}` : "http://127.0.0.1:55321"
  return `${root}/functions/v1/registry`
}
const url = (req: Request, path: string) => new URL(path.replace(/^\//, ""), `${base(req)}/`).toString()

function entry(req: Request, row: CatalogRow) {
  return {
    kind: CATALOG_KIND,
    schemaVersion: CATALOG_SCHEMA_VERSION,
    id: row.canonical_id,
    version: row.version,
    sourceKey: row.source_key,
    name: row.name,
    ...(row.title ? { title: row.title } : {}),
    ...(row.author ? { author: row.author } : {}),
    ...(row.description ? { description: row.description } : {}),
    ...(row.glyph ? { glyph: row.glyph } : {}),
    ...(Array.isArray(row.tags) ? { tags: row.tags } : {}),
    ...(row.poster ? { poster: row.poster } : {}),
    runtimeUrl: url(req, row.runtime_path),
    packageUrl: url(req, row.package_path),
    detailUrl: url(req, `gallery/${encodeURIComponent(row.source_key)}`),
    compatibility: { eikon: ">=1 <2", available: true },
    trust: row.trust,
  }
}

async function catalog(req: Request) {
  const db = admin()
  const { data, error } = await db.from("registry_catalog_entries").select("*").order("name")
  if (error) throw error
  return json((data as CatalogRow[]).map(row => entry(req, row)))
}

async function platform(req: Request) {
  const ids = new URL(req.url).searchParams.get("ids")?.split(",").map(x => x.trim()).filter(Boolean) ?? []
  if (!ids.length) return json([])
  const db = admin()
  const { data, error } = await db.from("registry_platform_metadata").select("*").in("source_key", ids)
  if (error) throw error
  return json((data as MetaRow[]).map(row => ({
    kind: "eikon.platform",
    catalogId: row.catalog_id,
    canonicalUrl: url(req, `gallery/${encodeURIComponent(row.source_key)}`),
    sourceUrl: row.submit_pr_url ?? undefined,
    stats: { downloads: row.downloads, likes: row.likes, shares: row.shares },
  })))
}

async function pkgIndex(ns: string, name: string) {
  const db = admin()
  const { data: pkg, error } = await db.from("packages").select("id,canonical_id,name,visibility,delisted_at").eq("namespace", ns).eq("name", name).maybeSingle()
  if (error) throw error
  if (!pkg) return notFound("package not found")
  if (pkg.delisted_at || pkg.visibility !== "public") return gone("package delisted")
  const { data: versions, error: verror } = await db.from("package_versions").select("version").eq("package_id", pkg.id).eq("status", "published").order("published_at")
  if (verror) throw verror
  return json({ kind: "eikon.package.index", id: pkg.canonical_id, name: pkg.name, versions: (versions ?? []).map(v => ({ version: v.version, manifest: `${v.version}.json` })) })
}

async function manifest(ns: string, name: string, version: string) {
  const db = admin()
  const { data: pkg, error } = await db.from("packages").select("id,visibility,delisted_at").eq("namespace", ns).eq("name", name).maybeSingle()
  if (error) throw error
  if (!pkg) return notFound("manifest not found")
  if (pkg.delisted_at || pkg.visibility !== "public") return gone("package delisted")
  const { data: ver, error: verror } = await db.from("package_versions").select("manifest,status").eq("package_id", pkg.id).eq("version", version).maybeSingle()
  if (verror) throw verror
  if (!ver || ver.status !== "published") return notFound("manifest not found")
  return json(ver.manifest)
}

async function blob(ns: string, name: string, digest: string) {
  const db = admin()
  const { data: pkg, error } = await db.from("packages").select("id,visibility,delisted_at").eq("namespace", ns).eq("name", name).maybeSingle()
  if (error) throw error
  if (!pkg) return notFound("artifact not found")
  if (pkg.delisted_at || pkg.visibility !== "public") return gone("package delisted")
  const { data, error: ferror } = await db.from("package_files").select("media_type,storage_bucket,storage_path,package_versions!inner(package_id,status)").eq("package_versions.package_id", pkg.id).eq("digest", `sha256:${digest}`).maybeSingle()
  if (ferror) throw ferror
  if (!data) return notFound("artifact not found")
  const ver = data.package_versions as unknown as { status: string }
  if (ver.status !== "published") return gone("package delisted")
  const { data: obj, error: oerror } = await db.storage.from(data.storage_bucket).download(data.storage_path)
  if (oerror) throw oerror
  return artifact(new Uint8Array(await obj.arrayBuffer()), data.media_type)
}

export async function handle(req: Request): Promise<Response> {
  const option = preflight(req)
  if (option) return option
  if (req.method !== "GET" && req.method !== "HEAD") return bad("method not allowed", 405)
  const path = new URL(req.url).pathname.split("/registry/").at(1)?.replace(/^\//, "") ?? ""
  const parts = path.split("/").filter(Boolean)
  try {
    if (path === "eikons/index.json" || path === "index.json") return await catalog(req)
    if (parts[0] === "platform") return await platform(req)
    if (parts[0] === "packages" && parts.length === 4 && parts[3] === "index.json") return await pkgIndex(safePart(parts[1]), safePart(parts[2]))
    if (parts[0] === "packages" && parts.length === 4 && parts[3]?.endsWith(".json")) return await manifest(safePart(parts[1]), safePart(parts[2]), parts[3].replace(/\.json$/, ""))
    if (parts[0] === "packages" && parts.length === 6 && parts[3] === "blobs" && parts[4] === "sha256") return await blob(safePart(parts[1]), safePart(parts[2]), safeDigest(parts[5]))
    return notFound()
  } catch (err) {
    return bad(err instanceof Error ? err.message : JSON.stringify(err), 500)
  }
}

Deno.serve(handle)
