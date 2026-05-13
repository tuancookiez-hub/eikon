// .eikon NDJSON writer — sibling of src/ui/eikon.ts (the tolerant reader).
// Used by mk_eikon.ts and preview/author.tsx. These types mirror the wire
// format exactly; the reader (eikon.ts) derives its own shapes.

export interface Header {
  eikon: 1
  name: string
  width: number
  height: number
  author?: string
  glyph?: string
  license?: string
  created?: string
  url?: string
  description?: string
}

export interface Frame {
  f: number
  data: string
  pause?: number
  color?: string
}

export interface StateDecl {
  state: string
  fps: number
  color?: string
  frame_count: number
  loop_from?: number
  /** @deprecated use loop_from */
  loop?: boolean
  frames: Frame[]
}

export interface Doc {
  header: Header
  states: StateDecl[]
}

/** Serialize a Doc to NDJSON text. Validates frame counts and ordering. */
export function serialize(doc: Doc): string {
  const out: string[] = [JSON.stringify(doc.header)]
  for (const st of doc.states) {
    if (st.frames.length !== st.frame_count)
      throw new Error(`state "${st.state}": frame_count=${st.frame_count} but got ${st.frames.length} frames`)
    const { frames, ...decl } = st
    out.push(JSON.stringify(decl))
    for (let i = 0; i < frames.length; i++) {
      const fr = frames[i]!
      if (fr.f !== i) throw new Error(`state "${st.state}": frame ${i} has f=${fr.f}`)
      out.push(JSON.stringify(fr))
    }
  }
  return out.join("\n") + "\n"
}
