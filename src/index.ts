// Public export surface for consumers (herm, web player, etc.).
// Everything here is zero-dep beyond node/bun stdlib.

export { parse, poster, list, peek as header,
         type Eikon, type Clip, type Meta } from "./ui/eikon"
export { serialize, type Doc, type Header, type StateDecl, type Frame } from "./ui/format"
export { lint, lintManifest, NAME_RE, type Manifest } from "./ui/lint"
export { STATES, FORMAT_VERSION, LAUNCH_VERSION, DEFAULT_CATALOG, type State } from "./ui/spec"
export { resolve, install, peek, entries, dirty,
         type Resolved, type Installed, type Origin, type Sources, type Opts } from "./install"
export { EikonCompatibilityError, EikonValidationError, type CompatibilityProblem, type ValidationProblem } from "./contract/errors"
export {
  assertLaunchCompatibility,
  canonicalSignal,
  defaultSignalMappings,
  isCanonicalState,
  validateLaunchCompatibility,
  CANONICAL_STATES,
  CATALOG_KIND,
  CATALOG_SCHEMA_VERSION,
  LAUNCH_FORMAT_VERSION,
  LAUNCH_MAJOR_VERSION,
  LAUNCH_MEDIA_TYPE,
  LAUNCH_STREAM_EXTENSION,
  PACKAGE_KIND,
  PACKAGE_SCHEMA_VERSION,
  type CatalogEntry,
  type CanonicalState,
  type ClipName,
  type EikonPackageManifest,
  type ExtensionName,
  type ExtensionSet,
  type ExtensionSupport,
  type LaunchClipRecord,
  type LaunchFrameRecord,
  type LaunchHeaderRecord,
  type LaunchStreamDocument,
  type LaunchStreamRecord,
  type PackageFileDescriptor,
  type PackageSourceMedia,
  type PlatformMetadata,
  type SignalMapping,
  type SignalName,
  type TriggerRule,
} from "./contract/shape"
export { validateVersionCompatibility, validateExtensionCompatibility } from "./contract/validation"
export { parseLaunchStream, serializeLaunchStream, legacyToLaunchStream, migrateLegacyEikon,
         type ParsedLaunchStream, type LegacyMigration, type MigratedEikon } from "./stream"
export { validatePackageManifest, isSafeRelativePath } from "./package"
export { loadCatalogEntries, normalizeCatalogEntry, searchCatalogEntries, validateCatalogEntry,
         CATALOG_VERSION, DEFAULT_PUBLIC_CATALOG, catalogEntry, loadCatalog, publicCatalogUrl, searchCatalog,
         type Catalog, type CatalogInput, type CatalogIndexEntry, type CatalogOptions, type CatalogTrust, type PublicCatalogEntry } from "./catalog"
export { previewReviewBundle, reviewRequest, submitForReview, githubReviewBackend,
         type BundleFile, type BundleOpts, type ReviewBackend, type ReviewBundle, type ReviewFailure, type ReviewRequest, type SubmitResult } from "./publish"
