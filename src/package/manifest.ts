import { EikonValidationError } from "../contract/errors"
import {
  LAUNCH_MAJOR_VERSION,
  PACKAGE_KIND,
  PACKAGE_SCHEMA_VERSION,
  type EikonPackageManifest,
} from "../contract/shape"

const NAME_RE = /^[a-z0-9][a-z0-9-]{1,63}$/
const SAFE_PATH_RE = /^[a-zA-Z0-9._/-]+$/

const problem = (path: string, message: string) => ({ code: "manifest", path, message: `${path}: ${message}` })
const isObj = (value: unknown): value is Record<string, unknown> => !!value && typeof value === "object" && !Array.isArray(value)
const isSafeText = (value: string) => !/[<>\u0000-\u001f]/.test(value)

export function isSafeRelativePath(path: string): boolean {
  if (!path || path.startsWith("/") || path.startsWith("./") || path.includes("../") || path === "..") return false
  if (!SAFE_PATH_RE.test(path)) return false
  return !path.split("/").includes("..")
}

function supportsLaunch(range: string): boolean {
  const parts = [...range.matchAll(/(>=|>|<=|<|==|=)?\s*(\d+)(?:\.\d+)?/g)]
  if (!parts.length) return true
  return parts.every(([, op = "=", raw]) => {
    const n = Number(raw)
    if (op === ">=") return LAUNCH_MAJOR_VERSION >= n
    if (op === ">") return LAUNCH_MAJOR_VERSION > n
    if (op === "<=") return LAUNCH_MAJOR_VERSION <= n
    if (op === "<") return LAUNCH_MAJOR_VERSION < n
    return LAUNCH_MAJOR_VERSION === n
  })
}

export function validatePackageManifest(value: unknown): EikonPackageManifest {
  const errs = []
  if (!isObj(value)) throw new EikonValidationError([problem("manifest", "object required")])
  const man = value as EikonPackageManifest
  if (man.kind !== PACKAGE_KIND) errs.push(problem("kind", `must be ${PACKAGE_KIND}`))
  if (man.schemaVersion !== PACKAGE_SCHEMA_VERSION) errs.push(problem("schemaVersion", `must be ${PACKAGE_SCHEMA_VERSION}`))
  if (!NAME_RE.test(String(man.name ?? ""))) errs.push(problem("name", "safe package name required"))
  if (!man.id || typeof man.id !== "string" || !isSafeText(man.id)) errs.push(problem("id", "safe id required"))
  if (!isObj(man.compatibility) || typeof man.compatibility.eikon !== "string" || !supportsLaunch(man.compatibility.eikon)) errs.push(problem("compatibility.eikon", "must support launch major version 2"))
  if (!isObj(man.entrypoints) || typeof man.entrypoints.default !== "string" || !isSafeRelativePath(man.entrypoints.default)) errs.push(problem("entrypoints.default", "safe relative path required"))
  for (const [key, path] of Object.entries(man.entrypoints ?? {})) {
    if (typeof path !== "string" || !isSafeRelativePath(path)) errs.push(problem(`entrypoints.${key}`, "safe relative path required"))
  }
  for (const file of man.files ?? []) {
    if (!file || typeof file !== "object" || typeof file.path !== "string" || !isSafeRelativePath(file.path)) errs.push(problem("files.path", "safe relative path required"))
  }
  if (man.poster && !isSafeRelativePath(man.poster)) errs.push(problem("poster", "safe relative path required"))
  if (man.preview && !isSafeRelativePath(man.preview)) errs.push(problem("preview", "safe relative path required"))
  for (const [key, value] of Object.entries(man.display ?? {})) {
    if (typeof value === "string" && !isSafeText(value)) errs.push(problem(`display.${key}`, "unsafe text"))
    if (Array.isArray(value) && value.some(item => typeof item !== "string" || !isSafeText(item))) errs.push(problem(`display.${key}`, "unsafe text"))
  }
  for (const [key, mapping] of Object.entries(man.signals ?? {})) {
    if (!mapping || typeof mapping !== "object" || typeof mapping.fallback !== "string") errs.push(problem(`signals.${key}.fallback`, "fallback required"))
  }
  if (errs.length) throw new EikonValidationError(errs)
  return man
}
