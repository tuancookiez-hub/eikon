// Re-export from the consolidated source. Kept so `preview/` stays
// runnable as its own package during the transition.
export * from "../../src/ui/eikon"
export * from "../../src/ui/format"

// Legacy aliases — author.tsx / index.tsx / mk_eikon.ts still import these names.
export type { Doc as Eikon, StateDecl as EikonState, Frame as EikonFrame, Header as EikonHeader } from "../../src/ui/format"
export { serialize as serializeEikon } from "../../src/ui/format"
export { parse as parseEikon } from "../../src/ui/eikon"
