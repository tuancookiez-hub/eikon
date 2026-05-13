#!/usr/bin/env bun
// Probe: connect to local sshd, request pty+shell, wait for braille in
// stdout (UI rendered), send Enter, collect the RS-framed pick from stderr.

import { Client } from "ssh2"
import { picks } from "../src/browse/ipc"

const port = Number(process.env.EIKON_PORT ?? 2922)
const conn = new Client()

const got: string[] = []
let rendered = false

const done = (code: number, msg: string) => {
  console.log(JSON.stringify({ ok: code === 0, msg, rendered, got }))
  conn.end()
  process.exit(code)
}

conn.on("ready", () => {
  conn.shell({ cols: 140, rows: 40, term: "xterm-256color" }, (err, chan) => {
    if (err) return done(1, `shell: ${err.message}`)

    let out = ""
    chan.on("data", (b: Buffer) => {
      out += b.toString("utf8")
      if (!rendered && /[⠁-⣿]/.test(out) && out.includes("eikon.sh")) {
        rendered = true
        // nav down then pick — proves keystrokes reach the renderer
        chan.write("\x1b[B")
        setTimeout(() => chan.write("\r"), 200)
      }
    })

    ;(async () => {
      for await (const p of picks(chan.stderr as AsyncIterable<Uint8Array>)) {
        got.push(p.name)
        if (p.raw.startsWith("{") && p.raw.includes('"eikon"')) return done(0, `picked ${p.name} (${p.raw.length}b)`)
        return done(1, "pick body malformed")
      }
    })()

    setTimeout(() => done(1, "timeout"), 8000)
  })
})
conn.on("error", e => done(1, `conn: ${e.message}`))
conn.connect({ host: "127.0.0.1", port, username: "anon" })
