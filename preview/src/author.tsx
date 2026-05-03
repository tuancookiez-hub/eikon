#!/usr/bin/env bun
/**
 * author.tsx — interactive authoring preview.
 *
 * Point at a states/ dir (the same input mk_eikon takes), tune chafa
 * knobs live, cycle through states. What you see is byte-identical to
 * mk_eikon output — both call scripts/lib.ts. Press `w` to write the
 * .eikon with the current knobs, `c` to copy the equivalent CLI.
 *
 *   bun preview/src/author.tsx [avatars/<name>/states]
 */

import { createCliRenderer } from "@opentui/core";
import { createRoot, useKeyboard, useRenderer } from "@opentui/react";
import { useState, useEffect, useMemo, useRef } from "react";
import { existsSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { spawnSync } from "node:child_process";

import {
  discover, renderState, PngCache, which, command,
  DEFAULT_KNOBS, SYMBOLS, COLORS, DITHER,
  type Knobs, type Found, type Clip,
} from "../../scripts/lib.ts";
import { serializeEikon, type Eikon, type EikonFrame } from "./eikon.ts";

// ── Boot ──────────────────────────────────────────────────────────────

const src = resolve(process.argv[2] ?? resolve(import.meta.dir, "../../avatars/nous-girl/states"));
if (!existsSync(src)) { console.error(`author: not found: ${src}`); process.exit(1); }
which("ffmpeg"); which("chafa");

const found = discover(src);
if (found.length === 0) { console.error(`author: no states under ${src}`); process.exit(1); }

const avatarName = basename(dirname(src));
const outPath = join(dirname(src), `${avatarName}.eikon`);

// ── Theme ─────────────────────────────────────────────────────────────

const C = {
  bg: "#1a1b26", fg: "#c0caf5", dim: "#565f89", faint: "#414868",
  accent: "#7aa2f7", ok: "#9ece6a", warn: "#e0af68",
};

const WIDTHS = [32, 40, 48, 56, 64];
const HEIGHTS = [16, 20, 24, 28, 32];
const FPS = [8, 12, 16, 24];

type KnobKey = "width" | "height" | "fps" | "symbols" | "colors" | "dither" | "invert";
const KNOB_KEYS: KnobKey[] = ["width", "height", "fps", "symbols", "colors", "dither", "invert"];

function cycle<T>(arr: readonly T[], cur: T, dir: 1 | -1): T {
  const i = arr.indexOf(cur);
  return arr[(i + dir + arr.length) % arr.length]!;
}

function step(k: Knobs, key: KnobKey, dir: 1 | -1): Knobs {
  switch (key) {
    case "width":   return { ...k, width: cycle(WIDTHS, k.width, dir) };
    case "height":  return { ...k, height: cycle(HEIGHTS, k.height, dir) };
    case "fps":     return { ...k, fps: cycle(FPS, k.fps, dir) };
    case "symbols": return { ...k, symbols: cycle(SYMBOLS, k.symbols, dir) };
    case "colors":  return { ...k, colors: cycle(COLORS, k.colors, dir) };
    case "dither":  return { ...k, dither: cycle(DITHER, k.dither, dir) };
    case "invert":  return { ...k, invert: !k.invert };
  }
}

// ── Clip player ───────────────────────────────────────────────────────

function Player({ clip, fps, tint }: { clip: Clip | null; fps: number; tint: boolean }) {
  const [i, setI] = useState(0);
  const count = clip?.frames.length ?? 0;

  useEffect(() => {
    setI(0);
    if (!clip || count < 2) return;
    const dt = 1000 / fps;
    let idx = 0;
    let t: ReturnType<typeof setTimeout>;
    const tick = () => {
      idx++;
      if (idx >= count) {
        if (clip.loopFrom >= count) { setI(count - 1); return; }
        idx = clip.loopFrom;
      }
      setI(idx);
      t = setTimeout(tick, dt);
    };
    t = setTimeout(tick, dt);
    return () => clearTimeout(t);
  }, [clip, count, fps]);

  if (!clip) return <text fg={C.dim}>rendering…</text>;
  const data = clip.frames[Math.min(i, count - 1)] ?? "";
  const tag = clip.loopFrom === 0 ? "loop"
    : clip.loopFrom === count ? "hold"
    : `intro ${clip.loopFrom}+loop ${count - clip.loopFrom}`;
  // colors != none → frame carries its own SGR; render raw. Otherwise
  // tint with the theme accent so monochrome output reads like herm's.
  return (
    <box flexDirection="column" alignItems="center">
      <text fg={C.dim}>{`${i + 1}/${count}  ·  ${tag}`}</text>
      <box marginTop={1}>
        {tint ? <text fg={C.accent}>{data}</text> : <text>{data}</text>}
      </box>
    </box>
  );
}

// ── Knob panel ────────────────────────────────────────────────────────

function KnobRow({ label, value, active }: { label: string; value: string; active: boolean }) {
  return (
    <text>
      <span fg={active ? C.accent : C.dim}>{active ? "▸ " : "  "}</span>
      <span fg={active ? C.fg : C.dim}>{label.padEnd(8)}</span>
      <span fg={active ? C.accent : C.fg}>{value}</span>
    </text>
  );
}

// ── App ───────────────────────────────────────────────────────────────

function App() {
  const renderer = useRenderer();
  const cache = useRef(new PngCache()).current;
  useEffect(() => () => cache.dispose(), [cache]);

  const [knobs, setKnobs] = useState<Knobs>(DEFAULT_KNOBS);
  const [stateIdx, setStateIdx] = useState(0);
  const [sel, setSel] = useState(0);
  const [clip, setClip] = useState<Clip | null>(null);
  const [msg, setMsg] = useState("");

  const cur: Found = found[stateIdx]!;
  const gen = useRef(0);

  // Re-rasterize on state or knob change. ffmpeg output is cached per
  // (mp4, fps), so only chafa re-runs for non-fps knob changes.
  useEffect(() => {
    const g = ++gen.current;
    setClip(null);
    queueMicrotask(() => {
      try {
        const c = renderState(cur, knobs, cache);
        if (gen.current === g) setClip(c);
      } catch (e) {
        if (gen.current === g) setMsg(`✗ ${(e as Error).message}`);
      }
    });
  }, [cur, knobs, cache]);

  const cmd = useMemo(
    () => command(src.replace(process.env.HOME ?? "", "~"),
                  outPath.replace(process.env.HOME ?? "", "~"),
                  avatarName, knobs),
    [knobs],
  );

  const write = () => {
    setMsg("packing…");
    try {
      const states = found.map(f => {
        const { frames, loopFrom } = renderState(f, knobs, cache);
        const fs: EikonFrame[] = frames.map((data, i) => ({ f: i, data }));
        return { state: f.state, fps: knobs.fps, frame_count: fs.length, loop_from: loopFrom, frames: fs };
      });
      const doc: Eikon = {
        header: {
          eikon: 1, name: avatarName, width: knobs.width, height: knobs.height,
          author: process.env.USER ?? "unknown", created: new Date().toISOString(),
        },
        states,
      };
      const txt = serializeEikon(doc);
      writeFileSync(outPath, txt, "utf8");
      setMsg(`✓ wrote ${outPath.replace(process.env.HOME ?? "", "~")}  (${(txt.length / 1024).toFixed(0)} KB)`);
    } catch (e) {
      setMsg(`✗ ${(e as Error).message}`);
    }
  };

  const copyCmd = () => {
    const tools: [string, string[]][] = [["wl-copy", []], ["pbcopy", []], ["xclip", ["-selection", "clipboard"]]];
    for (const [bin, args] of tools) {
      const r = spawnSync(bin, args, { input: cmd });
      if (r.status === 0) { setMsg(`✓ copied: ${bin}`); return; }
    }
    setMsg("✗ no clipboard tool (wl-copy/pbcopy/xclip)");
  };

  useKeyboard((key) => {
    if (key.name === "q" || (key.ctrl && key.name === "c")) { cache.dispose(); renderer.destroy(); return; }
    if (key.name === "tab" || key.name === "right")
      return setStateIdx(i => (i + (key.shift ? -1 : 1) + found.length) % found.length);
    if (key.name === "left")
      return setStateIdx(i => (i - 1 + found.length) % found.length);
    if (key.name === "up")    return setSel(s => (s - 1 + KNOB_KEYS.length) % KNOB_KEYS.length);
    if (key.name === "down")  return setSel(s => (s + 1) % KNOB_KEYS.length);
    if (key.name === "h" || key.name === "j") return setKnobs(k => step(k, KNOB_KEYS[sel]!, -1));
    if (key.name === "l" || key.name === "k" || key.name === "space")
      return setKnobs(k => step(k, KNOB_KEYS[sel]!, 1));
    if (key.name === "r") return setKnobs(DEFAULT_KNOBS);
    if (key.name === "w") return write();
    if (key.name === "c") return copyCmd();
  });

  return (
    <box flexDirection="column" flexGrow={1} backgroundColor={C.bg}>
      <box justifyContent="center">
        <text>
          <span fg={C.accent}>⬡ </span>
          <span fg={C.fg}>eikon author</span>
          <span fg={C.dim}> — </span>
          <span fg={C.fg}>{avatarName}</span>
          <span fg={C.dim}>{`  ·  ${knobs.width}×${knobs.height}@${knobs.fps}`}</span>
        </text>
      </box>

      <box justifyContent="center" marginTop={1}>
        {found.map((f, i) => (
          <text key={f.state}>
            <span fg={i === stateIdx ? C.bg : C.dim} bg={i === stateIdx ? C.accent : undefined}>
              {` ${f.state} `}
            </span>
            <span> </span>
          </text>
        ))}
      </box>

      <box flexDirection="row" flexGrow={1} marginTop={1}>
        <box flexGrow={1} justifyContent="center" alignItems="center">
          <Player clip={clip} fps={knobs.fps} tint={knobs.colors === "none"} />
        </box>
        <box flexDirection="column" paddingX={2} border={["left"]} borderColor={C.faint}>
          <text fg={C.dim}>knobs</text>
          <box marginTop={1} flexDirection="column">
            <KnobRow label="width"   value={String(knobs.width)}  active={sel === 0} />
            <KnobRow label="height"  value={String(knobs.height)} active={sel === 1} />
            <KnobRow label="fps"     value={String(knobs.fps)}    active={sel === 2} />
            <KnobRow label="symbols" value={knobs.symbols}         active={sel === 3} />
            <KnobRow label="colors"  value={knobs.colors}          active={sel === 4} />
            <KnobRow label="dither"  value={knobs.dither}          active={sel === 5} />
            <KnobRow label="invert"  value={knobs.invert ? "on" : "off"} active={sel === 6} />
          </box>
          <box marginTop={1} flexDirection="column">
            <text fg={C.faint}>←/→  state</text>
            <text fg={C.faint}>↑/↓  select knob</text>
            <text fg={C.faint}>h/l  change value</text>
            <text fg={C.faint}>r    reset</text>
            <text fg={C.faint}>w    write .eikon</text>
            <text fg={C.faint}>c    copy CLI cmd</text>
            <text fg={C.faint}>q    quit</text>
          </box>
        </box>
      </box>

      <box flexDirection="column" paddingX={1}>
        <text fg={msg.startsWith("✗") ? C.warn : C.ok}>{msg || " "}</text>
        <text fg={C.faint}>{cmd}</text>
      </box>
    </box>
  );
}

const renderer = await createCliRenderer();
createRoot(renderer).render(<App />);
