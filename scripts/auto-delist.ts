type PrFile = { filename: string; status: string }
type Pull = {
  number: number
  title: string
  user?: { login?: string } | null
  head: { sha: string; ref: string; repo?: { full_name?: string } | null }
  base: { ref: string }
}
type Submit = { number: number; user?: { login?: string } | null; title: string; head: { ref: string } }
type Tree = { tree?: Array<{ path?: string; type?: string; sha?: string }> }
type Content = { content?: string }

export type Plan = {
  name: string
  id: string
  actor: string
  submitter?: string
  files: PrFile[]
  baseFiles: string[]
  index: string
}

const token = process.env.GITHUB_TOKEN ?? ""
const repo = process.env.GITHUB_REPOSITORY ?? ""
const prn = Number(process.env.PR_NUMBER ?? process.env.GITHUB_EVENT_NUMBER ?? 0)
const api = "https://api.github.com"

function headers() {
  return {
    accept: "application/vnd.github+json",
    authorization: `Bearer ${token}`,
    "x-github-api-version": "2022-11-28",
  }
}

async function req<T>(path: string, init: RequestInit = {}): Promise<T> {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers(), ...(init.headers ?? {}) } })
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status} ${path}: ${text}`)
  return text ? JSON.parse(text) as T : undefined as T
}

async function pages<T>(path: string): Promise<T[]> {
  const out: T[] = []
  for (let page = 1; page < 11; page++) {
    const sep = path.includes("?") ? "&" : "?"
    const rows = await req<T[]>(`${path}${sep}per_page=100&page=${page}`)
    out.push(...rows)
    if (rows.length < 100) return out
  }
  return out
}

export function delistName(title: string) {
  return title.match(/^eikons: delist ([a-z0-9][a-z0-9-]{1,63})$/)?.[1]
}

function pkg(id: string, name: string) {
  const [ns = "liftaris", pkg = name] = id.split("/")
  return { ns, pkg }
}

function dirs(name: string, id: string) {
  const p = pkg(id, name)
  return [`eikons/${name}/`, `packages/${p.ns}/${p.pkg}/`]
}

function touches(name: string, id: string, path: string) {
  return dirs(name, id).some(dir => path.startsWith(dir))
}

export function validate(plan: Plan): string[] {
  const errs: string[] = []
  if (!plan.submitter) errs.push("No merged submission PR found")
  else if (plan.submitter !== plan.actor) errs.push(`Delist requester @${plan.actor} is not original submitter @${plan.submitter}`)
  const allowed = new Set(["eikons/index.json"])
  for (const file of plan.baseFiles) if (touches(plan.name, plan.id, file)) allowed.add(file)
  const map = new Map(plan.files.map(file => [file.filename, file.status]))
  for (const file of plan.files) {
    if (!allowed.has(file.filename)) errs.push(`Unexpected file in delist PR: ${file.filename}`)
    if (file.filename !== "eikons/index.json" && file.status !== "removed") errs.push(`${file.filename} must be removed`)
  }
  for (const file of plan.baseFiles.filter(file => touches(plan.name, plan.id, file))) {
    if (map.get(file) !== "removed") errs.push(`Missing removal for ${file}`)
  }
  if (map.get("eikons/index.json") !== "modified") errs.push("eikons/index.json must be updated")
  const index = JSON.parse(plan.index) as Array<{ name?: string; id?: string }>
  if (index.some(entry => entry.name === plan.name || entry.id === plan.id)) errs.push("eikons/index.json still contains the delisted eikon")
  return errs
}

async function mainBranch() {
  const ref = await req<{ object: { sha: string } }>(`/repos/${repo}/git/ref/heads/main`)
  const commit = await req<{ tree: { sha: string } }>(`/repos/${repo}/git/commits/${ref.object.sha}`)
  return commit.tree.sha
}

async function content(full: string, path: string, ref: string) {
  const raw = await req<Content>(`/repos/${full}/contents/${path}?ref=${encodeURIComponent(ref)}`)
  return Buffer.from((raw.content ?? "").replace(/\s/g, ""), "base64").toString("utf8")
}

async function submitter(name: string, id: string) {
  const q = encodeURIComponent(`repo:${repo} is:pr is:merged "eikons: submit ${name}"`)
  const hits = await req<{ items: Array<{ number: number }> }>(`/search/issues?q=${q}`)
  for (const hit of hits.items) {
    const pull = await req<Submit>(`/repos/${repo}/pulls/${hit.number}`)
    if (pull.title !== `eikons: submit ${name}` && pull.head.ref !== `submit/${name}`) continue
    const files = await pages<PrFile>(`/repos/${repo}/pulls/${hit.number}/files`)
    if (files.some(file => touches(name, id, file.filename))) return pull.user?.login
  }
  return undefined
}

async function run() {
  if (!token || !repo || !prn) throw new Error("GITHUB_TOKEN, GITHUB_REPOSITORY, and PR_NUMBER are required")
  const pull = await req<Pull>(`/repos/${repo}/pulls/${prn}`)
  const name = delistName(pull.title)
  if (!name) return console.log("not a delist PR")
  const manifest = JSON.parse(await content(repo, `eikons/${name}/manifest.json`, "main")) as { id?: string }
  const id = manifest.id ?? `liftaris/${name}`
  const baseFiles = (await req<Tree>(`/repos/${repo}/git/trees/${await mainBranch()}?recursive=1`)).tree?.flatMap(item => item.path && item.type === "blob" ? [item.path] : []) ?? []
  const headRepo = pull.head.repo?.full_name ?? repo
  const plan: Plan = {
    name,
    id,
    actor: pull.user?.login ?? "",
    submitter: await submitter(name, id),
    files: await pages<PrFile>(`/repos/${repo}/pulls/${pull.number}/files`),
    baseFiles,
    index: await content(headRepo, "eikons/index.json", pull.head.sha),
  }
  const errs = validate(plan)
  if (errs.length) throw new Error(errs.join("\n"))
  await req(`/repos/${repo}/pulls/${pull.number}/merge`, {
    method: "PUT",
    body: JSON.stringify({ merge_method: "squash", commit_title: `eikons: delist ${name}` }),
  })
  console.log(`merged delist for ${name}`)
}

if (import.meta.main) await run()
