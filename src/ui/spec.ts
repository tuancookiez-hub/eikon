// Canonical constants — the one place herm, the CLI, and third-party
// consumers agree on format version + reserved state names.

export const FORMAT_VERSION = 1

export const STATES = ["idle", "listening", "thinking", "speaking", "working", "error"] as const
export type State = typeof STATES[number]

export const DEFAULT_CATALOG = "https://raw.githubusercontent.com/liftaris/eikon/main/eikons"
