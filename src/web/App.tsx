/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type PointerEvent } from "react"
import type { CatalogEntry } from "../catalog"
import { DEFAULT_PUBLIC_CATALOG, loadCatalog } from "../catalog"
import { STATES } from "../ui/eikon"
import { AsciiPreview, EntryCard, webPlaybackFrame } from "./player"
import { browserInstructions, createWebCatalog, type PreviewState } from "./player"

const queryDefault = new URLSearchParams(globalThis.location?.search ?? "").get("catalog") ?? DEFAULT_PUBLIC_CATALOG
export const WEB_PREVIEW_FPS = 16
export const WEB_PREVIEW_FRAME_MS = 1000 / WEB_PREVIEW_FPS
type DrawerMode = "collapsed" | "peek" | "expanded"

export function App() {
  const [query, setQuery] = useState("")
  const [state, setState] = useState("idle")
  const [tickMs, setTickMs] = useState(0)
  const tickRef = useRef(0)
  tickRef.current = tickMs
  const [previewStartedAtMs, setPreviewStartedAtMs] = useState(0)
  const [copied, setCopied] = useState("")
  const [err, setErr] = useState("")
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("collapsed")
  const drawerDrag = useRef({ active: false, y: 0, swiped: false })
  const [, rerender] = useState(0)
  const catalog = useMemo(() => createWebCatalog({ base: queryDefault, loadCatalog }), [])

  useEffect(() => { void catalog.refresh().then(() => rerender(x => x + 1)) }, [catalog])
  useEffect(() => {
    const start = performance.now()
    const id = setInterval(() => setTickMs(performance.now() - start), WEB_PREVIEW_FRAME_MS)
    return () => clearInterval(id)
  }, [])

  const matches = catalog.search(query)
  const visibleKeys = matches.map(e => e.identityKey).join("\0")
  const selected = catalog.selected()
  const preview = catalog.state.preview
  const previewReady = selected && preview.status === "ready" && preview.entry.identityKey === selected.identityKey
  const frame = previewReady ? webPlaybackFrame(preview.eikon, state, tickMs, previewStartedAtMs) : []
  const instructions = selected ? browserInstructions(selected) : undefined
  const drawerState: DrawerMode = selected ? drawerMode === "collapsed" ? "peek" : drawerMode : "collapsed"
  const statusLabel = catalog.state.status === "loading"
    ? "loading catalog"
    : catalog.state.status === "error"
      ? "catalog unavailable"
      : `${matches.length}/${catalog.state.entries.length} shown`

  useEffect(() => {
    if (matches.length === 0) return
    const ctrl = new AbortController()
    let live = true
    void Promise.all(matches.map(entry => catalog.loadPreview(entry.identityKey, ctrl.signal)))
      .then(() => { if (live) rerender(x => x + 1) })
    return () => { live = false; ctrl.abort() }
  }, [catalog, visibleKeys])

  const pick = async (entry: CatalogEntry) => {
    setErr("")
    setCopied("")
    catalog.select(entry.identityKey)
    setDrawerMode("peek")
    rerender(x => x + 1)
    await catalog.preview(entry.identityKey)
    setPreviewStartedAtMs(tickRef.current)
    rerender(x => x + 1)
  }

  const chooseState = (next: string) => {
    setState(next)
    setPreviewStartedAtMs(tickRef.current)
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

  const toggleDrawer = () => {
    if (drawerDrag.current.swiped) {
      drawerDrag.current.swiped = false
      return
    }
    if (!selected) return
    setDrawerMode(current => current === "expanded" ? "peek" : "expanded")
  }

  const startDrawerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    drawerDrag.current = { active: true, y: event.clientY, swiped: false }
  }

  const endDrawerDrag = (event: PointerEvent<HTMLButtonElement>) => {
    if (!drawerDrag.current.active) return
    const delta = drawerDrag.current.y - event.clientY
    drawerDrag.current.active = false
    if (!selected) return
    if (delta > 28) {
      drawerDrag.current.swiped = true
      setDrawerMode("expanded")
    } else if (delta < -28) {
      drawerDrag.current.swiped = true
      setDrawerMode("peek")
    }
  }

  return (
    <main>
      <header className="pageHeader">
        <div className="intro">
          <h1>eikon</h1>
          <p>A terminal avatar format for Herm. Browse the catalog, preview each state, and copy the install command for your local profile.</p>
        </div>
        <dl className="quickGuide" aria-label="How to use eikons">
          <div>
            <dt>install</dt>
            <dd>Select an eikon, copy <code>herm eikon install &lt;url&gt;</code>, then run it locally.</dd>
          </div>
          <div>
            <dt>create</dt>
            <dd>Author a .eikon package locally, then submit it through Herm for review.</dd>
          </div>
        </dl>
      </header>

      <section className="toolbar" aria-label="Catalog controls">
        <label>
          Search by name or author
          <input value={query} onChange={e => setQuery(e.currentTarget.value)} placeholder="Search catalog" autoFocus />
        </label>
        <div className="catalogStatus" aria-live="polite">{statusLabel}</div>
        <button type="button" onClick={() => void catalog.refresh().then(() => rerender(x => x + 1))}>Refresh catalog</button>
      </section>

      {catalog.state.status === "error" ? (
        <div role="alert" className="notice error">
          <span>Catalog unavailable.</span>
          <code>{catalog.state.error}</code>
        </div>
      ) : null}
      {matches.length === 0 && catalog.state.status !== "error" ? <p className="empty">No eikons match this search.</p> : null}

      <section className="shell">
        <div className="grid" aria-label="Catalog entries">
          {matches.map(entry => {
            const cardPreview = catalog.state.previews[entry.identityKey]
            const cardFrame = cardPreview?.status === "ready"
              ? webPlaybackFrame(cardPreview.eikon, "idle", tickMs, 0)
              : undefined
            return <EntryCard key={entry.identityKey} entry={entry} frame={cardFrame} selected={selected?.identityKey === entry.identityKey} onPick={() => void pick(entry)} />
          })}
        </div>

        <aside className={`detail drawer-${drawerState}`} aria-label="Preview and instructions" data-drawer-state={drawerState}>
          <button
            type="button"
            className="drawerHandle"
            aria-expanded={drawerState === "expanded"}
            onClick={toggleDrawer}
            onPointerDown={startDrawerDrag}
            onPointerUp={endDrawerDrag}
            onPointerCancel={() => { drawerDrag.current.active = false }}
          >
            <span className="drawerGrip" aria-hidden="true" />
            <span className="drawerTitle">{selected ? `${selected.glyph ?? "⬡"} ${selected.name}` : "Select an eikon"}</span>
            <span className="drawerCue">{selected ? drawerState === "expanded" ? "collapse" : "expand" : "collapsed"}</span>
          </button>
          <div className="detailBody">
            {selected ? <Preview selected={selected} preview={preview} frame={frame} state={state} setState={chooseState} /> : <p className="muted">Select an eikon to preview it.</p>}
            <div className="drawerExtras">
              {instructions ? (
                <div className="instructions">
                  <h2>install</h2>
                  <code>{instructions.command}</code>
                  <button type="button" onClick={() => void copy(instructions.command, "command")}>Copy command</button>
                  <a href={instructions.hermUrl}>Open Herm detail</a>
                  <p>{instructions.manual}</p>
                </div>
              ) : null}
              {copied ? <p className="ok">Copied {copied}.</p> : null}
              {err ? <p role="alert" className="error">Copy failed: {err}</p> : null}
            </div>
          </div>
        </aside>
      </section>
    </main>
  )
}

function Preview(props: { selected: CatalogEntry; preview: PreviewState; frame: string[]; state: string; setState: (s: string) => void }) {
  const ready = props.preview.status === "ready" && props.preview.entry.identityKey === props.selected.identityKey
  const loading = props.preview.status === "loading" && props.preview.entry.identityKey === props.selected.identityKey
  const failed = props.preview.status === "error" && props.preview.entry?.identityKey === props.selected.identityKey
  const error = failed && props.preview.status === "error" ? props.preview.error : ""
  const poster = props.selected.poster.split("\n")
  return (
    <div className="preview">
      <div className="previewHead">
        <h2><span className="glyph">{props.selected.glyph ?? "⬡"}</span> {props.selected.name}</h2>
      </div>
      <AsciiPreview lines={ready && props.frame.length > 0 ? props.frame : poster} />
      {loading ? <p className="previewStatus muted">Loading preview…</p> : null}
      <div className="previewOptions states">
        {STATES.map(s => <button key={s} type="button" className={s === props.state ? "active" : ""} onClick={() => props.setState(s)}>{s}</button>)}
      </div>
      {failed ? <p role="alert" className="previewStatus error">Preview failed: {error}. Catalog remains available; use the copyable fallback instructions.</p> : null}
    </div>
  )
}
