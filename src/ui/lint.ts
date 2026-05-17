import { parse, STATES, type Eikon, type State } from "./eikon"
import { existsSync } from "node:fs"
import { join, dirname, basename } from "node:path"
import type { Origin } from "../install"

export const NAME_RE = /^[a-z0-9-]{2,32}$/

/** Validate publish invariants. Returns parsed doc; throws with all errors joined. */
export function lint(raw: string): Eikon {
  const e = parse(raw)
  const errs: string[] = []
  if (!NAME_RE.test(e.meta.name)) errs.push(`name "${e.meta.name}" must match ${NAME_RE}`)
  if (!e.meta.author) errs.push("header.author required")
  if (!e.meta.glyph) errs.push("header.glyph required")
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
  const man = JSON.parse(raw) as Manifest
  const dir = dirname(path)
  const errs: string[] = []
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
