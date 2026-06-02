// Canonical constants — the one place herm, the CLI, and third-party
// consumers agree on format version + reserved state names.

import { CANONICAL_STATES, LAUNCH_FORMAT_VERSION } from "../contract/shape"

export const FORMAT_VERSION = 1
export const LAUNCH_VERSION = LAUNCH_FORMAT_VERSION

export const STATES = CANONICAL_STATES
export type State = typeof STATES[number]

export const DEFAULT_CATALOG = "https://eikon.liftaris.dev/eikons"
