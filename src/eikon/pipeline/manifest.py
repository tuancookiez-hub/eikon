"""Generate manifest.json for an avatar directory."""

import json
from datetime import datetime, timezone
from pathlib import Path

from ..config import Config
from ..states import ALL_STATES


def write(avatar_dir: Path, name: str, cfg: Config) -> Path:
    """Write manifest.json to the avatar directory."""
    manifest = {
        "name": name,
        "version": 1,
        "created": datetime.now(timezone.utc).isoformat(),
        "source": "source.png",
        "spec": {
            "final_resolution": f"{cfg.crop.target_resolution}x{cfg.crop.target_resolution}",
            "final_aspect_ratio": "1:1",
            "crop_offset_y": cfg.crop.offset_y,
            "format": "mp4",
        },
        "states": {},
    }

    for state in ALL_STATES:
        video = avatar_dir / "states" / f"{state}.mp4"
        manifest["states"][state] = {
            "raw": f"raw/{state}.mp4",
            "file": f"states/{state}.mp4",
            "thumbnail": f"thumbnails/{state}.png",
            "exists": video.exists(),
        }

    out = avatar_dir / "manifest.json"
    out.write_text(json.dumps(manifest, indent=2))
    return out
