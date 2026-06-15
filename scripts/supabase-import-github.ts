#!/usr/bin/env bun
import { readFileSync } from "node:fs"
import { join } from "node:path"
import { createHash } from "node:crypto"
import { createClient } from "@supabase/supabase-js"
import type { CatalogEntry, EikonPackageManifest, PackageFileDescriptor } from "../src/contract/shape"

type Env = { API_URL: string; SERVICE_ROLE_KEY: string }

function sha(data: Uint8Array | string) {
  return `sha256:${createHash("sha256").update(data).digest("hex")}`
}

function env(): Env {
  const direct = {
    API_URL: process.env.SUPABASE_URL ?? process.env.API_URL ?? "",
    SERVICE_ROLE_KEY: process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.SERVICE_ROLE_KEY ?? "",
  }
  if (direct.API_URL && direct.SERVICE_ROLE_KEY) return direct
  const p = Bun.spawnSync(["supabase", "status", "-o", "env"], { stdout: "pipe", stderr: "pipe" })
  if (p.exitCode !== 0) throw new Error(new TextDecoder().decode(p.stderr))
  const found: Record<string, string> = {}
  for (const line of new TextDecoder().decode(p.stdout).split(/\r?\n/)) {
    const m = line.match(/^([A-Z_]+)="?(.+?)"?$/)
    if (m) found[m[1]!] = m[2]!
  }
  if (!found.API_URL || !found.SERVICE_ROLE_KEY) throw new Error("Supabase local service env unavailable")
  return { API_URL: found.API_URL, SERVICE_ROLE_KEY: found.SERVICE_ROLE_KEY }
}

async function one<T>(value: PromiseLike<{ data: T | null; error: { message: string } | null }>) {
  const out = await value
  if (out.error) throw new Error(out.error.message)
  if (!out.data) throw new Error("Supabase returned no data")
  return out.data
}

async function run() {
  const root = process.cwd()
  const cfg = env()
  const db = createClient(cfg.API_URL, cfg.SERVICE_ROLE_KEY, { auth: { persistSession: false } })
  const catalog = JSON.parse(readFileSync(join(root, "eikons", "index.json"), "utf8")) as CatalogEntry[]
  let imported = 0
  for (const entry of catalog) {
    const [namespace = "liftaris", name = entry.name] = entry.id.split("/")
    const version = entry.version ?? "1.0.0"
    const dir = join(root, "packages", namespace, name)
    const manifestPath = join(dir, `${version}.json`)
    const indexPath = join(dir, "index.json")
    const manifest = JSON.parse(readFileSync(manifestPath, "utf8")) as EikonPackageManifest
    const manifestBytes = readFileSync(manifestPath)
    const sourceKey = entry.sourceKey || `registry:eikon.liftaris.dev:${entry.id}@${version}`
    const pkg = await one(db.from("packages").upsert({
      namespace,
      name,
      canonical_id: entry.id,
      source_key: sourceKey,
      origin_kind: "github-mirror",
      origin_repo: "liftaris/eikon",
      origin_ref: "main",
      visibility: "public",
      github_login_at_submit: entry.author,
    }, { onConflict: "source_key" }).select("id").single())
    const ver = await one(db.from("package_versions").upsert({
      package_id: pkg.id,
      version,
      manifest,
      manifest_digest: entry.trust?.manifestDigest ?? sha(manifestBytes),
      runtime_digest: entry.trust?.runtimeDigest ?? manifest.files?.find(f => f.role === "runtime")?.digest,
      runtime_size: entry.trust?.runtimeSize ?? manifest.files?.find(f => f.role === "runtime")?.size,
      runtime_encoding: entry.trust?.runtimeEncoding ?? manifest.files?.find(f => f.role === "runtime")?.encoding,
      runtime_decoded_size: entry.trust?.runtimeDecodedSize ?? manifest.files?.find(f => f.role === "runtime")?.decodedSize,
      runtime_decoded_digest: entry.trust?.runtimeDecodedDigest ?? manifest.files?.find(f => f.role === "runtime")?.decodedDigest,
      poster: entry.poster,
      status: "published",
    }, { onConflict: "package_id,version" }).select("id").single())
    await one(db.from("packages").update({ current_version_id: ver.id, visibility: "public" }).eq("id", pkg.id).select("id").single())
    await db.from("package_files").delete().eq("version_id", ver.id)
    const upload = async (path: string, bytes: Uint8Array, media: string) => {
      const { error } = await db.storage.from("eikon-artifacts").upload(path, bytes, { upsert: true, contentType: media })
      if (error) throw new Error(error.message)
    }
    await upload(`packages/${namespace}/${name}/${version}.json`, manifestBytes, "application/json")
    await upload(`packages/${namespace}/${name}/index.json`, readFileSync(indexPath), "application/json")
    for (const file of manifest.files ?? []) {
      const desc = file as PackageFileDescriptor
      const bytes = readFileSync(join(dir, desc.path))
      const storagePath = `packages/${namespace}/${name}/${desc.path}`
      await upload(storagePath, bytes, desc.mediaType)
      const { error } = await db.from("package_files").insert({
        version_id: ver.id,
        path: desc.path,
        role: desc.role,
        media_type: desc.mediaType,
        storage_bucket: "eikon-artifacts",
        storage_path: storagePath,
        digest: desc.digest ?? sha(bytes),
        size: desc.size ?? bytes.length,
        encoding: desc.encoding,
        decoded_size: desc.decodedSize,
        decoded_digest: desc.decodedDigest,
        signal: desc.signal,
      })
      if (error) throw new Error(error.message)
    }
    await db.rpc("ensure_package_stats", { pid: pkg.id })
    imported++
  }
  console.log(`imported ${imported} eikons into ${cfg.API_URL}`)
}

await run()
