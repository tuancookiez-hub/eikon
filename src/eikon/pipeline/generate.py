"""Step 3: Generate videos via Veo."""

import time
from pathlib import Path

from google import genai
from google.genai import types
from rich.console import Console

from ..config import Config

console = Console()


def generate(
    client: genai.Client,
    prompt: str,
    image_path: Path,
    output_path: Path,
    cfg: Config,
) -> Path:
    """Generate a single state video. Blocks until complete."""
    image = types.Image(
        image_bytes=image_path.read_bytes(),
        mime_type="image/png",
    )

    operation = client.models.generate_videos(
        model=cfg.veo.model,
        prompt=prompt,
        image=image,
        config=types.GenerateVideosConfig(
            aspect_ratio=cfg.generation.aspect_ratio,
            duration_seconds=cfg.generation.duration,
            resolution=cfg.generation.resolution,
            generate_audio=cfg.generation.audio,
            person_generation="allow_adult",
            negative_prompt=cfg.generation.negative_prompt,
            seed=cfg.generation.seed,
            number_of_videos=1,
            last_frame=image,  # Same image → loop interpolation
        ),
    )

    # Poll until done
    console.print("  ⏳ Waiting for Veo...", style="dim")
    while not operation.done:
        time.sleep(5)
        operation = client.operations.get(operation)

    # Check for errors
    if operation.error:
        raise RuntimeError(f"Veo error: {operation.error}")
    if not operation.result:
        raise RuntimeError(f"Veo returned no result. Operation: {operation}")
    if not operation.result.generated_videos:
        filtered = getattr(operation.result, "rai_media_filtered_count", None)
        reasons = getattr(operation.result, "rai_media_filtered_reasons", None)
        raise RuntimeError(
            f"Veo generated no videos. "
            f"RAI filtered: {filtered}, reasons: {reasons}"
        )

    # Download result
    video = operation.result.generated_videos[0].video
    output_path.parent.mkdir(parents=True, exist_ok=True)

    # The SDK returns video bytes or a URI
    if video.video_bytes:
        output_path.write_bytes(video.video_bytes)
    elif video.uri:
        import urllib.request
        urllib.request.urlretrieve(video.uri, str(output_path))
    else:
        raise RuntimeError("Veo returned no video data")

    return output_path


def generate_all(
    client: genai.Client,
    prompts: dict[str, str],
    image_path: Path,
    raw_dir: Path,
    cfg: Config,
) -> dict[str, Path]:
    """Generate all state videos. Returns {state: path}."""
    results = {}
    for state, prompt in prompts.items():
        console.print(f"[bold cyan]Generating:[/] {state}")
        out = raw_dir / f"{state}.mp4"
        generate(client, prompt, image_path, out, cfg)
        results[state] = out
        console.print(f"  [green]✓[/] {out.name}")
    return results
