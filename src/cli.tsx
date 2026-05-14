#!/usr/bin/env bun
// eikon {publish, add, show, lint} — bun CLI. Python authoring stays under
// `uv run eikon`; this owns the bare `eikon` name.

import { resolve, basename, join } from "node:path"
import { homedir } from "node:os"
import { mkdirSync } from "node:fs"
import { parse, poster } from "./ui/eikon"
import { lint } from "./ui/lint"
import { pack } from "./pack"
import { Browser } from "./browse/Browser"
import { local, resolve as cat } from "./browse/catalog"
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"

const REPO = process.env.EIKON_REPO ?? "liftaris/eikon"

const die = (msg: string): never => { console.error(`eikon: ${msg}`); process.exit(1) }

async function gh(args: string[], input?: string) {
  const p = Bun.spawn(["gh", ...args], { stdin: input ? new TextEncoder().encode(input) : undefined, stdout: "pipe", stderr: "pipe" })
  const [out, err, code] = await Promise.all([new Response(p.stdout).text(), new Response(p.stderr).text(), p.exited])
  if (code !== 0) die(`gh ${args[0]} failed: ${err.trim() || out.trim()}`)
  return out.trim()
}

const cmds: Record<string, (argv: string[]) => Promise<void>> = {
  async lint(argv) {
    const path = argv[0] ?? die("usage: eikon lint <file>")
    const e = lint(await Bun.file(resolve(path)).text())
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
    await gh(["api", "-X", "PUT", `repos/${fork}/contents/catalog/${name}.eikon`,
      "-f", `message=catalog: add ${name}`,
      "-f", `branch=${branch}`,
      "-f", `content=${Buffer.from(raw).toString("base64")}`])

    const url = await gh(["pr", "create", "-R", REPO, "-H", `${user}:${branch}`, "-B", "main",
      "-t", `catalog: add ${name}`,
      "-b", `Adds \`${name}\` by ${e.meta.author}. ${e.meta.width}×${e.meta.height}, ${e.clips.size} states.`])
    console.log(url)
  },

  async add(argv) {
    const name = argv[0] ?? die("usage: eikon add <name>")
    const raw = await cat(resolve(import.meta.dir, "../catalog")).load(name)
    const dir = join(process.env.HERMES_HOME ?? join(homedir(), ".hermes"), "eikons")
    mkdirSync(dir, { recursive: true })
    const dst = join(dir, `${name}.eikon`)
    await Bun.write(dst, raw)
    console.log(dst)
  },

  async show(argv) {
    const src = argv[0] ?? die("usage: eikon show <name|file>")
    const catalog = src.endsWith(".eikon")
      ? local(resolve(src, ".."))
      : cat(resolve(import.meta.dir, "../catalog"))
    const raw = src.endsWith(".eikon") ? await Bun.file(resolve(src)).text() : await catalog.load(src)
    const e = parse(raw)
    // Cheap inline preview: render poster, list states.
    console.log(poster(e))
    console.log(`\n${e.meta.glyph ?? "⬡"} ${e.meta.name} · ${e.meta.author ?? "—"} · ${[...e.clips.keys()].join(" ")}`)
  },

  async pack(argv) {
    const pos: string[] = []
    const kv: Record<string, string | true> = {}
    for (let i = 0; i < argv.length; i++) {
      const a = argv[i]!
      if (!a.startsWith("--")) { pos.push(a); continue }
      const next = argv[i + 1]
      kv[a.slice(2)] = next && !next.startsWith("--") ? (i++, next) : true
    }
    const src = pos[0] ?? die("usage: eikon pack <image|video|dir> [out.eikon] [--name N] [--glyph G] [--author A] [--width 48] [--height 24] [--fps 16] [--symbols block|braille|ascii] [--colors none|256|full] [--no-invert]")

    const str = (k: string) => typeof kv[k] === "string" ? kv[k] : undefined
    const { doc, text } = pack(resolve(src), {
      name: str("name"), author: str("author"), glyph: str("glyph"),
      width: str("width") ? +str("width")! : undefined,
      height: str("height") ? +str("height")! : undefined,
      fps: str("fps") ? +str("fps")! : undefined,
      symbols: str("symbols") as never, colors: str("colors") as never,
      invert: !kv["no-invert"],
    })
    lint(text)
    const out = resolve(pos[1] ?? `${doc.header.name}.eikon`)
    await Bun.write(out, text)
    const total = doc.states.reduce((n, s) => n + s.frame_count, 0)
    console.log(`✓ ${out}  (${doc.header.width}×${doc.header.height}, ${total} frames, ${(text.length / 1024).toFixed(1)} KB)`)
    console.log(`  eikon show ${out}`)
  },

  async browse() {
    const r = await createCliRenderer({ exitOnCtrlC: true })
    createRoot(r).render(<Browser catalog={cat(resolve(import.meta.dir, "../catalog"))} />)
  },
}

if (import.meta.main) {
  const [cmd, ...argv] = process.argv.slice(2)
  const fn = cmd ? cmds[cmd] : undefined
  if (!fn) die(`usage: eikon {${Object.keys(cmds).join("|")}} ...`)
  else await fn(argv).catch(e => die(e instanceof Error ? e.message : String(e)))
}
