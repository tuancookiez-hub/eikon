// Public export surface for consumers (herm, web player, etc.).
// Everything here is zero-dep beyond node/bun stdlib.

export { parse, poster, list, peek as header,
         type Eikon, type Clip, type Meta } from "./ui/eikon"
export { serialize, type Doc, type Header, type StateDecl, type Frame } from "./ui/format"
export { lint, lintManifest, NAME_RE, type Manifest } from "./ui/lint"
export { STATES, FORMAT_VERSION, DEFAULT_CATALOG, type State } from "./ui/spec"
export { CATALOG_VERSION, DEFAULT_PUBLIC_CATALOG, catalogEntry, entryFromMeta, loadCatalog, publicCatalogUrl, searchCatalog,
         type Catalog, type CatalogEntry, type CatalogIndexEntry, type CatalogOptions, type CatalogTrust } from "./catalog"
export { frameAt, frameIndex, playback, playbackFrame, stateClip, type Playback } from "./player/model"
export { fixedClock, manualClock, systemClock, type Clock } from "./player/clock"
export { resolve, install, peek, entries, dirty,
         type Resolved, type Installed, type Origin, type Sources, type Opts } from "./install"
