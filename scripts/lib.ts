/**
 * Shared mp4 → chafa rasterization primitives.
 * Used by both mk_eikon.ts (batch CLI) and preview/src/author.tsx
 * (interactive knob-tuning), so what you preview is what you ship.
 */

import { spawnSync } from "node:child_process";
import { readdirSync, existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export const STATE_ORDER = ["idle", "listening", "thinking", "speaking", "working", "error"];

export const SYMBOLS = ["block", "ascii", "braille", "sextant", "all"] as const;
export const COLORS = ["none", "16", "256", "full"] as const;
export const DITHER = ["none", "ordered", "diffusion"] as const;

export type Knobs = {
  width: number; height: number; fps: number;
  symbols: (typeof SYMBOLS)[number];
  colors: (typeof COLORS)[number];
  dither: (typeof DITHER)[number];
  invert: boolean;
};

export const DEFAULT_KNOBS: Knobs = {
  width: 48, height: 24, fps: 16,
  symbols: "block", colors: "none", dither: "none", invert: true,
};

export type Found = { state: string; start?: string; loop?: string };

/** Discover states under <src>. Directory form encodes playback intent:
 *    start.mp4 only → play once, hold last frame
 *    loop.mp4  only → loop whole sequence
 *    both           → intro (start) then loop
 *  Flat <state>.mp4 → loop whole sequence (legacy). */
export function discover(src: string): Found[] {
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

/** ffmpeg mp4 → N pngs at `fps` into a tmpdir; returns sorted absolute paths. */
export function extract(mp4: string, fps: number): { dir: string; pngs: string[] } {
  const dir = mkdtempSync(join(tmpdir(), "eikon-"));
  const r = spawnSync("ffmpeg", [
    "-hide_banner", "-loglevel", "error", "-i", mp4,
    "-vf", `fps=${fps}`, "-q:v", "2",
    join(dir, "f_%04d.png"),
  ]);
  if (r.status !== 0) throw new Error(`ffmpeg failed on ${mp4}: ${r.stderr?.toString()}`);
  const pngs = readdirSync(dir).filter(f => f.endsWith(".png")).sort().map(f => join(dir, f));
  if (pngs.length === 0) throw new Error(`ffmpeg extracted 0 frames from ${mp4}`);
  return { dir, pngs };
}

/** chafa one png → exactly H rows of W columns, right-padded. */
export function rasterize(png: string, k: Knobs): string {
  const r = spawnSync("chafa", [
    `--size=${k.width}x${k.height}`,
    "--format=symbols",
    "--stretch",
    `--symbols=${k.symbols}`,
    `--colors=${k.colors}`,
    `--dither=${k.dither}`,
    ...(k.invert ? ["--invert"] : []),
    png,
  ], { encoding: "utf8" });
  if (r.status !== 0) throw new Error(`chafa failed on ${png}: ${r.stderr}`);
  const rows = r.stdout.replace(/\n$/, "").split("\n");
  while (rows.length < k.height) rows.push("");
  return rows.slice(0, k.height).map(l => pad(l, k.width)).join("\n");
}

// padEnd/slice by column is wrong when colors != none (SGR escapes have
// zero display width). Only normalize when output is pure text.
function pad(line: string, w: number): string {
  if (line.includes("\x1b[")) return line;
  return line.padEnd(w).slice(0, w);
}

export type Clip = { frames: string[]; loopFrom: number };

/** Rasterize one discovered state at the given knobs. */
export function renderState(f: Found, k: Knobs, pngs: PngCache): Clip {
  const intro = f.start ? pngs.get(f.start, k.fps).map(p => rasterize(p, k)) : [];
  const loop = f.loop ? pngs.get(f.loop, k.fps).map(p => rasterize(p, k)) : [];
  const frames = [...intro, ...loop];
  const loopFrom = f.loop ? intro.length : frames.length;
  return { frames, loopFrom };
}

/** Cache extracted PNGs per (mp4, fps) so knob changes that don't touch
 *  fps re-rasterize without re-running ffmpeg. */
export class PngCache {
  private m = new Map<string, { dir: string; pngs: string[] }>();
  get(mp4: string, fps: number): string[] {
    const key = `${mp4}:${fps}`;
    let e = this.m.get(key);
    if (!e) { e = extract(mp4, fps); this.m.set(key, e); }
    return e.pngs;
  }
  dispose() {
    for (const { dir } of this.m.values()) rmSync(dir, { recursive: true, force: true });
    this.m.clear();
  }
}

export function which(bin: string): void {
  const r = spawnSync("which", [bin], { encoding: "utf8" });
  if (r.status !== 0 || !r.stdout.trim()) throw new Error(`'${bin}' not found on PATH`);
}

/** The mk_eikon CLI invocation that reproduces these knobs. */
export function command(src: string, out: string, name: string, k: Knobs): string {
  const parts = [
    "bun scripts/mk_eikon.ts", src, out,
    "--name", name,
    "--width", String(k.width), "--height", String(k.height), "--fps", String(k.fps),
    "--symbols", k.symbols, "--colors", k.colors, "--dither", k.dither,
  ];
  if (!k.invert) parts.push("--no-invert");
  return parts.join(" ");
}
