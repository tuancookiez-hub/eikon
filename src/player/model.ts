import type { Clip, Eikon } from "../ui/eikon"
import type { Clock } from "./clock"

export type Playback = {
  state: string
  clip?: Clip
  frame: string[]
  index: number
  elapsedMs: number
}

export function stateClip(eikon: Eikon, state: string): Clip | undefined {
  return eikon.clips.get(state) ?? eikon.clips.get("idle") ?? eikon.clips.values().next().value
}

export function frameIndex(clip: Clip | undefined, elapsedMs: number): number {
  const n = clip?.frames.length ?? 0
  if (!clip || n === 0) return 0
  if (n === 1) return 0
  const fps = clip.fps > 0 ? clip.fps : 12
  const raw = Math.max(0, Math.floor(elapsedMs / (1000 / fps)))
  if (raw < n) return raw
  if (clip.loopFrom >= n) return n - 1
  const loopStart = Math.max(0, Math.min(clip.loopFrom, n - 1))
  const loopLen = n - loopStart
  return loopStart + ((raw - loopStart) % loopLen)
}

export function frameAt(clip: Clip | undefined, elapsedMs: number): string[] {
  return clip?.frames[frameIndex(clip, elapsedMs)] ?? []
}

export function playback(eikon: Eikon, state: string, elapsedMs: number): Playback {
  const clip = stateClip(eikon, state)
  const index = frameIndex(clip, elapsedMs)
  return { state, clip, index, elapsedMs, frame: clip?.frames[index] ?? [] }
}

export function playbackFrame(eikon: Eikon, state: string, clock: Clock, selectedAt = 0): string[] {
  return playback(eikon, state, Math.max(0, clock.now() - selectedAt)).frame
}
