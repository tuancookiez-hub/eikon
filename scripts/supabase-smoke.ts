#!/usr/bin/env bun
import { mkdtempSync, writeFileSync } from "node:fs"
import { join } from "node:path"
import { tmpdir } from "node:os"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import { previewSubmitBundle, submission } from "../src/publish"
import { supabaseSubmitBackend } from "../src/registry/supabase"

type Env = { API_URL: string; PUBLISHABLE_KEY: string; SERVICE_ROLE_KEY: string }

function env(): Env {
  const p = Bun.spawnSync(["supabase", "status", "-o", "env"], { stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(new TextDecoder().decode(p.stderr))
  const found: Record<string, string> = {}
  for (const line of new TextDecoder().decode(p.stdout).split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.+?)"?$/)
    if (m) found[m[1]!] = m[2]!
  }
  for (const key of ["API_URL", "PUBLISHABLE_KEY", "SERVICE_ROLE_KEY"]) if (!found[key]) throw new Error(`missing ${key} from supabase status`)
  return found as Env
}

async function ok(res: Response) {
  const text = await res.text()
  if (!res.ok) throw new Error(`${res.status}: ${text}`)
  return text ? JSON.parse(text) : undefined
}

function runtime(name: string) {
  const frame = "........\n........\n........\n........"
  const states = ["idle", "listening", "thinking", "speaking", "working", "error"]
  return [
    JSON.stringify({ eikon: 1, name, author: "smoke", glyph: "◇", width: 8, height: 4, states }),
    ...states.flatMap(state => [
      JSON.stringify({ state, fps: 1, frame_count: 1 }),
      JSON.stringify({ f: 0, data: frame }),
    ]),
  ].join("\n") + "\n"
}

async function main() {
  const cfg = env()
  const base = `${cfg.API_URL}/functions/v1/registry`
  await Bun.$`bun scripts/supabase-import-github.ts`.quiet()
  const catalog = await ok(await fetch(`${base}/eikons/index.json`)) as Array<{ name: string; sourceKey: string; runtimeUrl: string; trust?: { runtimeDigest?: string } }>
  if (catalog.length < 1) throw new Error("catalog import failed")
  const first = catalog[0]!
  const blob = new Uint8Array(await (await fetch(first.runtimeUrl)).arrayBuffer())
  if (!blob.length) throw new Error("runtime blob empty")
  if (first.trust?.runtimeDigest && `sha256:${createHash("sha256").update(blob).digest("hex")}` !== first.trust.runtimeDigest) throw new Error("runtime digest mismatch")
  const stats = await ok(await fetch(`${cfg.API_URL}/functions/v1/events/download`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: first.sourceKey }) }))
  if (!stats?.stats?.downloads) throw new Error("download event did not increment")

  const auth = createClient(cfg.API_URL, cfg.PUBLISHABLE_KEY, { auth: { persistSession: false } })
  const email = `smoke-${Date.now()}@example.test`
  const password = "correct-horse-battery-staple"
  const sign = await auth.auth.signUp({ email, password })
  if (sign.error) throw sign.error
  const login = await auth.auth.signInWithPassword({ email, password })
  if (login.error) throw login.error
  const token = login.data.session?.access_token
  if (!token) throw new Error("auth token missing")

  const liked = await ok(await fetch(`${cfg.API_URL}/functions/v1/likes/${encodeURIComponent(first.sourceKey)}`, { method: "POST", headers: { authorization: `Bearer ${token}` } }))
  if (!liked?.stats || liked.stats.likes < 1) throw new Error("like did not increment")

  const dir = mkdtempSync(join(tmpdir(), "eikon-smoke-"))
  const name = `smoke-${Date.now()}`
  const file = join(dir, `${name}.eikon`)
  writeFileSync(file, runtime(name))
  const bundle = await previewSubmitBundle({ path: file, display: { title: name, author: "smoke", description: "local smoke", glyph: "◇" } })
  const submitted = await supabaseSubmitBackend({ cfg: { url: cfg.API_URL, publishableKey: cfg.PUBLISHABLE_KEY }, token: async () => token }).create(submission(bundle))
  if (!submitted.url) throw new Error("publish did not return registry URL")

  const next = await ok(await fetch(`${base}/eikons/index.json`)) as Array<{ name: string; sourceKey: string }>
  const mine = next.find(x => x.name === name)
  if (!mine) throw new Error("published eikon missing from catalog")
  const delisted = await ok(await fetch(`${cfg.API_URL}/functions/v1/delist/${encodeURIComponent(mine.sourceKey)}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify({ reason: "smoke" }) }))
  if (!delisted?.ok) throw new Error("delist failed")
  const hidden = await ok(await fetch(`${base}/eikons/index.json`)) as Array<{ name: string }>
  if (hidden.some(x => x.name === name)) throw new Error("delisted eikon still appears in catalog")
  console.log(JSON.stringify({ catalog: catalog.length, downloaded: blob.length, published: name, delisted: true }, null, 2))
}

await main()
