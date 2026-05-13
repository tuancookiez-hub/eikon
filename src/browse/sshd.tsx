#!/usr/bin/env bun
/**
 * eikon.sh local sshd. One child `main.tsx` per connection, stdio wired
 * to the ssh channel. OpenTUI's native renderer writes to process fd 1,
 * so the child owns the tty; this process is just a shim.
 *
 *   bun src/browse/sshd.tsx          # listens on 127.0.0.1:2222
 *   ssh -p 2222 localhost            # browse
 */

import { Server, type PseudoTtyInfo, type WindowChangeInfo } from "ssh2"
import { existsSync } from "node:fs"
import { resolve } from "node:path"
import { spawnSync } from "node:child_process"

const HOST = "127.0.0.1"
const PORT = Number(process.env.EIKON_PORT ?? 2222)
const KEY = resolve(import.meta.dir, "../../hostkey")
const MAIN = resolve(import.meta.dir, "./main.tsx")

if (!existsSync(KEY))
  spawnSync("ssh-keygen", ["-q", "-t", "ed25519", "-N", "", "-f", KEY])

const server = new Server({ hostKeys: [await Bun.file(KEY).text()] }, conn => {
  conn.on("authentication", ctx => ctx.accept())
  conn.on("error", () => {})
  conn.on("session", ok => {
    const sess = ok()
    let pty: PseudoTtyInfo = { cols: 80, rows: 24, width: 0, height: 0, modes: {} }
    let child: { stdin: Bun.FileSink; kill: () => void } | null = null

    sess.on("pty", (ok, _, info) => { pty = info; ok?.() })
    sess.on("env", (ok) => ok?.())
    sess.on("window-change", (ok, _, info: WindowChangeInfo) => {
      ok?.()
      // Child reads SIGWINCH off its own tty dims, but there is no tty here —
      // so forward via a control line on stdin that main.tsx handles.
      child?.stdin.write(`\x1e${JSON.stringify({ resize: [info.cols, info.rows] })}\n`)
    })
    sess.on("shell", ok => {
      const chan = ok()
      const proc = Bun.spawn(["bun", MAIN], {
        stdin: "pipe", stdout: "pipe", stderr: "pipe",
        env: { ...process.env, EIKON_COLS: String(pty.cols), EIKON_ROWS: String(pty.rows) },
      })
      child = proc

      // chan → child.stdin (keystrokes), child.stdout → chan (frames),
      // child.stderr → chan.stderr (picks).
      chan.on("data", (b: Buffer) => { proc.stdin.write(b); proc.stdin.flush() })
      ;(async () => { for await (const b of proc.stdout) chan.write(b) })()
      ;(async () => { for await (const b of proc.stderr) chan.stderr.write(b) })()

      proc.exited.then(code => { chan.exit(code ?? 0); chan.end() })
      const down = () => { child?.kill(); child = null }
      chan.on("close", down)
      conn.on("close", down)
    })
  })
})

server.listen(PORT, HOST, () =>
  process.stderr.write(`eikon.sh sshd · ${HOST}:${PORT}\n`))
