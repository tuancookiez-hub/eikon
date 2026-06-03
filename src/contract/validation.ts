import { EikonValidationError } from "./errors"
import type { ExtensionSet, ExtensionSupport } from "./shape"
import { LAUNCH_MAJOR_VERSION } from "./shape"

export function validateVersionCompatibility(version: string): void {
  const major = Number(version.split(".")[0])
  if (!Number.isFinite(major) || major !== LAUNCH_MAJOR_VERSION) {
    throw new EikonValidationError([{ code: "unsupported-version", path: "version", message: `unsupported Eikon version ${version}` }])
  }
}

export function validateExtensionCompatibility(extensions: ExtensionSet = {}, support: ExtensionSupport = {}): void {
  const known = new Set([...(support.optional ?? []), ...(support.required ?? [])])
  const problems = (extensions.required ?? [])
    .filter(ext => !known.has(ext))
    .map(ext => ({ code: "unknown-required-extension", path: "extensions.required", message: `unknown required Eikon extension ${ext}` }))
  if (problems.length) throw new EikonValidationError(problems)
}
