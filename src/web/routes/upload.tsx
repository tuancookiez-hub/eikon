/** @jsxImportSource react */
import { createRoute, Link } from "@tanstack/react-router"
import { useEffect, useState } from "react"
import type { User } from "@supabase/supabase-js"
import { Route as root } from "./__root"
import { supabase } from "../lib/supabase"
import { functionsUrl, config } from "../../registry/supabase"

export const Route = createRoute({
  getParentRoute: () => root,
  path: "/upload",
  component: Upload,
})

type Picked = { path: string; bytes: number; content: string }

function rel(file: File) {
  return (file as File & { webkitRelativePath?: string }).webkitRelativePath || file.name
}

async function b64(file: File) {
  const raw = new Uint8Array(await file.arrayBuffer())
  let text = ""
  for (const byte of raw) text += String.fromCharCode(byte)
  return btoa(text)
}

export function Upload() {
  const [user, setUser] = useState<User | null>(null)
  const [files, setFiles] = useState<Picked[]>([])
  const [status, setStatus] = useState("")
  const [url, setUrl] = useState("")

  useEffect(() => {
    let live = true
    void supabase?.auth.getUser().then(res => { if (live) setUser(res.data.user ?? null) })
    const sub = supabase?.auth.onAuthStateChange((_event, session) => setUser(session?.user ?? null))
    return () => { live = false; sub?.data.subscription.unsubscribe() }
  }, [])

  const pick = async (list: FileList | null) => {
    const next = await Promise.all([...list ?? []].map(async file => ({ path: rel(file), bytes: file.size, content: await b64(file) })))
    setFiles(next)
    setStatus(`${next.length} files staged in browser memory`)
    setUrl("")
  }

  const publish = async () => {
    const cfg = config()
    if (!cfg || !supabase) return setStatus("Supabase is not configured for this build.")
    const token = (await supabase.auth.getSession()).data.session?.access_token
    if (!token) return setStatus("Sign in before upload.")
    const manifest = files.find(file => /packages\/[^/]+\/[^/]+\/[^/]+\.json$/.test(file.path) || file.path.endsWith("1.0.0.json"))
    if (!manifest) return setStatus("Select a prepared package directory containing packages/<namespace>/<name>/<version>.json")
    setStatus("Creating upload session…")
    const init = await fetch(functionsUrl(cfg, "publish", "/init"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ files: files.map(file => ({ path: file.path, bytes: file.bytes })) }),
    }).then(async res => {
      const text = await res.text()
      if (!res.ok) throw new Error(text)
      return JSON.parse(text) as { uploadId: string }
    })
    setStatus("Finalizing package…")
    const out = await fetch(functionsUrl(cfg, "publish", "/finalize"), {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ uploadId: init.uploadId, files }),
    }).then(async res => {
      const text = await res.text()
      if (!res.ok) throw new Error(text)
      return JSON.parse(text) as { url: string; name: string }
    })
    setUrl(out.url)
    setStatus(`Published ${out.name}`)
  }

  return (
    <main className="routePanel uploadFlow">
      <h1>upload</h1>
      <p>Upload a prepared Eikon package directory. For local testing, build or stage a package with the CLI, then select the package files including <code>packages/&lt;namespace&gt;/&lt;name&gt;/&lt;version&gt;.json</code> and blobs.</p>
      {!user ? <p className="notice error">Sign in on <Link to="/account">account</Link> before upload.</p> : null}
      <input type="file" multiple onChange={event => void pick(event.currentTarget.files)} />
      <button type="button" disabled={!files.length || !user} onClick={() => void publish().catch(err => setStatus(err instanceof Error ? err.message : String(err)))}>publish</button>
      <p className={status.startsWith("{") ? "error" : "muted"}>{status || "No files selected."}</p>
      {url ? <a href={url}>open published detail</a> : null}
    </main>
  )
}
