import { readFileSync } from "node:fs"

export type ChangedFile = { path: string; status: string }
export type Plan = { title?: string; baseIndex: string; index: string; files: ChangedFile[] }

type Entry = { id?: string; name?: string; packageUrl?: string; [key: string]: unknown }

function parseIndex(raw: string, label: string): Entry[] {
  const value = JSON.parse(raw) as unknown
  if (!Array.isArray(value)) throw new Error(`${label}: catalog index must be an array`)
  return value as Entry[]
}

function key(entry: Entry): string {
  return typeof entry.id === "string" && entry.id ? entry.id : String(entry.name ?? "")
}

function display(entry: Entry): string {
  return String(entry.name ?? entry.id ?? "<unknown>")
}

function isDelist(title?: string): boolean {
  return /^eikons:\s*delist\s+[a-z0-9-]+\s*$/i.test(title ?? "")
}

function packageParts(entry: Entry): { namespace: string; name: string } | undefined {
  const id = typeof entry.id === "string" ? entry.id : undefined
  const name = typeof entry.name === "string" ? entry.name : undefined
  if (id?.includes("/")) {
    const [namespace, pkg] = id.split("/", 2)
    if (namespace && pkg) return { namespace, name: pkg }
  }
  return name ? { namespace: "liftaris", name } : undefined
}

export function validate(plan: Plan): string[] {
  if (isDelist(plan.title)) return []

  const errors: string[] = []
  const base = parseIndex(plan.baseIndex, "base index")
  const current = parseIndex(plan.index, "current index")
  const currentKeys = new Set(current.map(key))
  const baseKeys = new Set(base.map(key))

  for (const entry of base) {
    if (!currentKeys.has(key(entry))) {
      errors.push(`Catalog index must not remove existing entry '${display(entry)}' in a submit PR; use the delist flow.`)
    }
  }

  const deleted = plan.files.filter(file => file.status.includes("D") || file.status.includes("R"))
  for (const file of deleted) {
    errors.push(`Submit PR must not delete registry files: ${file.path}`)
  }

  for (const entry of current) {
    if (baseKeys.has(key(entry))) continue
    const name = typeof entry.name === "string" ? entry.name : undefined
    const parts = packageParts(entry)
    if (!name || !parts) {
      errors.push(`New catalog entry '${display(entry)}' must have a safe name and package id.`)
      continue
    }
    const hasEikonFiles = plan.files.some(file => file.path.startsWith(`eikons/${name}/`))
    const hasPackageFiles = plan.files.some(file => file.path.startsWith(`packages/${parts.namespace}/${parts.name}/`))
    if (!hasEikonFiles) errors.push(`New catalog entry '${name}' must include eikons/${name}/ artifacts.`)
    if (!hasPackageFiles) errors.push(`New catalog entry '${name}' must include packages/${parts.namespace}/${parts.name}/ artifacts.`)
    if (typeof entry.packageUrl === "string" && !entry.packageUrl.includes(`/packages/${parts.namespace}/${parts.name}/`)) {
      errors.push(`New catalog entry '${name}' packageUrl must point at packages/${parts.namespace}/${parts.name}/.`)
    }
  }

  return errors
}

async function run(args: string[]): Promise<string> {
  const proc = Bun.spawn(args, { stdout: "pipe", stderr: "pipe" })
  const [code, stdout, stderr] = await Promise.all([
    proc.exited,
    new Response(proc.stdout).text(),
    new Response(proc.stderr).text(),
  ])
  if (code !== 0) throw new Error(stderr.trim() || stdout.trim() || `${args.join(" ")} failed`)
  return stdout
}

async function diffFiles(baseRef: string): Promise<ChangedFile[]> {
  const diff = await run(["git", "diff", "--name-status", `${baseRef}...HEAD`, "--", "eikons", "packages"])
  return diff.split(/\r?\n/).filter(Boolean).flatMap(line => {
    const [status, ...parts] = line.split(/\t+/)
    const path = parts.at(-1)
    return status && path ? [{ status, path }] : []
  })
}

async function statusFiles(): Promise<ChangedFile[]> {
  const status = await run(["git", "status", "--porcelain", "--", "eikons", "packages"])
  return status.split(/\r?\n/).filter(Boolean).flatMap(line => {
    const status = line.slice(0, 2).trim() || "M"
    const path = line.slice(3).trim()
    return path ? [{ status, path }] : []
  })
}

function mergeFiles(left: ChangedFile[], right: ChangedFile[]): ChangedFile[] {
  const files = new Map<string, ChangedFile>()
  for (const file of [...left, ...right]) files.set(file.path, file)
  return [...files.values()].sort((a, b) => a.path.localeCompare(b.path))
}

async function main() {
  const baseRef = process.argv[2] ?? "origin/main"
  const baseIndex = await run(["git", "show", `${baseRef}:eikons/index.json`])
  const currentIndex = readFileSync("eikons/index.json", "utf8")
  const diff = await diffFiles(baseRef)
  const dirty = await statusFiles()
  const files = mergeFiles(diff, dirty)
  const errors = validate({ title: process.env.PR_TITLE, baseIndex, index: currentIndex, files })

  if (errors.length || dirty.length) {
    for (const error of errors) console.error(`::error::${error}`)
    if (dirty.length) {
      console.error("::error::Generated registry artifacts are stale or uncommitted. Run `bun src/cli.tsx manifest --gzip`, `EIKON_REGISTRY=1 bun src/cli.tsx index`, `bun run verify:artifacts`, then commit all eikons/ and packages/ changes.")
      console.error("Changed registry files:")
      for (const file of dirty) console.error(`${file.status}\t${file.path}`)
    }
    process.exit(1)
  }

  console.log("✓ registry PR artifacts are fresh and non-destructive")
}

if (import.meta.main) await main()
