// @ts-nocheck
import { admin } from "../_shared/db.ts"
import { user } from "../_shared/auth.ts"
import { preflight } from "../_shared/cors.ts"
import { writeBad, writeJson } from "../_shared/responses.ts"

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void }

async function handle(req: Request) {
  const option = preflight(req, true)
  if (option) return option
  if (req.method !== "POST") return writeBad(req, "method not allowed", 405)
  try {
    const id = decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "")
    if (!id) return writeBad(req, "id required")
    const db = admin()
    const actor = await user(req)
    if (!actor) return writeBad(req, "authentication required", 401)
    await db.from("profiles").upsert({ id: actor.id, handle: `u-${actor.id.slice(0, 8)}`, display_name: actor.email ?? "Eikon user" }, { onConflict: "id" })
    const { data: pkg, error: perr } = await db.from("packages").select("id,canonical_id,source_key,visibility,delisted_at").eq("source_key", id).maybeSingle()
    const hit = pkg ?? (await db.from("packages").select("id,canonical_id,source_key,visibility,delisted_at").eq("canonical_id", id).maybeSingle()).data
    if (perr) throw perr
    if (!hit) return writeBad(req, "package not found", 404)
    if (hit.visibility !== "public" || hit.delisted_at) return writeBad(req, "package not public", 403)
    await db.rpc("ensure_package_stats", { pid: hit.id })
    const { data: existing } = await db.from("likes").select("package_id").eq("package_id", hit.id).eq("user_id", actor.id).maybeSingle()
    if (existing) {
      const { error } = await db.from("likes").delete().eq("package_id", hit.id).eq("user_id", actor.id)
      if (error) throw error
      const { data: stat } = await db.from("package_stats").select("like_count").eq("package_id", hit.id).single()
      const { error: uerr } = await db.from("package_stats").update({ like_count: Math.max((stat?.like_count ?? 1) - 1, 0), updated_at: new Date().toISOString() }).eq("package_id", hit.id)
      if (uerr) throw uerr
    } else {
      const { error } = await db.from("likes").insert({ package_id: hit.id, user_id: actor.id })
      if (error) throw error
      const { data: stat } = await db.from("package_stats").select("like_count").eq("package_id", hit.id).single()
      const { error: uerr } = await db.from("package_stats").update({ like_count: (stat?.like_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("package_id", hit.id)
      if (uerr) throw uerr
    }
    const { data, error } = await db.from("package_stats").select("download_count,like_count,share_count").eq("package_id", hit.id).single()
    if (error) throw error
    return writeJson(req, { kind: "eikon.platform", catalogId: hit.canonical_id, stats: { downloads: data.download_count, likes: data.like_count, shares: data.share_count } })
  } catch (err) {
    return writeBad(req, err instanceof Error ? err.message : JSON.stringify(err), 500)
  }
}

Deno.serve(handle)
