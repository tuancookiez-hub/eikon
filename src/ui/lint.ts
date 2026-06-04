import { parse, STATES, type Eikon, type State } from "./eikon"
import { existsSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import { isIP } from "node:net"
import type { Origin } from "../install"

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

export type Manifest = {
  name: string
  version: number
  eikon_requires?: string
  source?: string
  states: Partial<Record<State, { file: string }>>
  origin?: Origin
}

/** Validate an eikons/<name>/manifest.json: schema + referenced files
 *  exist relative to its directory + name matches its folder. */
export function lintManifest(path: string, raw: string): Manifest {
  const man = JSON.parse(raw) as Manifest & Record<string, unknown>
  const dir = dirname(path)
  const errs: string[] = []
  if ("license" in man || "provenance" in man) errs.push("manifest must not contain license or provenance")
  if (!NAME_RE.test(man.name)) errs.push(`name "${man.name}" must match ${NAME_RE}`)
  if (basename(dir) !== man.name) errs.push(`name "${man.name}" ≠ folder "${basename(dir)}"`)
  if (man.source && !existsSync(join(dir, man.source))) errs.push(`source: ${man.source} missing`)
  if (!man.states || typeof man.states !== "object") errs.push("states: object required")
  else for (const [st, v] of Object.entries(man.states)) {
    if (!STATES.includes(st as never)) errs.push(`states.${st}: unknown state`)
    else if (!v?.file) errs.push(`states.${st}.file required`)
    else if (!existsSync(join(dir, v.file))) errs.push(`states.${st}.file: ${v.file} missing`)
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
