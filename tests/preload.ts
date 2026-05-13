import { mkdtempSync } from "node:fs"
import { tmpdir } from "node:os"
import { join } from "node:path"

process.env.HERMES_HOME = mkdtempSync(join(tmpdir(), "eikon-test-"))

const err = console.error
console.error = (...a: unknown[]) => {
  if (typeof a[0] === "string" && a[0].includes("not wrapped in act")) return
  err(...a)
}
