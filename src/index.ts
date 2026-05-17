// Public export surface for consumers (herm, web player, etc.).
// Everything here is zero-dep beyond node/bun stdlib.

export { parse, poster, list, peek as header,
         type Eikon, type Clip, type Meta } from "./ui/eikon"
export { serialize, type Doc, type Header, type StateDecl, type Frame } from "./ui/format"
export { lint, lintManifest, NAME_RE, type Manifest } from "./ui/lint"
export { STATES, FORMAT_VERSION, DEFAULT_CATALOG, type State } from "./ui/spec"
export { resolve, install, peek, entries, dirty,
         type Resolved, type Installed, type Origin, type Sources, type Opts } from "./install"
