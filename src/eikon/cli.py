"""Eikon CLI — post-process state videos and inspect avatars.

Video generation is out of scope here; bring your own mp4s
(eikons/<name>/raw/<state>.mp4) and this tool handles the
crop → states/ → .eikon tail. See docs/SKILL.md for the
authoring workflow.
"""

import json
from pathlib import Path

import click
from rich.console import Console
from rich.table import Table

from . import __version__
from .config import load
from .states import ALL_STATES

console = Console()


@click.group()
@click.version_option(__version__)
def cli():
    """Eikon — stateful ASCII avatars."""


@cli.command("list")
def list_avatars():
    """List available avatars."""
    cfg = load()
    if not cfg.output_dir.exists():
        console.print("[dim]No avatars found.[/]")
        return

    table = Table(title="Avatars")
    table.add_column("Name", style="cyan")
    table.add_column("States", justify="right")
    table.add_column("Created")

    for d in sorted(cfg.output_dir.iterdir()):
        manifest_path = d / "manifest.json"
        if not manifest_path.exists():
            continue
        data = json.loads(manifest_path.read_text())
        ready = sum(1 for s in data.get("states", {}).values() if s.get("exists"))
        total = len(data.get("states", {}))
        table.add_row(data["name"], f"{ready}/{total}", data.get("created", "?")[:10])

    console.print(table)


@cli.command()
@click.argument("name")
def info(name: str):
    """Show avatar manifest."""
    cfg = load()
    manifest_path = cfg.output_dir / name / "manifest.json"
    if not manifest_path.exists():
        console.print(f"[red]Avatar '{name}' not found.[/]")
        raise SystemExit(1)

    data = json.loads(manifest_path.read_text())
    console.print_json(json.dumps(data, indent=2))


@cli.command()
@click.argument("name")
@click.option("--offset", "-o", type=int, help="Vertical crop offset")
def crop(name: str, offset: int | None):
    """Crop raw/*.mp4 to 1:1 states/ + thumbnails/."""
    from .pipeline import postprocess, manifest

    cfg = load()
    if offset is not None:
        cfg.crop.offset_y = offset

    avatar_dir = cfg.output_dir / name
    raw_dir = avatar_dir / "raw"
    if not raw_dir.exists():
        console.print(f"[red]No raw videos for '{name}'.[/]")
        raise SystemExit(1)

    console.print(f"Cropping {name} (offset_y={cfg.crop.offset_y})...")
    postprocess.process_all(
        raw_dir,
        avatar_dir / "states",
        avatar_dir / "thumbnails",
        cfg.crop,
        ALL_STATES,
    )
    manifest.write(avatar_dir, name, cfg)
    console.print("[bold green]Done![/]")
