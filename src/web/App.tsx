/** @jsxImportSource react */
import { useEffect, useMemo, useRef, useState, type PointerEvent, type ReactNode } from "react"
import type { CatalogEntry } from "../browser"
import { CANONICAL_STATES } from "../browser"
import { AsciiPreview, EntryCard, browserInstructions, createWebCatalog, webPlaybackFrame, type PreviewState } from "./player"

const loc = typeof location === "undefined" ? undefined : location
const catalogBase = new URLSearchParams(loc?.search ?? "").get("catalog") ?? "/eikons"
export const WEB_PREVIEW_FPS = 16
export const WEB_PREVIEW_FRAME_MS = 1000 / WEB_PREVIEW_FPS
type DrawerMode = "collapsed" | "peek" | "expanded"

export function App() {
  const [query, setQuery] = useState("")
  const [mode, setMode] = useState("idle")
  const [tickMs, setTickMs] = useState(0)
  const [startedMs, setStartedMs] = useState(0)
  const [copied, setCopied] = useState("")
  const [err, setErr] = useState("")
  const [drawerMode, setDrawerMode] = useState<DrawerMode>("collapsed")
  const [, rerender] = useState(0)
  const tick = useRef(0)
  const drawerDrag = useRef({ active: false, y: 0, swiped: false })
  const detailRef = useRef<HTMLElement | null>(null)
  tick.current = tickMs
  const catalog = useMemo(() => createWebCatalog({ base: catalogBase }), [])
  const measureDetail = () => {
    const node = detailRef.current
    if (!node) return
    const selectedPoster = document.querySelector<HTMLElement>(".card.selected .cardPoster")
    const posterFont = selectedPoster ? window.getComputedStyle(selectedPoster).fontSize : ""
    const posterWidth = selectedPoster?.getBoundingClientRect().width ?? 0
    if (posterFont) node.style.setProperty("--selected-preview-font-size", posterFont)
    else node.style.removeProperty("--selected-preview-font-size")
    if (posterWidth > 0) node.style.setProperty("--selected-preview-width", `${posterWidth}px`)
    else node.style.removeProperty("--selected-preview-width")
    if (window.matchMedia("(max-width: 980px)").matches) {
      node.style.removeProperty("--detail-height")
      return
    }
    const viewportHeight = window.visualViewport?.height ?? window.innerHeight
    const top = Math.max(14, node.getBoundingClientRect().top)
    const height = Math.max(360, viewportHeight - top)
    node.style.setProperty("--detail-height", `${height}px`)
  }

  useEffect(() => { void catalog.refresh().then(() => rerender(n => n + 1)) }, [catalog])
  useEffect(() => {
    const start = performance.now()
    const timer = globalThis.setInterval(() => setTickMs(performance.now() - start), WEB_PREVIEW_FRAME_MS)
    return () => globalThis.clearInterval(timer)
  }, [])
  useEffect(() => {
    let frame = 0
    const schedule = () => {
      if (frame) window.cancelAnimationFrame(frame)
      frame = window.requestAnimationFrame(() => {
        frame = 0
        measureDetail()
      })
    }
    measureDetail()
    window.addEventListener("resize", schedule)
    window.addEventListener("scroll", schedule, { passive: true })
    window.visualViewport?.addEventListener("resize", schedule)
    window.visualViewport?.addEventListener("scroll", schedule)
    return () => {
      if (frame) window.cancelAnimationFrame(frame)
      window.removeEventListener("resize", schedule)
      window.removeEventListener("scroll", schedule)
      window.visualViewport?.removeEventListener("resize", schedule)
      window.visualViewport?.removeEventListener("scroll", schedule)
    }
  }, [])

  const matches = catalog.search(query)
  const visibleKeys = matches.map(entry => catalog.keyFor(entry)).join("\0")
  const selected = catalog.selected()
  const preview = catalog.state.preview
  const selectedKey = selected ? catalog.keyFor(selected) : ""
  const ready = selected && preview.status === "ready" && catalog.keyFor(preview.entry) === selectedKey
  const frame = ready ? webPlaybackFrame(preview.eikon, mode, tickMs, startedMs) : []
  const instructions = selected ? browserInstructions(selected) : undefined
  const drawerState: DrawerMode = selected ? drawerMode === "collapsed" ? "peek" : drawerMode : "collapsed"
  const status = catalog.state.status === "loading"
    ? "loading catalog"
    : catalog.state.status === "error"
      ? "catalog unavailable"
      : `${matches.length}/${catalog.state.entries.length} shown`

  useEffect(() => { measureDetail() }, [drawerState, selectedKey, visibleKeys])

  useEffect(() => {
    if (matches.length === 0) return
    const ctrl = new AbortController()
    let live = true
    void Promise.all(matches.map(entry => catalog.loadPreview(catalog.keyFor(entry), ctrl.signal)))
      .then(() => { if (live) rerender(n => n + 1) })
    return () => { live = false; ctrl.abort() }
  }, [catalog, visibleKeys])

  const pick = async (entry: CatalogEntry) => {
    setErr("")
    setCopied("")
    const key = catalog.keyFor(entry)
    catalog.select(key)
    setDrawerMode("peek")
    rerender(n => n + 1)
    await catalog.preview(key)
    setStartedMs(tick.current)
    rerender(n => n + 1)
  }

  const choose = (next: string) => {
    setMode(next)
    setStartedMs(tick.current)
  }

  const copy = async (text: string, label: string) => {
    setErr("")
    try {
      const board = navigator?.clipboard
      if (!board) throw new Error("clipboard unavailable")
      await board.writeText(text)
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
          <h1>𝝴ikon</h1>
          <p>A terminal avatar format for Herm. Browse the catalog, preview each state, and copy the install command for your local profile.</p>
        </div>
        <dl className="quickGuide" aria-label="How to use eikons">
          <div>
            <dt>install</dt>
            <dd>Select an eikon, copy <code>herm eikon install &lt;url&gt;</code>, then run it locally.</dd>
          </div>
          <div>
            <dt>create</dt>
            <dd>Author a .eikon package locally, then submit it via Herm.</dd>
          </div>
        </dl>
      </header>

      <section className="toolbar" aria-label="Catalog controls">
        <label>
          Search by name or author
          <input value={query} onChange={event => setQuery((event.currentTarget as unknown as WebInput).value)} placeholder="Search catalog" autoFocus />
        </label>
        <div className="catalogStatus" aria-live="polite">{status}</div>
        <button type="button" onClick={() => void catalog.refresh().then(() => rerender(n => n + 1))}>Refresh catalog</button>
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
          {matches.map(entry => {
            const key = catalog.keyFor(entry)
            const cardPreview = catalog.state.previews[key]
            const cardFrame = cardPreview?.status === "ready" ? webPlaybackFrame(cardPreview.eikon, "idle", tickMs, 0) : undefined
            return <EntryCard key={key} entry={entry} frame={cardFrame} selected={key === selectedKey} onPick={() => void pick(entry)} />
          })}
        </div>

        <aside ref={detailRef} className={`detail drawer-${drawerState}`} aria-label="Preview and instructions" data-drawer-state={drawerState}>
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
            <span className="drawerTitle">{selected ? `${selected.glyph ?? "⬡"} ${selected.title || selected.name}` : "Select an eikon"}</span>
            <span className="drawerCue">{selected ? drawerState === "expanded" ? "collapse" : "expand" : "collapsed"}</span>
          </button>
          <div className="detailBody">
            {selected ? (
              <Preview selected={selected} preview={preview} frame={frame} state={mode} setState={choose}>
                <div className="drawerExtras">
                  {instructions ? (
                    <div className="instructions">
                      <h2>install</h2>
                      <code>{instructions.command}</code>
                      <button type="button" onClick={() => void copy(instructions.command, "command")}>Copy command</button>
                      <p>{instructions.manual}</p>
                    </div>
                  ) : null}
                  {copied ? <p className="ok">Copied {copied}.</p> : null}
                  {err ? <p role="alert" className="error">Copy failed: {err}</p> : null}
                </div>
              </Preview>
            ) : <p className="muted">Select an eikon to preview it.</p>}
          </div>
        </aside>
      </section>
    </main>
  )
}

function Preview(props: { selected: CatalogEntry; preview: PreviewState; frame: string[]; state: string; setState: (s: string) => void; children?: ReactNode }) {
  const key = props.selected.sourceKey
  const ready = props.preview.status === "ready" && props.preview.entry.sourceKey === key
  const loading = props.preview.status === "loading" && props.preview.entry.sourceKey === key
  const failed = props.preview.status === "error" && props.preview.entry?.sourceKey === key
  const title = props.selected.title || props.selected.name
  const author = props.selected.author ?? "unknown"
  const poster = (props.selected.poster || "").split("\n")
  return (
    <div className="preview">
      <AsciiPreview lines={ready && props.frame.length > 0 ? props.frame : poster} />
      <div className="previewPanel">
        <div className="previewHead">
          <h2><span className="glyph">{props.selected.glyph ?? "⬡"}</span> {title}</h2>
          <p>{author}</p>
        </div>
        <dl className="previewMeta" aria-label="Selected eikon metadata">
          <div>
            <dt>Title</dt>
            <dd>{title}</dd>
          </div>
          <div>
            <dt>Author</dt>
            <dd>{author}</dd>
          </div>
          <div>
            <dt>Version</dt>
            <dd>{props.selected.version ?? "-"}</dd>
          </div>
          <div>
            <dt>State</dt>
            <dd>{props.state}</dd>
          </div>
        </dl>
        {loading ? <p className="previewStatus muted">Loading preview…</p> : null}
        <div className="previewOptions states">
          {CANONICAL_STATES.map(state => <button key={state} type="button" className={state === props.state ? "active" : ""} onClick={() => props.setState(state)}>{state}</button>)}
        </div>
        {failed && props.preview.status === "error" ? <p role="alert" className="previewStatus error">Preview failed: {props.preview.error}. Catalog remains available; use the copyable fallback instructions.</p> : null}
        {props.children}
      </div>
    </div>
  )
}
