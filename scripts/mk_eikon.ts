#!/usr/bin/env bun
/**
 * mk_eikon.ts — mp4 state clips → .eikon
 *
 * Reads <src>/<state>/{start.mp4,loop.mp4} (or <src>/<state>.mp4 for a
 * plain looping state), rasterizes each frame through ffmpeg → chafa at
 * a fixed column width, and emits a single .eikon NDJSON file with
 * `loop_from` set to the intro length.
 *
 * Authoring knobs (symbols, colors, dither, width) live here. Players
 * are dumb: they just replay the baked text.
 *
 * Usage:
 *   bun scripts/mk_eikon.ts <src-dir> [out.eikon] \
 *     [--name N] [--width 48] [--height 24] [--fps 16] \
 *     [--symbols block] [--colors none|full] [--dither none]
 */

import { serializeEikon, type Eikon, type EikonState, type EikonFrame } from "../preview/src/eikon.ts";
import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, mkdtempSync, rmSync, writeFileSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join, resolve } from "node:path";

// ── Config ────────────────────────────────────────────────────────────

const STATE_ORDER = ["idle", "listening", "thinking", "speaking", "working", "error"];

const COLORS: Record<string, string> = {
  idle: "#7aa2f7", listening: "#9ece6a", thinking: "#e0af68",
  speaking: "#bb9af7", working: "#ff9e64", error: "#f7768e",
};

type Opts = {
  src: string; out: string; name: string;
  width: number; height: number; fps: number;
  symbols: string; colors: string; dither: string;
};

// ── CLI ───────────────────────────────────────────────────────────────

function parseArgs(): Opts {
  const a = process.argv.slice(2);
  const pos: string[] = [];
  const kv: Record<string, string> = {};
  for (let i = 0; i < a.length; i++) {
    if (a[i].startsWith("--")) kv[a[i].slice(2)] = a[++i] ?? "";
    else pos.push(a[i]);
  }
  const src = resolve(pos[0] ?? die("usage: mk_eikon <src-dir> [out.eikon]"));
  const name = kv.name ?? basename(dirname(src.endsWith("/") ? src.slice(0, -1) : src));
  const out = resolve(pos[1] ?? join(dirname(src), `${name}.eikon`));
  return {
    src, out, name,
    width: +(kv.width ?? 48), height: +(kv.height ?? 24), fps: +(kv.fps ?? 16),
    symbols: kv.symbols ?? "block", colors: kv.colors ?? "none", dither: kv.dither ?? "none",
  };
}

function die(msg: string): never { console.error(`mk_eikon: ${msg}`); process.exit(1); }

function which(bin: string): string {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) die(`'${bin}' not found on PATH`);
  return r.stdout.trim();
}

// ── Pipeline ──────────────────────────────────────────────────────────

/** ffmpeg mp4 → N pngs at `fps` into a tmpdir; returns sorted paths. */
function extract(mp4: string, fps: number): { dir: string; pngs: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "eikon-"));
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", mp4,
    "-vf", `fps=${fps}`, "-q:v", "2",
    join(dir, "f_%04d.png"),
  ]);
  if (r.status !== 0) die(`ffmpeg failed on ${mp4}: ${r.stderr?.toString()}`);
  const pngs = readdirSync(dir).filter(f => f.endsWith(".png")).sort().map(f => join(dir, f));
  if (pngs.length === 0) die(`ffmpeg extracted 0 frames from ${mp4}`);
  return { dir, pngs };
}

/** chafa one png → exactly H rows of W columns, right-padded. */
function rasterize(png: string, o: Opts): string {
  const r = spawnSync("chafa", [
    `--size=${o.width}x${o.height}`,
    "--format=symbols",
    "--stretch",                 // fill W×H exactly; source is square so fine
    `--symbols=${o.symbols}`,
    `--colors=${o.colors}`,
    `--dither=${o.dither}`,
    png,
  ], { encoding: "utf8" });
  if (r.status !== 0) die(`chafa failed on ${png}: ${r.stderr}`);
  const rows = r.stdout.replace(/\n$/, "").split("\n");
  while (rows.length < o.height) rows.push("");
  return rows.slice(0, o.height).map(l => l.padEnd(o.width).slice(0, o.width)).join("\n");
}

function clip(mp4: string, o: Opts): string[] {
  const { dir, pngs } = extract(mp4, o.fps);
  const frames = pngs.map(p => rasterize(p, o));
  rmSync(dir, { recursive: true, force: true });
  return frames;
}

type Found = { state: string; start?: string; loop?: string };

/** Discover states. Directory form encodes intent:
 *    start.mp4 only → play once, hold last frame
 *    loop.mp4  only → loop whole sequence
 *    both           → intro (start) then loop
 *  Flat <state>.mp4 → loop whole sequence (legacy). */
function discover(src: string): Found[] {
  const entries = readdirSync(src, { withFileTypes: true });
  const out: Found[] = [];
  for (const e of entries) {
    if (e.isDirectory()) {
      const d = join(src, e.name);
      const start = existsSync(join(d, "start.mp4")) ? join(d, "start.mp4") : undefined;
      const loop = existsSync(join(d, "loop.mp4")) ? join(d, "loop.mp4") : undefined;
      if (start || loop) out.push({ state: e.name, start, loop });
    } else if (e.isFile() && e.name.endsWith(".mp4")) {
      out.push({ state: e.name.slice(0, -4), loop: join(src, e.name) });
    }
  }
  const rank = (s: string) => { const i = STATE_ORDER.indexOf(s); return i < 0 ? 99 : i; };
  return out.sort((a, b) => rank(a.state) - rank(b.state) || a.state.localeCompare(b.state));
}

// ── Main ──────────────────────────────────────────────────────────────

const o = parseArgs();
which("ffmpeg"); which("chafa");
if (!existsSync(o.src) || !statSync(o.src).isDirectory()) die(`not a directory: ${o.src}`);

const found = discover(o.src);
if (found.length === 0) die(`no states under ${o.src}`);

console.log(`mk_eikon: ${o.name} → ${o.width}×${o.height}@${o.fps} symbols=${o.symbols} colors=${o.colors}`);

const states: EikonState[] = [];
for (const f of found) {
  const intro = f.start ? clip(f.start, o) : [];
  const loop = f.loop ? clip(f.loop, o) : [];
  const all = [...intro, ...loop];
  const loop_from = f.loop ? intro.length : all.length;   // no loop clip → hold
  const frames: EikonFrame[] = all.map((data, i) => ({ f: i, data }));
  states.push({
    state: f.state, fps: o.fps, color: COLORS[f.state], frame_count: frames.length,
    loop_from, frames,
  });
  const tag = loop_from === 0 ? "loop" : loop_from === frames.length ? "hold" : `intro ${loop_from} + loop ${frames.length - loop_from}`;
  console.log(`  ${f.state.padEnd(10)} ${String(frames.length).padStart(3)}f  ${tag}`);
}

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
