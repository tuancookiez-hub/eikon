#!/usr/bin/env bun
/**
 * mk_eikon.ts — mp4 state clips → .eikon
 *
 * Reads <src>/<state>/{start.mp4,loop.mp4} (or <src>/<state>.mp4 for a
 * plain looping state), rasterizes each frame through ffmpeg → chafa at
 * a fixed column width, and emits a single .eikon NDJSON file with
 * `loop_from` set to the intro length.
 *
 * Authoring knobs (symbols, colors, dither, width, invert) live here.
 * Players are dumb: they just replay the baked text. Use
 * `bun preview/src/author.tsx <src>` to tune knobs interactively.
 *
 * Usage:
 *   bun scripts/mk_eikon.ts <src-dir> [out.eikon] \
 *     [--name N] [--width 48] [--height 24] [--fps 16] \
 *     [--symbols block] [--colors none|full] [--dither none] [--no-invert]
 */

import { serializeEikon, type Eikon, type EikonState, type EikonFrame } from "../preview/src/eikon.ts";
import { discover, renderState, PngCache, which, DEFAULT_KNOBS, type Knobs } from "./lib.ts";
import { existsSync, writeFileSync, statSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";

const STATE_COLORS: Record<string, string> = {
  idle: "#7aa2f7", listening: "#9ece6a", thinking: "#e0af68",
  speaking: "#bb9af7", working: "#ff9e64", error: "#f7768e",
};

type Opts = Knobs & { src: string; out: string; name: string };

function parseArgs(): Opts {
  const a = process.argv.slice(2);
  const pos: string[] = [];
  const kv: Record<string, string> = {};
  const flags = new Set<string>();
  for (let i = 0; i < a.length; i++) {
    if (a[i]!.startsWith("--")) {
      const k = a[i]!.slice(2);
      if (a[i + 1] === undefined || a[i + 1]!.startsWith("--")) flags.add(k);
      else kv[k] = a[++i]!;
    } else pos.push(a[i]!);
  }
  const src = resolve(pos[0] ?? die("usage: mk_eikon <src-dir> [out.eikon]"));
  const name = kv.name ?? basename(dirname(src.replace(/\/$/, "")));
  const out = resolve(pos[1] ?? join(dirname(src), `${name}.eikon`));
  return {
    src, out, name,
    width: +(kv.width ?? DEFAULT_KNOBS.width),
    height: +(kv.height ?? DEFAULT_KNOBS.height),
    fps: +(kv.fps ?? DEFAULT_KNOBS.fps),
    symbols: (kv.symbols ?? DEFAULT_KNOBS.symbols) as Knobs["symbols"],
    colors: (kv.colors ?? DEFAULT_KNOBS.colors) as Knobs["colors"],
    dither: (kv.dither ?? DEFAULT_KNOBS.dither) as Knobs["dither"],
    invert: !flags.has("no-invert"),
  };
}

function die(msg: string): never { console.error(`mk_eikon: ${msg}`); process.exit(1); }

const o = parseArgs();
which("ffmpeg"); which("chafa");
if (!existsSync(o.src) || !statSync(o.src).isDirectory()) die(`not a directory: ${o.src}`);

const found = discover(o.src);
if (found.length === 0) die(`no states under ${o.src}`);

console.log(`mk_eikon: ${o.name} → ${o.width}×${o.height}@${o.fps} symbols=${o.symbols} colors=${o.colors}${o.invert ? " invert" : ""}`);

const cache = new PngCache();
const states: EikonState[] = [];
for (const f of found) {
  const { frames, loopFrom } = renderState(f, o, cache);
  const fs: EikonFrame[] = frames.map((data, i) => ({ f: i, data }));
  states.push({
    state: f.state, fps: o.fps, color: STATE_COLORS[f.state], frame_count: fs.length,
    loop_from: loopFrom, frames: fs,
  });
  const tag = loopFrom === 0 ? "loop" : loopFrom === fs.length ? "hold" : `intro ${loopFrom} + loop ${fs.length - loopFrom}`;
  console.log(`  ${f.state.padEnd(10)} ${String(fs.length).padStart(3)}f  ${tag}`);
}
cache.dispose();

const doc: Eikon = {
  header: {
    eikon: 1, name: o.name, width: o.width, height: o.height,
    author: process.env.USER ?? "unknown", created: new Date().toISOString(),
  },
  states,
};

const text = serializeEikon(doc);
writeFileSync(o.out, text, "utf8");
const total = states.reduce((s, st) => s + st.frame_count, 0);
console.log(`\nwrote ${o.out}  (${states.length} states, ${total} frames, ${(text.length / 1024).toFixed(1)} KB)`);
