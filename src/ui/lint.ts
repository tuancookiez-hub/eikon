import { parse, STATES, type Eikon } from "./eikon"
import { readFileSync, statSync } from "node:fs"
import { createHash } from "node:crypto"
import { join, dirname, basename } from "node:path"
import { isIP } from "node:net"
import { validatePackageManifest } from "../package/manifest"
import type { EikonPackageManifest } from "../contract/shape"

export const NAME_RE = /^[a-z0-9-]{2,32}$/
const PUBLIC_URL_FIELDS = ["source_url", "homepage_url", "repository_url"]
const CTRL = /[\u0000-\u001f\u007f-\u009f]/

/** Validate publish invariants. Returns parsed doc; throws with all errors joined. */
export function lint(raw: string): Eikon {
  const e = parse(raw)
  const errs: string[] = []
  if (!NAME_RE.test(e.meta.name)) errs.push(`name "${e.meta.name}" must match ${NAME_RE}`)
  if (!e.meta.author) errs.push("header.author required")
  if (e.meta.width < 8 || e.meta.height < 4) errs.push(`dims ${e.meta.width}×${e.meta.height} too small`)
  for (const s of STATES)
    if (!e.clips.get(s)?.frames.length) errs.push(`state "${s}" missing or empty`)
  if (errs.length) throw new Error(errs.join("\n  "))
  return e
}

export type Manifest = EikonPackageManifest

function sha(path: string): string {
  return `sha256:${createHash("sha256").update(readFileSync(path)).digest("hex")}`
}

/** Validate an eikons/<name>/manifest.json final package manifest. */
export function lintManifest(path: string, raw: string): Manifest {
  const man = validatePackageManifest(JSON.parse(raw), { registry: true })
  const dir = dirname(path)
  const errs: string[] = []
  if (basename(dir) !== man.name) errs.push(`name "${man.name}" ≠ folder "${basename(dir)}"`)
  for (const file of man.files ?? []) {
    const abs = join(dir, file.path)
    try {
      const st = statSync(abs)
      if (typeof file.size === "number" && st.size !== file.size) errs.push(`${file.path}: size mismatch`)
      if (file.digest && sha(abs) !== file.digest) errs.push(`${file.path}: digest mismatch`)
    } catch {
      errs.push(`${file.path}: missing`)
    }
  }
  if (errs.length) throw new Error(`${path}:\n  ${errs.join("\n  ")}`)
  return man
}

function privateIpv4(a: number, b: number): boolean {
  if (a === 10 || a === 127) return true
  if (a === 169 && b === 254) return true
  if (a === 192 && b === 168) return true
  return a === 172 && b >= 16 && b <= 31
}

function privateHost(host: string): boolean {
  const h = host.toLowerCase().replace(/^\[|\]$/g, "")
  if (!h || h === "::" || h === "localhost" || h.endsWith(".localhost")) return true
  const ipv4 = h.match(/^(\d+)\.(\d+)\./)
  if (ipv4 && privateIpv4(Number(ipv4[1]), Number(ipv4[2]))) return true
  if (h.startsWith("fe80:") || /^f[cd][0-9a-f]{2}:/.test(h)) return true
  const mapped = h.match(/^::ffff:(?:(\d+)\.(\d+)\.|([0-9a-f]{1,4}):([0-9a-f]{1,4}))/)
  if (mapped?.[1] && privateIpv4(Number(mapped[1]), Number(mapped[2]))) return true
  if (mapped?.[3] && mapped?.[4]) {
    const n = Number.parseInt(mapped[3], 16) * 0x10000 + Number.parseInt(mapped[4], 16)
    return privateIpv4(Math.floor(n / 0x1000000), Math.floor(n / 0x10000) & 0xff)
  }
  return isIP(h) !== 0 && (h === "0.0.0.0" || h === "::1")
}

export function lintRegistry(raw: string): Eikon {
  const e = lint(raw)
  const errs: string[] = []
  for (const [key, value] of Object.entries(e.meta)) {
    if (typeof value === "string" && CTRL.test(value)) errs.push("metadata contains control characters")
    if (PUBLIC_URL_FIELDS.includes(key) && typeof value === "string") {
      let url: URL
      try { url = new URL(value) }
      catch { errs.push(`${key}: public http(s) URL required`); continue }
      if (!["http:", "https:"].includes(url.protocol) || privateHost(url.hostname)) errs.push(`${key}: public host required`)
    }
  }
  if (errs.length) throw new Error(errs.join("\n  "))
  return e
}
