import { createCliRenderer } from "@opentui/core"
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react"
import { useMemo } from "react"
import { existsSync } from "node:fs"
import { resolve } from "node:path"

import { parse, STATES, type Eikon } from "../../src/ui/eikon"
import { Player } from "../../src/ui/Player"

const path = resolve(process.argv[2] ?? resolve(import.meta.dir, "../../avatars/nous-girl/nous-girl.eikon"))
if (!existsSync(path)) { console.error(`eikon-preview: file not found: ${path}`); process.exit(1) }

const doc: Eikon = parse(await Bun.file(path).text())

const PALETTE = ["#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#ff9e64", "#f7768e", "#7dcfff", "#73daca", "#c0caf5"]

function chunk<T>(arr: T[], n: number): T[][] {
  const out: T[][] = []
  for (let i = 0; i < arr.length; i += n) out.push(arr.slice(i, i + n))
  return out
}

function App() {
  const renderer = useRenderer()
  const dim = useTerminalDimensions()
  useKeyboard(k => { if (k.name === "q" || k.name === "escape") renderer.destroy() })

  const names = doc.meta.states.length ? doc.meta.states : [...STATES]
  const cols = names.length <= 3 ? names.length : names.length <= 6 ? 3 : 4
  const rows = useMemo(() => chunk(names, cols), [names, cols])
  const total = useMemo(() => [...doc.clips.values()].reduce((n, c) => n + c.frames.length, 0), [])

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor="#1a1b26">
      <box justifyContent="center">
        <text>
          <span fg="#7aa2f7">{"⬡ "}</span>
          <span fg="#c0caf5">{"eikon"}</span>
          <span fg="#565f89">{" — "}</span>
          <span fg="#c0caf5">{doc.meta.name}</span>
          <span fg="#565f89">{` · ${doc.meta.width}×${doc.meta.height} · ${names.length} states · ${total} frames`}</span>
          <span fg="#414868">{`   ${dim.width}×${dim.height}`}</span>
        </text>
      </box>
      <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        {rows.map((row, r) => (
          <box key={r} flexDirection="row" gap={1}>
            {row.map((name, c) => {
              const fg = PALETTE[(r * cols + c) % PALETTE.length]!
              return (
                <box key={name} flexDirection="column" alignItems="center" border borderStyle="rounded" borderColor={fg}>
                  <box paddingX={1}><text><span fg={fg}>{` ${name.toUpperCase()} `}</span></text></box>
                  <box paddingX={1}><Player eikon={doc} state={name} fg="#c0caf5" /></box>
                </box>
              )
            })}
          </box>
        ))}
      </box>
      <box justifyContent="center">
        <text>
          <span fg="#565f89">{"press "}</span><span fg="#7aa2f7">q</span>
          <span fg="#565f89">{" to quit  •  "}</span>
          <span fg="#414868">{path.replace(process.env.HOME ?? "", "~")}</span>
        </text>
      </box>
    </box>
  )
}

const renderer = await createCliRenderer()
createRoot(renderer).render(<App />)
