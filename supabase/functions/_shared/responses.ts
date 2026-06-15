import { publicHeaders } from "./cors.ts"

export function json(data: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(data, null, 2) + "\n", {
    ...init,
    headers: publicHeaders({
      "content-type": "application/json; charset=utf-8",
      "cache-control": "public, max-age=30, stale-while-revalidate=60",
      "x-content-type-options": "nosniff",
      ...(init.headers ?? {}),
    }),
  })
}

export function notFound(message = "not found") {
  return json({ error: message }, { status: 404, headers: { "cache-control": "no-store" } })
}

export function gone(message = "gone") {
  return json({ error: message }, { status: 410, headers: { "cache-control": "no-store" } })
}

export function bad(message: string, status = 400) {
  return json({ error: message }, { status, headers: { "cache-control": "no-store" } })
}

export function artifact(bytes: Uint8Array, media: string, immutable = true) {
  return new Response(bytes, {
    headers: publicHeaders({
      "content-type": media,
      "content-length": String(bytes.length),
      "cache-control": immutable ? "public, max-age=31536000, immutable" : "no-store",
      "x-content-type-options": "nosniff",
      "content-disposition": media === "application/vnd.eikon.stream+jsonl" ? "inline" : "attachment",
    }),
  })
}
