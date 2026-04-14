"""Step 1: Analyze input image to produce a stable subject description."""

from pathlib import Path

from google import genai
from google.genai import types


DESCRIBE_PROMPT = (
    "Describe this character's appearance in detail for video generation: "
    "hair color/style, eye color, clothing, art style, skin tone, "
    "distinguishing features. Be specific and concise. "
    "Do not describe pose or expression — only stable appearance traits."
)


def describe(client: genai.Client, image_path: Path, model: str) -> str:
    """Use Gemini vision to describe the avatar's appearance."""
    image = types.Part.from_bytes(
        data=image_path.read_bytes(),
        mime_type=_mime(image_path),
    )
    response = client.models.generate_content(
        model=model,
        contents=[image, DESCRIBE_PROMPT],
    )
    return response.text.strip()


def _mime(path: Path) -> str:
    ext = path.suffix.lower()
    return {
        ".png": "image/png",
        ".jpg": "image/jpeg",
        ".jpeg": "image/jpeg",
        ".webp": "image/webp",
    }.get(ext, "image/png")
