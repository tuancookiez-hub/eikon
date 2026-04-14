#!/usr/bin/env python3
"""Convert eikon state videos to ASCII frames for herm TUI avatar."""

import os
import sys
import subprocess
import numpy as np
from PIL import Image
from concurrent.futures import ProcessPoolExecutor
from pathlib import Path

# ─── Config ───────────────────────────────────────────────────────────

ASCII_WIDTH = 48
ASCII_HEIGHT = 24
FPS = 12
CHAR_PALETTE = " .:-=+*#%@"  # space for black, @ for white (inverted)

# ─── Core ─────────────────────────────────────────────────────────────

def extract(video: Path, out: Path, fps: int) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y", "-i", str(video),
        "-vf", f"fps={fps}",
        "-q:v", "2",
        str(out / "frame_%04d.png"),
    ], check=True, capture_output=True)
    return sorted(out.glob("frame_*.png"))


def to_ascii(path: Path, invert: bool = True) -> str:
    img = Image.open(path).convert("L")
    img = img.resize((ASCII_WIDTH, ASCII_HEIGHT), Image.Resampling.LANCZOS)
    px = np.array(img, dtype=float) / 255.0

    if invert:
        # Source is black-on-white. Invert so black bg, white subject.
        px = 1.0 - px

    # Gamma
    px = np.power(px, 0.8)
    idx = (px * (len(CHAR_PALETTE) - 1)).astype(int)
    return "\n".join("".join(CHAR_PALETTE[c] for c in row) for row in idx)


def convert_state(video: Path, out: Path, invert: bool = True) -> list[str]:
    tmp = out / "_tmp"
    pngs = extract(video, tmp, FPS)
    frames = []
    for p in pngs:
        frames.append(to_ascii(p, invert))
        p.unlink()
    tmp.rmdir()
    return frames


def write_ts(states: dict[str, list[str]], out: Path):
    """Write a TypeScript module per state, matching herm avatar-frames format."""
    out.mkdir(parents=True, exist_ok=True)

    for state, frames in states.items():
        lines = ["// Auto-generated ASCII avatar frames"]
        lines.append(f"export const FRAMES: string[] = [")
        for f in frames:
            escaped = f.replace("\\", "\\\\").replace("`", "\\`").replace("$", "\\$")
            lines.append(f"  `{escaped}`,")
        lines.append("];")
        lines.append(f"export const FRAME_COUNT = FRAMES.length;")
        lines.append(f"export const FPS = {FPS};")
        lines.append(f"export const FRAME_WIDTH = {ASCII_WIDTH};")
        lines.append(f"export const FRAME_HEIGHT = {ASCII_HEIGHT};")
        lines.append("")

        (out / f"{state}.ts").write_text("\n".join(lines))
        print(f"  ✓ {state}.ts ({len(frames)} frames)")


def main():
    avatar = sys.argv[1] if len(sys.argv) > 1 else "nous-girl"
    base = Path.home() / "Dev" / "eikon" / "avatars" / avatar
    states_dir = base / "states"
    out = base / "ascii"

    if not states_dir.exists():
        print(f"No states at {states_dir}")
        sys.exit(1)

    invert = "--no-invert" not in sys.argv

    print(f"Converting {avatar} to ASCII (invert={invert})")
    print(f"  {ASCII_WIDTH}x{ASCII_HEIGHT} @ {FPS}fps")
    print(f"  palette: '{CHAR_PALETTE}'")
    print()

    all_states = {}
    for mp4 in sorted(states_dir.glob("*.mp4")):
        state = mp4.stem
        print(f"  Converting: {state}")
        all_states[state] = convert_state(mp4, out, invert)

    print()
    write_ts(all_states, out)
    print(f"\nDone! ASCII frames at {out}")


if __name__ == "__main__":
    main()
