// @ts-nocheck
import { admin } from "../_shared/db.ts"
import { preflight } from "../_shared/cors.ts"
import { writeBad, writeJson } from "../_shared/responses.ts"

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void }

async function pkg(id: string) {
  const db = admin()
  const { data, error } = await db.from("packages").select("id,canonical_id,source_key,visibility,delisted_at").eq("source_key", id).maybeSingle()
  const hit = data ?? (await db.from("packages").select("id,canonical_id,source_key,visibility,delisted_at").eq("canonical_id", id).maybeSingle()).data
  if (error) throw error
  if (!hit) throw new Error("package not found")
  if (hit.visibility !== "public" || hit.delisted_at) throw new Error("package not public")
  return hit
}

async function handle(req: Request) {
  const option = preflight(req, true)
  if (option) return option
  if (req.method !== "POST") return writeBad(req, "method not allowed", 405)
  try {
    const kind = new URL(req.url).pathname.split("/").pop()
    if (kind !== "download" && kind !== "share") return writeBad(req, "unsupported event", 404)
    const body = await req.json().catch(() => ({})) as { id?: string; source?: string; rateKey?: string }
    if (!body.id) return writeBad(req, "id required")
    const item = await pkg(body.id)
    const db = admin()
    const { data, error } = await db.rpc("record_platform_event", { pid: item.id, kind, event_source: body.source ?? "web", event_rate_key: body.rateKey ?? null })
    if (error) throw error
    return writeJson(req, { kind: "eikon.platform", catalogId: item.canonical_id, stats: { downloads: data.download_count, likes: data.like_count, shares: data.share_count } })
  } catch (err) {
    return writeBad(req, err instanceof Error ? err.message : JSON.stringify(err), 500)
  }
}

Deno.serve(handle)
