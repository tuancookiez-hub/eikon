// @ts-nocheck
declare const Deno: { env: { get(key: string): string | undefined } }

const readMethods = "GET, HEAD, OPTIONS"
const writeMethods = "GET, POST, DELETE, OPTIONS"
const writeOrigins = (Deno.env.get("EIKON_ALLOWED_ORIGINS") ?? "http://127.0.0.1:5173,http://localhost:5173,https://eikon.liftaris.dev")
  .split(",").map(s => s.trim()).filter(Boolean)

export function publicHeaders(extra: HeadersInit = {}) {
  return {
    "access-control-allow-origin": "*",
    "access-control-allow-methods": readMethods,
    "access-control-allow-headers": "content-type, range",
    "vary": "origin",
    ...extra,
  }
}

export function writeHeaders(req: Request, extra: HeadersInit = {}) {
  const origin = req.headers.get("origin") ?? ""
  const allowed = !origin || writeOrigins.includes(origin) ? origin : ""
  return {
    "access-control-allow-origin": allowed,
    "access-control-allow-methods": writeMethods,
    "access-control-allow-headers": "authorization, content-type",
    "vary": "origin",
    ...extra,
  }
}

export function preflight(req: Request, write = false) {
  if (req.method !== "OPTIONS") return undefined
  return new Response(null, { status: 204, headers: write ? writeHeaders(req) : publicHeaders() })
}
