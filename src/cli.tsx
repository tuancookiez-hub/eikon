#!/usr/bin/env bun
// eikon CLI — install/pack/lint/show/publish/browse + registry maint.

import { resolve, basename, join } from "node:path"
import { homedir } from "node:os"
import { existsSync, readFileSync } from "node:fs"
import { parse, poster } from "./ui/eikon"
import { lint, lintManifest, type Manifest } from "./ui/lint"
import { install, dirty, type Origin } from "./install"
import { pack } from "./pack"
import * as reg from "./registry"
import { Browser } from "./browse/Browser"
import { local, resolve as cat } from "./browse/catalog"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

const REPO = process.env.EIKON_REPO ?? "liftaris/eikon"
const root = () => join(process.env.HERMES_HOME ?? join(homedir(), ".hermes"), "eikons")
const mb = (n: number) => n < 1 << 20 ? `${(n / 1024).toFixed(0)} KB` : `${(n / (1 << 20)).toFixed(1)} MB`

const die = (msg: string): never => { console.error(`eikon: ${msg}`); process.exit(1) }

function args(argv: string[]) {
  const pos: string[] = [], kv: Record<string, string | true> = {}
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i]!
    if (!a.startsWith("--")) { pos.push(a); continue }
    const next = argv[i + 1]
    kv[a.slice(2)] = next && !next.startsWith("--") ? (i++, next) : true
  }
  return { pos, kv, str: (k: string) => typeof kv[k] === "string" ? kv[k] as string : undefined }
}

