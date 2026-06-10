export const SOURCE_KINDS = ["catalog", "package-url", "github", "local", "registry"] as const
export type EikonSourceKind = typeof SOURCE_KINDS[number]

export const INSTALL_SCOPES = ["profile", "temporary", "project-reserved"] as const
export type InstallScope = typeof INSTALL_SCOPES[number]

export type ParsedSource =
  | { kind: "catalog"; spec: string; sourceKey: string; name?: string; catalogUrl?: string }
  | { kind: "package-url"; spec: string; sourceKey: string; url: string }
  | { kind: "github"; spec: string; sourceKey: string; owner: string; repo: string; ref?: string; selector?: string }
  | { kind: "local"; spec: string; sourceKey: string; path: string }
  | { kind: "registry"; spec: string; sourceKey: string; name: string; range?: string; supported: false }

const clean = (value: string) => value.trim()
const safe = (value: string) => /^[A-Za-z0-9._~:/?#[\]@!$&'()*+,;=%-]+$/.test(value) && !/[\u0000-\u001f\u007f\\]/.test(value)
const esc = (value: string) => value.replace(/[#?].*$/, "").split("/").some(part => part === "..")
const key = (kind: string, value: string) => `${kind}:${value}`

function http(raw: string): string | undefined {
  try {
    const rawPath = raw.split(/[?#]/, 1)[0] ?? raw
    const url = new URL(raw)
    if (url.protocol !== "http:" && url.protocol !== "https:") return undefined
    if (!safe(raw) || esc(rawPath) || esc(url.pathname)) throw new Error(`unsafe source URL: ${raw}`)
    return url.href
  } catch (err) {
    if (err instanceof Error && err.message.startsWith("unsafe")) throw err
    return undefined
  }
}

function github(raw: string): ParsedSource | undefined {
  const spec = raw.replace(/^github:/, "")
  const input = spec
    .replace(/^https:\/\/github\.com\//, "")
    .replace(/^git@github\.com:/, "")
    .replace(/^github\.com\//, "")
  if (input === spec && !raw.startsWith("github:")) return undefined
  const [path, query = ""] = input.split("?")
  const [head, hash] = path!.split("#")
  const parts = head!.replace(/\.git$/, "").split("/").filter(Boolean)
  if (parts.length < 2) return undefined
  const owner = parts[0]!
  const repo = parts[1]!.replace(/\.git$/, "")
  const pathSelector = parts.slice(2).join("/") || undefined
  const params = new URLSearchParams(query)
  const ref = hash ? decodeURIComponent(hash) : undefined
  const selector = params.get("selector") ? decodeURIComponent(params.get("selector")!) : pathSelector
  for (const part of [owner, repo, ref, selector].filter(Boolean) as string[])
    if (!/^[A-Za-z0-9._/-]+$/.test(part) || part.split("/").some(x => !x || x === "." || x === ".." || x.startsWith("-"))) throw new Error(`unsafe GitHub source: ${raw}`)
  const suffix = `${owner}/${repo}${ref ? `#${ref}` : ""}${selector ? `?selector=${selector}` : ""}`
  return { kind: "github", spec: raw, sourceKey: key("github", suffix), owner, repo, ...(ref ? { ref } : {}), ...(selector ? { selector } : {}) }
}

export function parseSourceSpec(raw: string): ParsedSource {
  const spec = clean(raw)
  if (!spec) throw new Error("source spec required")
  if (!safe(spec)) throw new Error(`unsafe source spec: ${spec}`)
  if (/^(npm|registry):/.test(spec)) {
    const body = spec.replace(/^(npm|registry):/, "")
    const at = body.startsWith("@") ? body.indexOf("@", 1) : body.lastIndexOf("@")
    const name = at > 0 ? body.slice(0, at) : body
    const range = at > 0 ? body.slice(at + 1) : undefined
    if (!name) throw new Error(`registry source name required: ${spec}`)
    return { kind: "registry", spec, sourceKey: key("registry", body), name, ...(range ? { range } : {}), supported: false }
  }
  if (spec.startsWith("catalog+")) {
    const [url, name] = spec.slice("catalog+".length).split("#")
    const catalogUrl = http(url!) ?? (() => { throw new Error(`catalog URL must be http(s): ${spec}`) })()
    return { kind: "catalog", spec, sourceKey: key("catalog", `${catalogUrl}#${name ?? ""}`), catalogUrl, ...(name ? { name } : {}) }
  }
  if (spec.startsWith("catalog:")) {
    const name = spec.slice("catalog:".length)
    if (!name) throw new Error("catalog source name required")
    return { kind: "catalog", spec, sourceKey: key("catalog", name), name }
  }
  if (spec.startsWith("pkg:")) {
    const url = http(spec.slice(4)) ?? (() => { throw new Error(`package URL must be http(s): ${spec}`) })()
    return { kind: "package-url", spec, sourceKey: key("package", url), url }
  }
  const gh = github(spec)
  if (gh) return gh
  const url = http(spec)
  if (url) return { kind: "package-url", spec, sourceKey: key("package", url), url }
  if (spec.startsWith("file://") || spec.startsWith("/") || spec.startsWith("./") || spec.startsWith("../")) return { kind: "local", spec, sourceKey: key("local", spec), path: spec.replace(/^file:\/\//, "") }
  if (!/[/:]/.test(spec)) return { kind: "catalog", spec, sourceKey: key("catalog", spec), name: spec }
  throw new Error(`unsupported source spec: ${spec}`)
}

export function assertWritableScope(scope: InstallScope = "profile"): Exclude<InstallScope, "project-reserved"> {
  if (scope === "project-reserved") throw new Error("project-reserved Eikon scope is deferred until project trust policy exists")
  return scope
}

export function sourceIdentity(spec: string): string {
  return parseSourceSpec(spec).sourceKey
}
