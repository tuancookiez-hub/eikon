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
    const body = await req.json().catch(() => ({})) as { reason?: string }
    const db = admin()
    const actor = await user(req)
    if (!actor) return writeBad(req, "authentication required", 401)
    await db.from("profiles").upsert({ id: actor.id, handle: `u-${actor.id.slice(0, 8)}`, display_name: actor.email ?? "Eikon user" }, { onConflict: "id" })
    const { data: byKey, error: perr } = await db.from("packages").select("id,canonical_id,source_key,created_by,github_login_at_submit,github_user_id").eq("source_key", id).maybeSingle()
    const pkg = byKey ?? (await db.from("packages").select("id,canonical_id,source_key,created_by,github_login_at_submit,github_user_id").eq("canonical_id", id).maybeSingle()).data
    if (perr) throw perr
    if (!pkg) return writeBad(req, "package not found", 404)
    const ids = actor.identities ?? []
    const github = ids.find(x => x.provider === "github")?.identity_data ?? {}
    const ok = pkg.created_by === actor.id
      || github.user_name === pkg.github_login_at_submit
      || github.preferred_username === pkg.github_login_at_submit
      || github.sub === pkg.github_user_id
    if (!ok) return writeBad(req, "not authorized to delist package", 403)
    const now = new Date().toISOString()
    const { error } = await db.from("packages").update({ visibility: "delisted", delisted_at: now, delisted_by: actor.id }).eq("id", pkg.id)
    if (error) throw error
    const { error: audit } = await db.from("delist_audit").insert({ package_id: pkg.id, requested_by: actor.id, reason: body.reason ?? null })
    if (audit) throw audit
    return writeJson(req, { ok: true, id: pkg.source_key })
  } catch (err) {
    return writeBad(req, err instanceof Error ? err.message : JSON.stringify(err), 500)
  }
}

Deno.serve(handle)
