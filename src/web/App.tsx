/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState } from "react"
import type { CatalogEntry } from "../browser"
import { CANONICAL_STATES } from "../browser"
import { AsciiPreview, EntryCard, browserInstructions, createWebCatalog, webPlaybackFrame, type PreviewState } from "./player"

const loc = typeof location === "undefined" ? undefined : location
const catalogBase = new URLSearchParams(loc?.search ?? "").get("catalog") ?? "/eikons"
const frameMs = 1000 / 16

export function App() {
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState("idle")
  const [tickMs, setTickMs] = useState(0)
  const [startedMs, setStartedMs] = useState(0)
  const [copied, setCopied] = useState("")
  const [err, setErr] = useState("")
  const [, rerender] = useState(0)
  const tick = useRef(0)
  tick.current = tickMs
  const catalog = useMemo(() => createWebCatalog({ base: catalogBase }), [])

  useEffect(() => { void catalog.refresh().then(() => rerender(n => n + 1)) }, [catalog])
  useEffect(() => {
    const start = performance.now()
    const timer = globalThis.setInterval(() => setTickMs(performance.now() - start), frameMs)
    return () => globalThis.clearInterval(timer)
  }, [])

  const matches = catalog.search(query)
  const selected = catalog.selected()
  const preview = catalog.state.preview
  const ready = selected && preview.status === "ready" && preview.entry.sourceKey === selected.sourceKey
  const frame = ready ? webPlaybackFrame(preview.eikon, mode, tickMs, startedMs) : []
  const instructions = selected ? browserInstructions(selected) : undefined
  const status = catalog.state.status === "loading"
    ? "loading catalog"
    : catalog.state.status === "error"
      ? "catalog unavailable"
      : `${matches.length}/${catalog.state.entries.length} shown`

  const pick = async (entry: CatalogEntry) => {
    setErr("")
    setCopied("")
    const key = catalog.keyFor(entry)
    catalog.select(key)
    rerender(n => n + 1)
    await catalog.preview(key)
    setStartedMs(tick.current)
    rerender(n => n + 1)
  }

  const choose = (next: string) => {
    setMode(next)
    setStartedMs(tick.current)
  }

  const copy = async (text: string) => {
    setErr("")
    try {
      const board = navigator?.clipboard
      if (!board) throw new Error("clipboard unavailable")
      await board.writeText(text)
      setCopied("instructions copied")
    } catch (error) {
      setErr(error instanceof Error ? error.message : String(error))
    }
  }

  return (
    <main>
      <header className="pageHeader">
        <div className="intro">
          <h1>𝝴ikon</h1>
          <p>Discovery-only gallery for Herm terminal avatars. Browse public exports, preview states, and copy the local Herm command.</p>
        </div>
        <dl className="quickGuide" aria-label="Gallery boundaries">
          <div><dt>discover</dt><dd>Catalog entries load from public Eikon exports.</dd></div>
          <div><dt>local</dt><dd>Install and activation stay inside Herm; this page does not mutate local state.</dd></div>
        </dl>
      </header>

      <section className="toolbar" aria-label="Catalog controls">
        <label>
          Search by name, author, or tag
          <input value={query} onChange={event => setQuery((event.currentTarget as unknown as WebInput).value)} placeholder="Search catalog" autoFocus />
        </label>
        <div className="catalogStatus" aria-live="polite">{status}</div>
        <button type="button" onClick={() => void catalog.refresh().then(() => rerender(n => n + 1))}>Refresh</button>
      </section>

      {catalog.state.status === "error" ? (
        <div role="alert" className="notice error">
          <span>Catalog unavailable.</span>
          <code>{catalog.state.error}</code>
        </div>
      ) : null}
      {catalog.state.status === "loading" ? <p className="notice">Loading public catalog…</p> : null}
      {matches.length === 0 && catalog.state.status !== "error" ? <p className="empty">No eikons match this search.</p> : null}

      <section className="shell">
        <div className="grid" aria-label="Catalog entries">
          {matches.map(entry => <EntryCard key={catalog.keyFor(entry)} entry={entry} selected={catalog.keyFor(entry) === selected?.sourceKey} onPick={() => void pick(entry)} />)}
        </div>

        <aside className="detail" aria-label="Preview and copyable Herm instructions">
          {selected ? <Preview selected={selected} preview={preview} frame={frame} state={mode} setState={choose} /> : <p className="muted">Select an eikon to preview it.</p>}
          {instructions ? (
            <div className="instructions">
              <h2>Herm instructions</h2>
              <code>{instructions.command}</code>
              <button type="button" onClick={() => void copy(instructions.command)}>Copy instructions</button>
              <p>{instructions.manual}</p>
            </div>
          ) : null}
          {copied ? <p className="ok">{copied}.</p> : null}
          {err ? <p role="alert" className="error">Copy failed: {err}</p> : null}
        </aside>
      </section>
    </main>
  )
}

function Preview(props: { selected: CatalogEntry; preview: PreviewState; frame: string[]; state: string; setState: (s: string) => void }) {
  const key = props.selected.sourceKey
  const ready = props.preview.status === "ready" && props.preview.entry.sourceKey === key
  const loading = props.preview.status === "loading" && props.preview.entry.sourceKey === key
  const failed = props.preview.status === "error" && props.preview.entry?.sourceKey === key
  const title = props.selected.title || props.selected.name
  const poster = (props.selected.poster || "").split("\n")
  return (
    <div className="preview">
      <div className="previewHead">
        <h2><span className="glyph">{props.selected.glyph ?? "⬡"}</span> {title}</h2>
        <p>{props.selected.author ?? "unknown"}</p>
      </div>
      <AsciiPreview lines={ready && props.frame.length > 0 ? props.frame : poster} />
      {loading ? <p className="previewStatus muted">Loading preview…</p> : null}
      <div className="previewOptions states">
        {CANONICAL_STATES.map(state => <button key={state} type="button" className={state === props.state ? "active" : ""} onClick={() => props.setState(state)}>{state}</button>)}
      </div>
      {failed && props.preview.status === "error" ? <p role="alert" className="previewStatus error">Preview failed: {props.preview.error}. Copy instructions remain available.</p> : null}
    </div>
  )
}
