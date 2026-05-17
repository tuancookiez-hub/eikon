"""Generate manifest.json for an eikon directory.

Writes the shape documented in docs/MANIFEST.md — `{name, version,
source, states:{<k>:{file}}}`. scripts/mk_manifest.ts is the canonical
generator for the tracked eikons/; this exists so `uv run eikon` can
emit a compatible manifest during i2v authoring.
"""

import json
from pathlib import Path

from ..states import ALL_STATES


def write(dir: Path, name: str) -> Path:
    states = {}
    for st in ALL_STATES:
        for pick in ("loop.mp4", "start.mp4"):
            if (dir / "states" / st / pick).exists():
                states[st] = {"file": f"states/{st}/{pick}"}
                break
    src = next((f for f in ("base.png", "source.png") if (dir / f).exists()), None)
    man = {"name": name, "version": 1, **({"source": src} if src else {}), "states": states}
    out = dir / "manifest.json"
    out.write_text(json.dumps(man, indent=2) + "\n")
    return out
