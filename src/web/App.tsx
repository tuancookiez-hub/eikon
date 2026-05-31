/** @jsxImportSource react */
import { useEffect, useMemo, useState } from "react"
import type { CatalogEntry } from "../catalog"
import { DEFAULT_PUBLIC_CATALOG, loadCatalog } from "../catalog"
import { STATES } from "../ui/eikon"
import { fixedClock } from "../player/clock"
import { playbackFrame } from "../player/model"
import { AsciiPreview, EntryCard } from "./player"
import { browserInstructions, createWebCatalog, type PreviewState } from "./player"

const queryDefault = new URLSearchParams(globalThis.location?.search ?? "").get("catalog") ?? DEFAULT_PUBLIC_CATALOG

export function App() {
  const [query, setQuery] = useState("")
  const [state, setState] = useState("idle")
  const [tick, setTick] = useState(0)
  const [copied, setCopied] = useState("")
  const [err, setErr] = useState("")
  const [, rerender] = useState(0)
  const catalog = useMemo(() => createWebCatalog({ base: queryDefault, loadCatalog }), [])

  useEffect(() => { void catalog.refresh().then(() => rerender(x => x + 1)) }, [catalog])
  useEffect(() => {
    const id = setInterval(() => setTick(x => x + 1), 180)
    return () => clearInterval(id)
  }, [])

  const matches = catalog.search(query)
  const selected = catalog.selected() ?? matches[0]
  if (selected && catalog.state.selectedKey !== selected.identityKey) catalog.select(selected.identityKey)
  const preview = catalog.state.preview
  const frame = preview.status === "ready" ? playbackFrame(preview.eikon, state, fixedClock(tick * 180), 0) : []
  const instructions = selected ? browserInstructions(selected) : undefined

  const pick = async (entry: CatalogEntry) => {
    catalog.select(entry.identityKey)
    await catalog.preview(entry.identityKey)
    rerender(x => x + 1)
  }

  const copy = async (text: string, label: string) => {
    setErr("")
    try {
      await navigator.clipboard.writeText(text)
      setCopied(label)
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main>
      <header className="hero">
        <p className="eyebrow">eikon.liftaris.dev</p>
        <h1>Discovery mirror for Herm eikons</h1>
        <p>Browse the public catalog, preview stateful terminal avatars, then copy Herm-oriented install/open instructions. This page does not publish, authenticate, or install in the browser.</p>
      </header>

      <section className="toolbar" aria-label="Catalog controls">
        <label>
          Search name or author
          <input value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="ares, kaio, nous…" autoFocus />
        </label>
        <button type="button" onClick={() => void catalog.refresh().then(() => rerender(x => x + 1))}>Retry catalog</button>
      </section>

      {catalog.state.status === "error" ? <p role="alert" className="error">Catalog failed: {catalog.state.error}. Check the network and retry.</p> : null}
      {matches.length === 0 && catalog.state.status !== "error" ? <p className="empty">No eikons match this search. Clear the query to return to the catalog.</p> : null}

      <section className="shell">
        <div className="grid" aria-label="Catalog entries">
          {matches.map(entry => <EntryCard key={entry.identityKey} entry={entry} selected={selected?.identityKey === entry.identityKey} onPick={() => void pick(entry)} />)}
        </div>

        <aside className="detail" aria-label="Preview and instructions">
          {selected ? <Preview selected={selected} preview={preview} frame={frame} state={state} setState={setState} load={() => pick(selected)} /> : <p>Select an eikon to preview it.</p>}
          {instructions ? (
            <div className="instructions">
              <h2>Open in Herm</h2>
              <code>{instructions.command}</code>
              <button type="button" onClick={() => void copy(instructions.command, "command")}>Copy command</button>
              <a href={instructions.hermUrl}>Open Herm detail</a>
              <p>{instructions.manual}</p>
            </div>
          ) : null}
          {copied ? <p className="ok">Copied {copied}.</p> : null}
          {err ? <p role="alert" className="error">Copy failed: {err}</p> : null}
        </aside>
      </section>
    </main>
  )
}

function Preview(props: { selected: CatalogEntry; preview: PreviewState; frame: string[]; state: string; setState: (s: string) => void; load: () => Promise<void> }) {
  const ready = props.preview.status === "ready" && props.preview.entry.identityKey === props.selected.identityKey
  const failed = props.preview.status === "error" && props.preview.entry?.identityKey === props.selected.identityKey
  const error = failed && props.preview.status === "error" ? props.preview.error : ""
  return (
    <div className="preview">
      <div className="previewHead">
        <h2>{props.selected.name}</h2>
        <button type="button" onClick={() => void props.load()}>{ready ? "Reload preview" : "Load preview"}</button>
      </div>
      <AsciiPreview lines={ready ? props.frame : props.selected.poster.split("\n")} />
      <div className="states">
        {STATES.map(s => <button key={s} type="button" className={s === props.state ? "active" : ""} onClick={() => props.setState(s)}>{s}</button>)}
      </div>
      {failed ? <p role="alert" className="error">Preview failed: {error}. Catalog remains available; use the copyable fallback instructions.</p> : null}
    </div>
  )
}
