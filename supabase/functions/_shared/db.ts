// @ts-nocheck
import { createClient } from "npm:@supabase/supabase-js@2.108.2"

declare const Deno: { env: { get(key: string): string | undefined } }

export function admin() {
  const url = Deno.env.get("SUPABASE_URL") ?? Deno.env.get("API_URL")
  const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? Deno.env.get("SERVICE_ROLE_KEY")
  if (!url || !key) throw new Error("Supabase service credentials missing")
  return createClient(url, key, { auth: { persistSession: false } })
}