async function gh(args: string[], input?: string) {
  const p = Bun.spawn(["gh", ...args], { stdin: input ? new TextEncoder().encode(input) : undefined, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) die(`gh ${args[0]} failed: ${err.trim() || out.trim()}`)
  return out.trim()
}

const cmds: Record<string, (argv: string[]) => Promise<void>> = {
  async lint(argv) {
    const path = argv[0] ?? die("usage: eikon lint <file.eikon|manifest.json>")
    const raw = await Bun.file(resolve(path)).text()
    if (basename(path) === "manifest.json") {
      const m = lintManifest(resolve(path), raw)
      console.log(`✓ ${m.name} · ${Object.keys(m.states).length} states${m.source ? ` · ${m.source}` : ""}`)
      return
    }
    const e = lint(raw)
    console.log(`✓ ${e.meta.name} · ${e.meta.width}×${e.meta.height} · ${e.clips.size} states`)
  },

  async publish(argv) {
    const path = argv[0] ?? die("usage: eikon publish <file>")
    const raw = await Bun.file(resolve(path)).text()
    const e = lint(raw)
    const name = e.meta.name
    const branch = `add/${name}`

    await gh(["repo", "fork", REPO, "--clone=false"]).catch(() => {})
    const user = await gh(["api", "user", "-q", ".login"])
    const fork = `${user}/${REPO.split("/")[1]}`

    // Create branch ref off upstream main, then PUT the file.
    const main = await gh(["api", `repos/${REPO}/git/ref/heads/main`, "-q", ".object.sha"])
    await gh(["api", "-X", "POST", `repos/${fork}/git/refs`, "-f", `ref=refs/heads/${branch}`, "-f", `sha=${main}`]).catch(() => {})
    await gh(["api", "-X", "PUT", `repos/${fork}/contents/eikons/${name}/${name}.eikon`,
      "-f", `message=eikons: add ${name}`,
      "-f", `branch=${branch}`,
      "-f", `content=${Buffer.from(raw).toString("base64")}`])

    const url = await gh(["pr", "create", "-R", REPO, "-H", `${user}:${branch}`, "-B", "main",
      "-t", `eikons: add ${name}`,
      "-b", `Adds \`${name}\` by ${e.meta.author}. ${e.meta.width}×${e.meta.height}, ${e.clips.size} states.`])
    console.log(url)
  },

  async install(argv) {
    const a = args(argv)
    const src = a.pos[0] ?? die("usage: eikon install <name|url|dir> [--name N] [--no-source] [--catalog URL]")
    const out = await install(src, root(), {
      name: a.str("name"), media: !a.kv["no-source"], catalog: a.str("catalog"),
      progress: (d, t) => process.stderr.write(`\r  ${d}/${t}`),
    })
    process.stderr.write("\r")
    console.log(`✓ ${out.name}  ${out.n} files  ${mb(out.bytes)}  → ${out.dir}`)
  },

  async update(argv) {
    const name = argv[0] ?? die("usage: eikon update <name> [--force]")
    const dir = join(root(), name)
    const mf = join(dir, "manifest.json")
    if (!existsSync(mf)) die(`${name}: not installed (no manifest.json)`)
    const man = JSON.parse(readFileSync(mf, "utf8")) as Manifest & { origin?: Origin }
    const origin = man.origin
    if (!origin?.source) die(`${name}: no origin recorded; reinstall with a source`)
    if (dirty(dir) && !argv.includes("--force"))
      die(`${name}: locally modified since install; pass --force to overwrite`)
    const out = await install(origin!.source, root(), { name })
    console.log(`✓ ${out.name}  ${out.n} files  ${mb(out.bytes)}  (${origin!.source})`)
  },

  async info(argv) {
    const name = argv[0] ?? die("usage: eikon info <name>")
    const mf = join(root(), name, "manifest.json")
    if (!existsSync(mf)) die(`${name}: not installed`)
    const m = JSON.parse(readFileSync(mf, "utf8")) as Manifest & { origin?: Origin }
    console.log(`${m.name}  v${m.version ?? 1}${m.eikon_requires ? `  (requires ${m.eikon_requires})` : ""}`)
    console.log(`  states: ${Object.keys(m.states ?? {}).join(" ")}`)
    if (m.source) console.log(`  base:   ${m.source}`)
    if (m.origin) console.log(`  from:   ${m.origin.source}\n  at:     ${m.origin.at}${m.origin.sha ? `  (${m.origin.sha.slice(0, 7)})` : ""}`)
    console.log(`  dir:    ${join(root(), name)}`)
  },

  add: (argv) => cmds.install!(argv),

  async show(argv) {
    const src = argv[0] ?? die("usage: eikon show <name|file>")
    const catalog = src.endsWith(".eikon")
      ? local(resolve(src, ".."))
      : cat(resolve(import.meta.dir, "../eikons"))
    const raw = src.endsWith(".eikon") ? await Bun.file(resolve(src)).text() : await catalog.load(src)
    const e = parse(raw)
    // Cheap inline preview: render poster, list states.
    console.log(poster(e))
    console.log(`\n${e.meta.glyph ?? "⬡"} ${e.meta.name} · ${e.meta.author ?? "—"} · ${[...e.clips.keys()].join(" ")}`)
  },

  async pack(argv) {
    const a = args(argv)
    const src = a.pos[0] ?? die("usage: eikon pack <image|video|dir> [out.eikon] [--name N] [--glyph G] [--author A] [--width 48] [--height 24] [--fps 16] [--symbols block|braille|ascii] [--colors none|256|full] [--no-invert]")
    const { doc, text } = pack(resolve(src), {
      name: a.str("name"), author: a.str("author"), glyph: a.str("glyph"),
      width: a.str("width") ? +a.str("width")! : undefined,
      height: a.str("height") ? +a.str("height")! : undefined,
      fps: a.str("fps") ? +a.str("fps")! : undefined,
      symbols: a.str("symbols") as never, colors: a.str("colors") as never,
      invert: !a.kv["no-invert"],
    })
    lint(text)
    const out = resolve(a.pos[1] ?? `${doc.header.name}.eikon`)
    await Bun.write(out, text)
    const total = doc.states.reduce((n, s) => n + s.frame_count, 0)
    console.log(`✓ ${out}  (${doc.header.width}×${doc.header.height}, ${total} frames, ${(text.length / 1024).toFixed(1)} KB)`)
    console.log(`  eikon show ${out}`)
  },

  async browse() {
    const r = await createCliRenderer({ exitOnCtrlC: true })
    createRoot(r).render(<Browser catalog={cat(resolve(import.meta.dir, "../eikons"))} />)
  },

  async index(argv) {
    const n = await reg.index(argv[0])
    console.log(`wrote ${n} entries → eikons/index.json`)
  },

  async manifest() {
    console.log(`wrote ${reg.manifest()} manifests`)
  },
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2)
  const fn = cmd ? cmds[cmd] : undefined
  if (!fn) die(`usage: eikon {${Object.keys(cmds).join("|")}} ...`)
  else await fn(argv).catch(e => die(e instanceof Error ? e.message : String(e)))
}
