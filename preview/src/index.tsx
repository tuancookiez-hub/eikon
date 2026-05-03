import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer, useTerminalDimensions } from "@opentui/react";
import { useState, useEffect, useMemo } from "react";
import { readFileSync, existsSync } from "node:fs";
import { resolve } from "node:path";

import { parseEikon, type Eikon, type EikonState } from "./eikon.ts";

// ---------------------------------------------------------------------------
// Load .eikon file (CLI arg → default path)
// ---------------------------------------------------------------------------

const DEFAULT_EIKON = resolve(import.meta.dir, "../../avatars/nous-girl/nous-girl.eikon");
const eikonPath = resolve(process.argv[2] ?? DEFAULT_EIKON);

if (!existsSync(eikonPath)) {
  console.error(`eikon-preview: file not found: ${eikonPath}`);
  process.exit(1);
}

let doc: Eikon;
try {
  doc = parseEikon(readFileSync(eikonPath, "utf8"));
} catch (err) {
  console.error(`eikon-preview: parse failed —`, (err as Error).message);
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Fallback color palette for states without explicit `color` in file
// ---------------------------------------------------------------------------

const FALLBACK_COLORS = [
  "#7aa2f7", "#9ece6a", "#e0af68", "#bb9af7", "#ff9e64", "#f7768e",
  "#7dcfff", "#73daca", "#c0caf5",
];

function stateColor(state: EikonState, idx: number): string {
  return state.color ?? FALLBACK_COLORS[idx % FALLBACK_COLORS.length]!;
}

// ---------------------------------------------------------------------------
// AvatarCell — plays a single state's frames, honors fps + per-frame pause + loop
// ---------------------------------------------------------------------------

function AvatarCell({ state, color }: { state: EikonState; color: string }) {
  const [frameIdx, setFrameIdx] = useState(0);
  const frames = state.frames;
  const loop = state.loop ?? true;

  useEffect(() => {
    if (frames.length === 0) return;
    let cancelled = false;
    let timer: ReturnType<typeof setTimeout>;

    const tick = (i: number) => {
      if (cancelled) return;
      setFrameIdx(i);
      const frame = frames[i]!;
      const baseDelay = 1000 / state.fps;
      const extraPause = (frame.pause ?? 0) * 1000;
      const delay = baseDelay + extraPause;

      const next = i + 1;
      if (next >= frames.length) {
        if (!loop) return; // stop on last frame
        timer = setTimeout(() => tick(0), delay);
      } else {
        timer = setTimeout(() => tick(next), delay);
      }
    };

    tick(0);
    return () => {
      cancelled = true;
      clearTimeout(timer!);
    };
  }, [frames, state.fps, loop]);

  const currentFrame = frames[frameIdx] ?? frames[0]!;
  const displayColor = currentFrame?.color ?? color;

  return (
    <box flexDirection="column" alignItems="center" border borderStyle="rounded" borderColor={color} padding={0}>
      <box paddingX={1}>
        <text>
          <span fg={color}>{` ${state.state.toUpperCase()} `}</span>
          <span fg="#565f89">{` ${frameIdx + 1}/${frames.length} `}</span>
          <span fg="#414868">{`${state.fps}fps`}</span>
        </text>
      </box>
      <box paddingX={1}>
        <text fg="#c0caf5">{currentFrame?.data ?? ""}</text>
      </box>
    </box>
  );
}

// ---------------------------------------------------------------------------
// Grid layout: choose rows×cols to fit state count
// ---------------------------------------------------------------------------

function gridShape(n: number): { rows: number; cols: number } {
  if (n <= 1) return { rows: 1, cols: 1 };
  if (n === 2) return { rows: 1, cols: 2 };
  if (n === 3) return { rows: 1, cols: 3 };
  if (n === 4) return { rows: 2, cols: 2 };
  if (n <= 6) return { rows: 2, cols: 3 };
  if (n <= 9) return { rows: 3, cols: 3 };
  const cols = 4;
  return { rows: Math.ceil(n / cols), cols };
}

function chunk<T>(arr: T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < arr.length; i += size) out.push(arr.slice(i, i + size));
  return out;
}

// ---------------------------------------------------------------------------
// App
// ---------------------------------------------------------------------------

function App() {
  const renderer = useRenderer();
  const { width, height } = useTerminalDimensions();

  useKeyboard((key) => {
    if (key.name === "q" || key.name === "escape") {
      renderer.destroy();
    }
  });

  const states = doc.states;
  const { cols } = useMemo(() => gridShape(states.length), [states.length]);
  const rows = useMemo(() => chunk(states, cols), [states, cols]);

  const totalFrames = useMemo(
    () => states.reduce((sum, s) => sum + s.frame_count, 0),
    [states],
  );

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor="#1a1b26">
      {/* Header */}
      <box justifyContent="center" paddingY={0}>
        <text>
          <span fg="#7aa2f7">{"⬡ "}</span>
          <span fg="#c0caf5">{"eikon"}</span>
          <span fg="#565f89">{" — "}</span>
          <span fg="#c0caf5">{doc.header.name}</span>
          <span fg="#565f89">
            {` · ${doc.header.width}×${doc.header.height} · ${states.length} states · ${totalFrames} frames`}
          </span>
          <span fg="#414868">{`   ${width}×${height}`}</span>
        </text>
      </box>

      {/* Grid */}
      <box flexDirection="column" flexGrow={1} justifyContent="center" alignItems="center">
        {rows.map((row, rIdx) => (
          <box key={rIdx} flexDirection="row" gap={1}>
            {row.map((state, cIdx) => {
              const absIdx = rIdx * cols + cIdx;
              return (
                <AvatarCell
                  key={state.state}
                  state={state}
                  color={stateColor(state, absIdx)}
                />
              );
            })}
          </box>
        ))}
      </box>

      {/* Footer */}
      <box justifyContent="center">
        <text>
          <span fg="#565f89">{"press "}</span>
          <span fg="#7aa2f7">{"q"}</span>
          <span fg="#565f89">{" to quit  •  "}</span>
          <span fg="#414868">{eikonPath.replace(process.env.HOME ?? "", "~")}</span>
        </text>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
