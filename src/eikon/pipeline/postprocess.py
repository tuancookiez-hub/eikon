"""Step 4: Post-process raw videos — crop, verify loop, extract thumbnails."""

import subprocess
from pathlib import Path

from ..config import CropConfig


def crop(raw: Path, output: Path, cfg: CropConfig) -> Path:
    """Center-crop 9:16 video to 1:1."""
    res = cfg.target_resolution
    offset = cfg.offset_y
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(raw),
            "-vf", f"crop={res}:{res}:0:{offset}",
            "-an",
            "-c:v", "libx264", "-crf", "18",
            str(output),
        ],
        check=True,
        capture_output=True,
    )
    return output


def thumbnail(video: Path, output: Path) -> Path:
    """Extract first frame as PNG thumbnail."""
    output.parent.mkdir(parents=True, exist_ok=True)
    subprocess.run(
        [
            "ffmpeg", "-y", "-i", str(video),
            "-vframes", "1", "-q:v", "2",
            str(output),
        ],
        check=True,
        capture_output=True,
    )
    return output


def process_all(
    raw_dir: Path,
    states_dir: Path,
    thumbs_dir: Path,
    cfg: CropConfig,
    states: list[str],
) -> None:
    """Post-process all raw videos."""
    for state in states:
        raw = raw_dir / f"{state}.mp4"
        if not raw.exists():
            continue
        out = states_dir / f"{state}.mp4"
        crop(raw, out, cfg)
        thumb = thumbs_dir / f"{state}.png"
        thumbnail(out, thumb)
