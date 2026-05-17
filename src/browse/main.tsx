#!/usr/bin/env bun
import { createCliRenderer } from "@opentui/core"
import { createRoot } from "@opentui/react"
import { resolve as path } from "node:path"
import { Browser } from "./Browser"
import { resolve } from "./catalog"
import { emit } from "./ipc"

const dir = path(process.argv[2] ?? path(import.meta.dir, "../../catalog"))
const catalog = resolve(dir)

// When spawned under sshd there's no real tty; dims come via env and
// resize via RS-framed control lines on stdin (injected before the
// renderer sees the keystroke stream).
const cols = Number(process.env.EIKON_COLS ?? 0) || undefined
const rows = Number(process.env.EIKON_ROWS ?? 0) || undefined
if (cols && rows) Object.assign(process.stdout, { columns: cols, rows, isTTY: true })
if (!process.stdin.isTTY) Object.assign(process.stdin, { isTTY: true, setRawMode: () => {} })

const renderer = await createCliRenderer({
  exitOnCtrlC: true,
  remote: Boolean(cols),
  prependInputHandlers: [(seq) => {
    if (seq[0] !== "\x1e") return false
    const nl = seq.indexOf("\n")
    const msg = JSON.parse(seq.slice(1, nl < 0 ? undefined : nl)) as { resize?: [number, number] }
    if (msg.resize)
      (renderer as unknown as { processResize: (w: number, h: number) => void }).processResize(...msg.resize)
    return true
  }],
})
createRoot(renderer).render(<Browser catalog={catalog} onPick={emit(process.stderr)} />)
