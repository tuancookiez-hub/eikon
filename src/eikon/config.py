"""Configuration loading and defaults."""

import os
from pathlib import Path
from dataclasses import dataclass, field

import yaml


DEFAULTS = {
    "output_dir": str(Path.home() / "Dev" / "eikon" / "avatars"),
    "veo": {
        "model": "veo-3.1-lite-generate-001",
        "vision_model": "gemini-2.5-flash",
    },
    "generation": {
        "aspect_ratio": "9:16",
        "resolution": "720p",
        "duration": 4,
        "audio": False,
        "seed": None,
        "negative_prompt": (
            "camera movement, zoom, pan, tilt, background change, "
            "full body shot, legs, scene transition, "
            "border, frame, outline around image, black border, vignette"
        ),
    },
    "crop": {
        "target_resolution": 720,
        "offset_y": 280,
    },
}


@dataclass
class VeoConfig:
    model: str = "veo-3.1-lite-generate-001"
    vision_model: str = "gemini-2.5-flash"


@dataclass
class GenerationConfig:
    aspect_ratio: str = "9:16"
    resolution: str = "720p"
    duration: int = 4
    audio: bool = False
    seed: int | None = None
    negative_prompt: str = (
        "camera movement, zoom, pan, tilt, background change, "
        "full body shot, legs, scene transition, "
        "border, frame, outline around image, black border, vignette"
    )


@dataclass
class CropConfig:
    target_resolution: int = 720
    offset_y: int = 280


@dataclass
class Config:
    output_dir: Path = field(default_factory=lambda: Path.home() / "Dev" / "eikon" / "avatars")
    veo: VeoConfig = field(default_factory=VeoConfig)
    generation: GenerationConfig = field(default_factory=GenerationConfig)
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
    if "veo" in raw:
        v = raw["veo"]
        if "model" in v:
            cfg.veo.model = v["model"]
        if "vision_model" in v:
            cfg.veo.vision_model = v["vision_model"]
    if "generation" in raw:
        g = raw["generation"]
        for attr in ("aspect_ratio", "resolution", "duration", "audio", "seed", "negative_prompt"):
            if attr in g:
                setattr(cfg.generation, attr, g[attr])
    if "crop" in raw:
        c = raw["crop"]
        for attr in ("target_resolution", "offset_y"):
            if attr in c:
                setattr(cfg.crop, attr, c[attr])

    return cfg
