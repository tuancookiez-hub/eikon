export const CATALOG_KIND = "eikon.catalog.entry"
export const CATALOG_SCHEMA_VERSION = "1.0"
export const PACKAGE_KIND = "eikon.package"
export const LAUNCH_MEDIA_TYPE = "application/vnd.eikon.stream+jsonl"

const digest = /^[a-f0-9]{64}$/
const part = /^[a-z0-9][a-z0-9-]{1,63}$/

export function safePart(value: string | undefined): string {
  if (!value || !part.test(value)) throw new Error("unsafe package path")
  return value
}

export function safeDigest(value: string | undefined): string {
  if (!value || !digest.test(value)) throw new Error("unsafe digest")
  return value
}

export function media(path: string, fallback = "application/octet-stream") {
  const lower = path.toLowerCase()
  if (lower.endsWith(".json")) return "application/json; charset=utf-8"
  if (lower.endsWith(".eikon")) return LAUNCH_MEDIA_TYPE
  if (lower.endsWith(".png")) return "image/png"
  if (lower.endsWith(".jpg") || lower.endsWith(".jpeg")) return "image/jpeg"
  if (lower.endsWith(".mp4")) return "video/mp4"
  if (lower.endsWith(".webm")) return "video/webm"
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8"
  return fallback
}

export function shaHex(value: string) {
  return value.replace(/^sha256:/, "")
}
