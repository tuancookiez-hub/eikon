export {
  CANONICAL_SIGNALS,
  CANONICAL_STATES,
  CATALOG_KIND,
  CATALOG_SCHEMA_VERSION,
  LAUNCH_FORMAT_VERSION,
  LAUNCH_MAJOR_VERSION,
  LAUNCH_MEDIA_TYPE,
  LAUNCH_STREAM_EXTENSION,
  RUNTIME_ENCODINGS,
  PACKAGE_KIND,
  PACKAGE_SCHEMA_VERSION,
  assertLaunchCompatibility,
  canonicalSignal,
  defaultSignalMappings,
  validateLaunchCompatibility,
  type CatalogEntry,
  type CanonicalSignal,
  type CanonicalState,
  type EikonPackageManifest,
  type ExtensionName,
  type ExtensionSet,
  type LaunchClipRecord,
  type LaunchExtensionRecord,
  type LaunchFrameRecord,
  type LaunchHeaderRecord,
  type LaunchStreamRecord,
  type PackageFileDescriptor,
  type PlatformMetadata,
  type RuntimeEncoding,
  type SignalMapping,
  type SignalName,
} from "./contract/shape"

export { EikonCompatibilityError, EikonValidationError, type CompatibilityProblem, type ValidationProblem } from "./contract/errors"
export { validatePackageManifest, isSafeRelativePath } from "./package/manifest"
export {
  loadCatalog,
  loadCatalogEntries,
  loadRuntimeArtifact,
  normalizeCatalogEntry,
  publicCatalogUrl,
  searchCatalog,
  searchCatalogEntries,
  validateCatalogEntry,
  type Catalog,
  type CatalogIndexEntry,
  type CatalogInput,
  type CatalogOptions,
  type PublicCatalogEntry,
} from "./catalog"
export {
  parseLaunchStream,
  resolveSignal,
  serializeLaunchStream,
  type ParsedClip,
  type ParsedLaunchMeta,
  type ParsedLaunchStream,
  type ResolvedSignal,
} from "./stream/parse"
export { decodeRuntimeBytes, parseRuntimeBytes, sha256Bytes } from "./stream/runtime-browser"
export { DEFAULT_RUNTIME_MAX_BYTES, DEFAULT_RUNTIME_MAX_DECODED_BYTES, isGzipBytes, runtimeEncoding, type RuntimeDescriptor, type RuntimeOptions } from "./stream/runtime"

export type BrowserClip = import("./stream/parse").ParsedClip
export type BrowserEikon = Pick<import("./stream/parse").ParsedLaunchStream, "header" | "meta" | "clips">
