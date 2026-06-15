import { createClient, type SupabaseClient } from "@supabase/supabase-js"
import type { Database } from "./database.types"

export type EikonSupabaseClient = SupabaseClient<Database>
export type SupabaseConfig = { url: string; publishableKey: string }

export function config(env: Record<string, string | undefined> = typeof import.meta !== "undefined" ? import.meta.env as Record<string, string | undefined> : process.env): SupabaseConfig | undefined {
  const url = env.VITE_SUPABASE_URL ?? env.EIKON_SUPABASE_URL
  const key = env.VITE_SUPABASE_PUBLISHABLE_KEY ?? env.VITE_SUPABASE_ANON_KEY ?? env.EIKON_SUPABASE_ANON_KEY
  if (!url || !key) return undefined
  return { url, publishableKey: key }
}

export function client(cfg = config()): EikonSupabaseClient | undefined {
  if (!cfg) return undefined
  return createClient<Database>(cfg.url, cfg.publishableKey, {
    auth: {
      autoRefreshToken: true,
      persistSession: typeof window !== "undefined",
      detectSessionInUrl: true,
    },
  })
}

export function functionsUrl(cfg: Pick<SupabaseConfig, "url">, name: string, path = "") {
  return `${cfg.url.replace(/\/$/, "")}/functions/v1/${name}${path.startsWith("/") ? path : `/${path}`}`
}

export * as supabaseRegistry from "./client"
