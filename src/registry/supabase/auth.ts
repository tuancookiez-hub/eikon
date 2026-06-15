import { config, functionsUrl, type SupabaseConfig } from "./client"

export type DelistResult = { ok: true; id: string } | { ok: false; reason: string }

type Fetcher = typeof fetch

async function json<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) throw new Error(text || `supabase delist HTTP ${res.status}`)
  return (text ? JSON.parse(text) : undefined) as T
}

export async function delist(id: string, token: string, opts: { cfg?: SupabaseConfig; fetcher?: Fetcher; reason?: string } = {}) {
  const cfg = opts.cfg ?? config()
  if (!cfg) throw new Error("Supabase registry is not configured")
  return json<DelistResult>(await (opts.fetcher ?? fetch)(functionsUrl(cfg, "delist", `/${encodeURIComponent(id)}`), {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify({ reason: opts.reason ?? "" }),
  }))
}

export * as auth from "./auth"
