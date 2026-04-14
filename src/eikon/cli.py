"""Eikon CLI — avatar video generation."""

import json
import shutil
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
    """Eikon — Video-state generation for AI avatars."""


@cli.command()
@click.option("--input", "-i", "image", required=True, type=click.Path(exists=True, path_type=Path),
              help="Input avatar image (PNG)")
@click.option("--name", "-n", required=True, help="Avatar name")
@click.option("--state", "-s", multiple=True, type=click.Choice(ALL_STATES),
              help="Generate specific state(s). Omit for all 6.")
@click.option("--seed", type=int, default=None, help="Seed for generation")
@click.option("--raw-only", is_flag=True, help="Skip post-processing")
def generate(image: Path, name: str, state: tuple[str, ...], seed: int | None, raw_only: bool):
    """Generate state videos for an avatar."""
    from .client import create
    from .pipeline import describe, prompt, generate as gen, postprocess, manifest

    cfg = load()
    if seed is not None:
        cfg.generation.seed = seed

    states = list(state) if state else ALL_STATES
    avatar_dir = cfg.output_dir / name

    console.print(f"[bold]Eikon[/] v{__version__}")
    console.print(f"  Avatar:  {name}")
    console.print(f"  Input:   {image}")
    console.print(f"  States:  {', '.join(states)}")
    console.print(f"  Output:  {avatar_dir}")
    console.print()

    # Copy source image
    avatar_dir.mkdir(parents=True, exist_ok=True)
    shutil.copy2(image, avatar_dir / "source.png")

    # Step 1: Describe
    client = create(cfg)
    console.print("[bold cyan]Step 1:[/] Analyzing avatar image...")
    subject = describe.describe(client, image, cfg.veo.vision_model)
    console.print(f"  [green]✓[/] Subject: {subject[:80]}...")
    console.print()

    # Step 2: Build prompts
    console.print("[bold cyan]Step 2:[/] Building prompts...")
    prompts = {s: prompt.build(subject, s) for s in states}
    console.print(f"  [green]✓[/] {len(prompts)} prompts ready")
    console.print()

    # Step 3: Generate
    console.print("[bold cyan]Step 3:[/] Generating videos via Veo 3.1 Fast...")
    raw_dir = avatar_dir / "raw"
    results = gen.generate_all(client, prompts, image, raw_dir, cfg)
    console.print(f"  [green]✓[/] {len(results)} videos generated")
    console.print()

    # Step 4: Post-process
    if not raw_only:
        console.print("[bold cyan]Step 4:[/] Post-processing (crop + thumbnails)...")
        postprocess.process_all(
            raw_dir,
            avatar_dir / "states",
            avatar_dir / "thumbnails",
            cfg.crop,
            states,
        )
        console.print(f"  [green]✓[/] Cropped to 1:1, thumbnails extracted")
        console.print()

    # Manifest
    manifest.write(avatar_dir, name, subject, cfg)
    console.print(f"[bold green]Done![/] Avatar ready at {avatar_dir}")


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
    """Re-crop existing raw videos."""
    from .pipeline import postprocess

    cfg = load()
    if offset is not None:
        cfg.crop.offset_y = offset

    avatar_dir = cfg.output_dir / name
    raw_dir = avatar_dir / "raw"
    if not raw_dir.exists():
        console.print(f"[red]No raw videos for '{name}'.[/]")
        raise SystemExit(1)

    console.print(f"Re-cropping {name} (offset_y={cfg.crop.offset_y})...")
    postprocess.process_all(
        raw_dir,
        avatar_dir / "states",
        avatar_dir / "thumbnails",
        cfg.crop,
        ALL_STATES,
    )
    console.print("[bold green]Done![/]")
