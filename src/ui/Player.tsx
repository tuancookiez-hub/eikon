import { useState, useEffect, useRef, memo } from "react"
import type { Eikon, Clip } from "./eikon"

/**
 * Plays one state of an Eikon (SPEC.md playback rules):
 *   intro 0..loopFrom-1 once, then loop loopFrom..N-1.
 *   loopFrom=0 → loop whole sequence; loopFrom=N → play once, hold last.
 * State change restarts from frame 0.
 */
export const Player = memo((props: {
  eikon: Eikon
  state: string
  fg?: string
  onHold?: (state: string) => void
}) => {
  const [i, setI] = useState(0)
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const hold = useRef(props.onHold); hold.current = props.onHold

  const clip: Clip | undefined = props.eikon.clips.get(props.state)
    ?? props.eikon.clips.get("idle")
    ?? props.eikon.clips.values().next().value
  const frames = clip?.frames ?? []
  const fps = clip?.fps ?? 12
  const loopFrom = clip?.loopFrom ?? 0
  const n = frames.length

  useEffect(() => {
    if (timer.current) { clearTimeout(timer.current); timer.current = null }
    setI(0)
    if (n < 2) return
    const dt = 1000 / fps
    let idx = 0
    const tick = () => {
      idx++
      if (idx >= n) {
        if (loopFrom >= n) { setI(n - 1); hold.current?.(props.state); return }
        idx = loopFrom
      }
      setI(idx)
      timer.current = setTimeout(tick, dt)
    }
    timer.current = setTimeout(tick, dt)
    return () => { if (timer.current) clearTimeout(timer.current) }
  }, [props.state, n, fps, loopFrom])

  const lines = frames[Math.min(i, Math.max(0, n - 1))] ?? []
  return (
    <box flexDirection="column">
      {lines.map((ln, k) => <text key={k}><span fg={props.fg ?? "#c0caf5"}>{ln}</span></text>)}
    </box>
  )
})
