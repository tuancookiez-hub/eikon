import { useState, useEffect, useMemo } from "react"
import { useKeyboard, useRenderer } from "@opentui/react"
import { Player } from "../ui/Player"
import { parse, STATES, type Eikon } from "../ui/eikon"
import type { Catalog, Entry } from "./catalog"

const C = { bg: "#1a1b26", fg: "#c0caf5", dim: "#565f89", faint: "#414868", hi: "#7aa2f7", ok: "#9ece6a" }

const trunc = (s: string, n: number) => s.length <= n ? s : s.slice(0, n - 1) + "…"

export function Browser(props: {
  catalog: Catalog
  onPick?: (name: string, raw: string, bytes?: Uint8Array) => void
}) {
  const renderer = useRenderer()
  const [entries, setEntries] = useState<Entry[]>([])
  const [cursor, setCursor] = useState(0)
  const [auto, setAuto] = useState(true)
  const [si, setSi] = useState(0)
  const [loaded, setLoaded] = useState<{ raw: string; bytes?: Uint8Array; doc: Eikon } | null>(null)
  const [flash, setFlash] = useState("")

  useEffect(() => { props.catalog.list().then(setEntries) }, [props.catalog])

  const cur = entries[cursor]
  const state = STATES[si % STATES.length]!

  useEffect(() => {
    if (!cur) return
    setLoaded(null); setSi(0); setAuto(true)
    let dead = false
    const pick = props.catalog.loadArtifact
      ? props.catalog.loadArtifact(cur.name)
      : props.catalog.load(cur.name).then(async raw => ({ raw, bytes: props.catalog.loadBytes ? await props.catalog.loadBytes(cur.name) : undefined }))
    pick.then(out => {
      if (!dead) setLoaded({ raw: out.raw, bytes: out.bytes, doc: parse(out.raw) })
    })
    return () => { dead = true }
  }, [cur, props.catalog])

  useEffect(() => {
    if (!auto || !loaded) return
    const t = setInterval(() => setSi(i => i + 1), 2000)
    return () => clearInterval(t)
  }, [auto, loaded])

  useKeyboard(k => {
    if (k.name === "q" || k.name === "escape") return renderer.destroy()
    if (!entries.length) return
    if (k.name === "up" || k.name === "k") return setCursor(c => (c - 1 + entries.length) % entries.length)
    if (k.name === "down" || k.name === "j") return setCursor(c => (c + 1) % entries.length)
    if (k.name === "left") { setAuto(false); return setSi(i => (i - 1 + STATES.length) % STATES.length) }
    if (k.name === "right") { setAuto(false); return setSi(i => i + 1) }
    if (k.name === "space") return setAuto(a => !a)
    if (k.name === "return" && cur && loaded) {
      if (!props.onPick) return setFlash(`curl $EIKON_URL/${cur.name}.eikon -o ~/.hermes/eikons/${cur.name}.eikon`)
      props.onPick(cur.name, loaded.raw, loaded.bytes)
      setFlash(`✓ ${cur.name}`)
    }
  })

  const posterLines = cur?.poster?.split("\n") ?? []
  const w = Math.max(48, ...posterLines.map(line => line.length)) + 4
  const h = Math.max(24, posterLines.length || 24) + 2
  const listW = 34

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={C.bg} padding={1}>
      <box height={1} flexDirection="row" justifyContent="space-between">
        <text>
          <span fg={C.hi}>{"⬡ eikon.sh"}</span>
          <span fg={C.dim}>{`  ·  ${entries.length} avatars`}</span>
        </text>
        <text fg={C.faint}>{"↑↓ nav · ←→ state · Enter install · q quit"}</text>
      </box>
      <box height={1} />

      <box flexDirection="row" flexGrow={1}>
        <box width={listW} marginRight={2} flexDirection="column">
          <scrollbox scrollY flexGrow={1}>
            <box flexDirection="column">
              {entries.length === 0
                ? <box height={1}><text fg={C.dim}>loading…</text></box>
                : entries.map((e, i) => {
                    const on = i === cursor
                    return (
                      <box key={e.name} height={2} flexDirection="column" paddingX={1}
                           backgroundColor={on ? "#24283b" : undefined}
                           onMouseDown={() => setCursor(i)}>
                        <text fg={on ? C.fg : C.dim}>
                          <span>{e.glyph ?? "⬡"}</span>
                          <span> </span>
                          <strong>{trunc(e.name, listW - 6)}</strong>
                        </text>
                        <text fg={C.faint}>{`  ${e.author ?? "—"}`}</text>
                      </box>
                    )
                  })}
            </box>
          </scrollbox>
        </box>

        <box flexGrow={1} flexDirection="column" alignItems="center" justifyContent="center">
          {cur && (
            <box flexDirection="column" alignItems="center">
              <box border borderStyle="rounded" borderColor={C.hi} width={w} height={h}
                   alignItems="center" justifyContent="center" overflow="hidden">
                {loaded
                  ? <Player key={cur.name + state} eikon={loaded.doc} state={state} fg={C.fg} />
                  : <Poster text={cur.poster ?? ""} />}
              </box>
              <box height={1} />
              <box height={1}>
                <text>
                  {STATES.map((s, i) => (
                    <span key={s} fg={s === state ? C.hi : C.faint}>
                      {s}{i < STATES.length - 1 ? "  " : ""}
                    </span>
                  ))}
                </text>
              </box>
              <box height={1} />
              <box height={1}><text fg={flash ? C.ok : C.faint}>{flash || " "}</text></box>
            </box>
          )}
        </box>
      </box>
    </box>
  )
}

const Poster = ({ text }: { text: string }) => {
  const lines = useMemo(() => text.split("\n"), [text])
  return (
    <box flexDirection="column">
      {lines.map((ln, i) => <text key={i} fg={C.dim}>{ln}</text>)}
    </box>
  )
}
