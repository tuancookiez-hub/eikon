import type { CatalogEntry } from "../../browser"
import { loadCatalogEntries } from "../../browser"

export const defaultBase = new URLSearchParams(globalThis.location?.search ?? "").get("catalog") ?? "/eikons"

export function catalogOptions(base = defaultBase) {
  return {
    queryKey: ["catalog", base],
    queryFn: ({ signal }: { signal?: AbortSignal }) => loadCatalogEntries(base, (input, init) => fetch(input, { ...init, signal })),
  }
}

export function entryKey(entry: CatalogEntry) {
  return entry.sourceKey || entry.id || entry.name
}
