import { existsSync, readFileSync, writeFileSync, readdirSync } from "node:fs"
import { join, dirname } from "node:path"
import { DEFAULT_CATALOG } from "./ui/spec"
import { parse, poster } from "./ui/eikon"
import { migrateLegacyEikon } from "./stream/legacy"
import { normalizeCatalogEntry, validateCatalogEntry } from "./catalog"
import { PACKAGE_KIND, type EikonPackageManifest, type PackageSourceMedia } from "./contract/shape"

const root = () => {
  let d = import.meta.dir
  while (!existsSync(join(d, "eikons", "index.json")) && dirname(d) !== d) d = dirname(d)
  return join(d, "eikons")
}

export async function index(base = DEFAULT_CATALOG) {
  const dir = root()
  const out = []
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const path = join(dir, e.name, `${e.name}.eikon`)
    if (!existsSync(path)) continue
    const body = readFileSync(path, "utf8")
    const doc = parse(body)
    const src = existsSync(join(dir, e.name, "manifest.json")) ? `${e.name}/` : undefined
    const nl = body.indexOf("\n")
    const head = { ...JSON.parse(body.slice(0, nl)), source_url: `${base.replace(/\/?$/, "/")}${e.name}/` }
    writeFileSync(path, JSON.stringify(head) + body.slice(nl))
    const manifestPath = join(dir, e.name, "manifest.json")
    const entry = existsSync(manifestPath)
      ? {
          ...normalizeCatalogEntry({
            manifest: JSON.parse(readFileSync(manifestPath, "utf8")) as EikonPackageManifest,
            packageUrl: `${base.replace(/\/?$/, "/")}${e.name}/manifest.json`,
            sourceKey: `${base.replace(/\/?$/, "/")}${e.name}/`,
          }, base),
          poster: poster(doc),
        }
      : normalizeCatalogEntry({
          name: doc.meta.name,
          author: doc.meta.author,
          glyph: doc.meta.glyph,
          ...(src ? { source: src } : {}),
          ...(existsSync(join(dir, e.name, `${e.name}.eikonl`)) ? { preview_url: `${e.name}.eikonl` } : {}),
          poster: poster(doc),
        }, base)
    out.push(validateCatalogEntry(entry))
  }
  out.sort((a, b) => a.name.localeCompare(b.name))
  await Bun.write(join(dir, "index.json"), JSON.stringify(out, null, 2) + "\n")
  return out.length
}

export function manifest() {
  const dir = root()
  let n = 0
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (!e.isDirectory()) continue
    const d = join(dir, e.name)
    const packed = join(d, `${e.name}.eikon`)
    if (existsSync(packed)) {
      const old = join(d, "manifest.json")
      const prior = existsSync(old) ? JSON.parse(readFileSync(old, "utf8")) as Record<string, unknown> : {}
      const migrated = migrateLegacyEikon(readFileSync(packed, "utf8"), { id: e.name, entrypoint: `${e.name}.eikonl` })
      const source = sourceMedia(prior)
      const files = [...(migrated.manifest.files ?? []), ...sourceEntries(source).map(path => ({ path, role: "source" }))]
      const man: EikonPackageManifest = { ...migrated.manifest, id: `liftaris/${e.name}`, source, files }
      writeFileSync(join(d, `${e.name}.eikonl`), migrated.stream)
      writeFileSync(join(d, "manifest.json"), JSON.stringify(man, null, 2) + "\n")
      n++
    }
  }
  return n
}

function sourceMedia(man: Record<string, unknown>): PackageSourceMedia | undefined {
  if (man.kind === PACKAGE_KIND) return man.source as PackageSourceMedia | undefined
  const source: PackageSourceMedia = {}
  if (typeof man.source === "string") source.base = man.source
  const states = man.states && typeof man.states === "object" && !Array.isArray(man.states) ? man.states as Record<string, { file?: unknown }> : {}
  for (const [key, value] of Object.entries(states)) {
    if (typeof value.file !== "string") continue
    source.states ??= {}
    source.states[key] = { file: value.file }
  }
  return source.base || source.states ? source : undefined
}

function sourceEntries(source?: PackageSourceMedia): string[] {
  const states = Object.values(source?.states ?? {}).flatMap(value => {
    if (!value?.file) return []
    return [value.file]
  })
  return [...new Set([source?.base, ...states].filter((value): value is string => typeof value === "string"))]
}
