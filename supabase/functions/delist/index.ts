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
    const body = await req.json().catch(() => ({})) as { reason?: string }
    const db = admin()
    const actor = await user(req)
    if (!actor) return bad("authentication required", 401)
    await db.from("profiles").upsert({ id: actor.id, handle: `u-${actor.id.slice(0, 8)}`, display_name: actor.email ?? "Eikon user" }, { onConflict: "id" })
    const { data: pkg, error: perr } = await db.from("packages").select("id,canonical_id,source_key,created_by,github_login_at_submit,github_user_id").or(`source_key.eq.${id},canonical_id.eq.${id}`).maybeSingle()
    if (perr) throw perr
    if (!pkg) return bad("package not found", 404)
    const ids = actor.identities ?? []
    const github = ids.find(x => x.provider === "github")?.identity_data ?? {}
    const ok = pkg.created_by === actor.id
      || github.user_name === pkg.github_login_at_submit
      || github.preferred_username === pkg.github_login_at_submit
      || github.sub === pkg.github_user_id
    if (!ok) return bad("not authorized to delist package", 403)
    const now = new Date().toISOString()
    const { error } = await db.from("packages").update({ visibility: "delisted", delisted_at: now, delisted_by: actor.id }).eq("id", pkg.id)
    if (error) throw error
    const { error: audit } = await db.from("delist_audit").insert({ package_id: pkg.id, requested_by: actor.id, reason: body.reason ?? null })
    if (audit) throw audit
    return json({ ok: true, id: pkg.source_key })
  } catch (err) {
    return bad(err instanceof Error ? err.message : JSON.stringify(err), 500)
  }
}

Deno.serve(handle)
