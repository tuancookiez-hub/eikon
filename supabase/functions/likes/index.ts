// @ts-nocheck
import { admin } from "../_shared/db.ts"
import { user } from "../_shared/auth.ts"
import { preflight } from "../_shared/cors.ts"
import { bad, json } from "../_shared/responses.ts"

declare const Deno: { serve(handler: (req: Request) => Response | Promise<Response>): void }

async function handle(req: Request) {
  const option = preflight(req, true)
  if (option) return option
  if (req.method !== "POST") return bad("method not allowed", 405)
  try {
    const id = decodeURIComponent(new URL(req.url).pathname.split("/").pop() ?? "")
    if (!id) return bad("id required")
    const db = admin()
    const actor = await user(req)
    if (!actor) return bad("authentication required", 401)
    await db.from("profiles").upsert({ id: actor.id, handle: `u-${actor.id.slice(0, 8)}`, display_name: actor.email ?? "Eikon user" }, { onConflict: "id" })
    const { data: pkg, error: perr } = await db.from("packages").select("id,canonical_id,source_key").or(`source_key.eq.${id},canonical_id.eq.${id}`).maybeSingle()
    if (perr) throw perr
    if (!pkg) return bad("package not found", 404)
    await db.rpc("ensure_package_stats", { pid: pkg.id })
    const { data: existing } = await db.from("likes").select("package_id").eq("package_id", pkg.id).eq("user_id", actor.id).maybeSingle()
    if (existing) {
      const { error } = await db.from("likes").delete().eq("package_id", pkg.id).eq("user_id", actor.id)
      if (error) throw error
      const { data: stat } = await db.from("package_stats").select("like_count").eq("package_id", pkg.id).single()
      const { error: uerr } = await db.from("package_stats").update({ like_count: Math.max((stat?.like_count ?? 1) - 1, 0), updated_at: new Date().toISOString() }).eq("package_id", pkg.id)
      if (uerr) throw uerr
    } else {
      const { error } = await db.from("likes").insert({ package_id: pkg.id, user_id: actor.id })
      if (error) throw error
      const { data: stat } = await db.from("package_stats").select("like_count").eq("package_id", pkg.id).single()
      const { error: uerr } = await db.from("package_stats").update({ like_count: (stat?.like_count ?? 0) + 1, updated_at: new Date().toISOString() }).eq("package_id", pkg.id)
      if (uerr) throw uerr
    }
    const { data, error } = await db.from("package_stats").select("download_count,like_count,share_count").eq("package_id", pkg.id).single()
    if (error) throw error
    return json({ kind: "eikon.platform", catalogId: pkg.canonical_id, stats: { downloads: data.download_count, likes: data.like_count, shares: data.share_count } })
  } catch (err) {
    return bad(err instanceof Error ? err.message : JSON.stringify(err), 500)
  }
}

Deno.serve(handle)
