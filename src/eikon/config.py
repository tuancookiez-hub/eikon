"""Configuration loading and defaults."""

from pathlib import Path
from dataclasses import dataclass, field

import yaml


@dataclass
class CropConfig:
    target_resolution: int = 720
    offset_y: int = 280


@dataclass
class Config:
    output_dir: Path = field(default_factory=lambda: Path.home() / "Dev" / "eikon" / "eikons")
    crop: CropConfig = field(default_factory=CropConfig)


CONFIG_PATH = Path.home() / ".eikon" / "config.yaml"


def load() -> Config:
    """Load config from ~/.eikon/config.yaml, falling back to defaults."""
    cfg = Config()

    if not CONFIG_PATH.exists():
        return cfg

    try:
        raw = yaml.safe_load(CONFIG_PATH.read_text()) or {}
    except Exception:
        return cfg

    if "output_dir" in raw:
        cfg.output_dir = Path(raw["output_dir"]).expanduser()
    if "crop" in raw:
        c = raw["crop"]
        for attr in ("target_resolution", "offset_y"):
            if attr in c:
                setattr(cfg.crop, attr, c[attr])

    return cfg
