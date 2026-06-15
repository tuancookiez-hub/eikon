import type { PlatformMetadata } from "../../contract/shape"
import { config, functionsUrl, type SupabaseConfig } from "./client"

export type PlatformStats = PlatformMetadata & {
  likes?: number
  downloads?: number
  shares?: number
  liked?: boolean
  canManage?: boolean
}

type Fetcher = typeof fetch

async function json<T>(res: Response): Promise<T> {
  const text = await res.text()
  if (!res.ok) throw new Error(text || `supabase registry HTTP ${res.status}`)
  return (text ? JSON.parse(text) : undefined) as T
}

export async function metadata(ids: string[], opts: { cfg?: SupabaseConfig; fetcher?: Fetcher } = {}): Promise<PlatformStats[]> {
  const cfg = opts.cfg ?? config()
  if (!cfg || ids.length === 0) return []
  const url = new URL(functionsUrl(cfg, "registry", "/platform"))
  url.searchParams.set("ids", ids.join(","))
  return json<PlatformStats[]>(await (opts.fetcher ?? fetch)(url))
}

export async function event(id: string, kind: "download" | "share", opts: { cfg?: SupabaseConfig; fetcher?: Fetcher; source?: string } = {}) {
  const cfg = opts.cfg ?? config()
  if (!cfg) return undefined
  return json<PlatformStats>(await (opts.fetcher ?? fetch)(functionsUrl(cfg, "events", `/${kind}`), {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ id, source: opts.source ?? "web" }),
  }))
}

export async function like(id: string, token: string, opts: { cfg?: SupabaseConfig; fetcher?: Fetcher } = {}) {
  const cfg = opts.cfg ?? config()
  if (!cfg) throw new Error("Supabase registry is not configured")
  return json<PlatformStats>(await (opts.fetcher ?? fetch)(functionsUrl(cfg, "likes", `/${encodeURIComponent(id)}`), {
    method: "POST",
    headers: { authorization: `Bearer ${token}` },
  }))
}

export * as platform from "./platform"
