import type { SubmitBackend, SubmitRequest, Submitted } from "../../publish"
import { config, functionsUrl, type SupabaseConfig } from "./client"

export type SupabaseSubmitOptions = {
  cfg?: SupabaseConfig
  token?: () => Promise<string | undefined>
  fetcher?: typeof fetch
}

type Init = { uploadId: string; accepted: true }

type Finalized = { url: string; id: string; name: string }

async function body(res: Response) {
  const text = await res.text()
  if (!res.ok) throw new Error(text || `supabase publish HTTP ${res.status}`)
  return text ? JSON.parse(text) as unknown : undefined
}

async function files(req: SubmitRequest) {
  return Promise.all(req.bundle.files.map(async file => ({
    path: file.dest,
    bytes: file.bytes,
    content: Buffer.from(await Bun.file(file.abs).arrayBuffer()).toString("base64"),
  })))
}

export function supabaseSubmitBackend(opts: SupabaseSubmitOptions = {}): SubmitBackend {
  const cfg = opts.cfg ?? config()
  const fetcher = opts.fetcher ?? fetch
  return {
    async check() {
      if (!cfg) return { ok: false, reason: "Supabase registry is not configured" }
      const token = await opts.token?.()
      if (!token) return { ok: false, reason: "Supabase auth session required" }
      return { ok: true }
    },
    async create(req): Promise<Submitted> {
      if (!cfg) throw new Error("Supabase registry is not configured")
      const token = await opts.token?.()
      if (!token) throw new Error("Supabase auth session required")
      const init = await body(await fetcher(functionsUrl(cfg, "publish", "/init"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ name: req.bundle.meta.name, meta: req.bundle.meta, files: req.bundle.files.map(file => ({ path: file.dest, bytes: file.bytes })) }),
      })) as Init
      const out = await body(await fetcher(functionsUrl(cfg, "publish", "/finalize"), {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
        body: JSON.stringify({ uploadId: init.uploadId, title: req.title, request: req.body, files: await files(req) }),
      })) as Finalized
      return { kind: "submitted", url: out.url, request: req }
    },
  }
}


