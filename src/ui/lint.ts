import { parse, STATES, type Eikon } from "./eikon"

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
