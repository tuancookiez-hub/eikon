// .eikon format — reader, writer, and types.
// Spec: docs/SPEC.md (v1)

export interface EikonHeader {
  eikon: 1;
  name: string;
  width: number;
  height: number;
  author?: string;
  license?: string;
  created?: string;
  url?: string;
  description?: string;
}

export interface EikonFrame {
  f: number;
  data: string;
  pause?: number;
  color?: string;
}

export interface EikonState {
  state: string;
  fps: number;
  color?: string;
  frame_count: number;
  /** First frame of the loop segment (intro = 0..loop_from-1). Absent = 0. */
  loop_from?: number;
  /** @deprecated Use `loop_from`. `false` ⇔ `loop_from: frame_count`. */
  loop?: boolean;
  frames: EikonFrame[];
}

export interface Eikon {
  header: EikonHeader;
  states: EikonState[];
}

// ---------------------------------------------------------------------------
// Writer
// ---------------------------------------------------------------------------

/**
 * Serialize an Eikon to NDJSON text.
 * Validates frame counts and ordering before emitting.
 */
export function serializeEikon(doc: Eikon): string {
  const lines: string[] = [];
  lines.push(JSON.stringify(doc.header));

  for (const state of doc.states) {
    if (state.frames.length !== state.frame_count) {
      throw new Error(
        `state "${state.state}": frame_count=${state.frame_count} but got ${state.frames.length} frames`,
      );
    }
    // Emit state declaration (without the `frames` array — that's our in-memory view).
    const { frames, ...stateDecl } = state;
    lines.push(JSON.stringify(stateDecl));

    for (let i = 0; i < frames.length; i++) {
      const frame = frames[i]!;
      if (frame.f !== i) {
        throw new Error(
          `state "${state.state}": frame ${i} has f=${frame.f}, expected ${i}`,
        );
      }
      lines.push(JSON.stringify(frame));
    }
  }

  return lines.join("\n") + "\n";
}

// ---------------------------------------------------------------------------
// Reader
// ---------------------------------------------------------------------------

/**
 * Parse NDJSON `.eikon` text into a structured document.
 * Throws with line numbers on any structural violation.
 */
export function parseEikon(text: string): Eikon {
  const rawLines = text.split("\n");
  // Tolerate trailing blank line (common from writers that append \n).
  const lines = rawLines.filter((l, i) => l.length > 0 || i < rawLines.length - 1);

  if (lines.length === 0) {
    throw new Error("eikon: empty file");
  }

  let cursor = 0;

  const header = parseLine(lines[cursor]!, cursor) as EikonHeader;
  cursor++;
  validateHeader(header);

  const states: EikonState[] = [];

  while (cursor < lines.length) {
    const line = lines[cursor]!;
    if (line.length === 0) {
      cursor++;
      continue;
    }

    const stateDecl = parseLine(line, cursor);
    if (typeof stateDecl.state !== "string") {
      throw new Error(
        `eikon: line ${cursor + 1}: expected state declaration, got ${line.slice(0, 60)}`,
      );
    }
    validateStateDecl(stateDecl, cursor);
    cursor++;

    const frames: EikonFrame[] = [];
    for (let f = 0; f < stateDecl.frame_count; f++) {
      if (cursor >= lines.length) {
        throw new Error(
          `eikon: state "${stateDecl.state}" expected ${stateDecl.frame_count} frames, got ${f}`,
        );
      }
      const frameLine = lines[cursor]!;
      const frame = parseLine(frameLine, cursor) as EikonFrame;
      if (typeof frame.f !== "number" || typeof frame.data !== "string") {
        throw new Error(
          `eikon: line ${cursor + 1}: malformed frame in state "${stateDecl.state}"`,
        );
      }
      if (frame.f !== f) {
        throw new Error(
          `eikon: state "${stateDecl.state}" frame ${f} has f=${frame.f}`,
        );
      }
      frames.push(frame);
      cursor++;
    }

    states.push({
      state: stateDecl.state,
      fps: stateDecl.fps,
      color: stateDecl.color,
      frame_count: stateDecl.frame_count,
      loop: stateDecl.loop ?? true,
      frames,
    });
  }

  return { header, states };
}

function parseLine(line: string, index: number): any {
  try {
    return JSON.parse(line);
  } catch (err) {
    throw new Error(`eikon: line ${index + 1}: invalid JSON — ${(err as Error).message}`);
  }
}

function validateHeader(h: any): asserts h is EikonHeader {
  if (h.eikon !== 1) {
    throw new Error(`eikon: unsupported version ${h.eikon} (expected 1)`);
  }
  if (typeof h.name !== "string") throw new Error("eikon: header.name required");
  if (typeof h.width !== "number") throw new Error("eikon: header.width required");
  if (typeof h.height !== "number") throw new Error("eikon: header.height required");
}

function validateStateDecl(s: any, lineIdx: number): void {
  if (typeof s.fps !== "number") {
    throw new Error(`eikon: line ${lineIdx + 1}: state.fps required`);
  }
  if (typeof s.frame_count !== "number") {
    throw new Error(`eikon: line ${lineIdx + 1}: state.frame_count required`);
  }
}
