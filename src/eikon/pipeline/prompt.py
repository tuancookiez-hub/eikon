"""State directions — backend-agnostic prompts for whatever
image-to-video model you point at the starter image. See
docs/SKILL.md for how these compose with the framing directive."""

from ..states import STATES

FRAME_DIRECTIVE = (
    "Head and shoulders portrait, centered in frame. Static camera. "
    "Hair has gentle, smooth bounce and sway throughout — soft natural movement "
    "as if in a light breeze."
)


def build(state: str) -> str:
    return f"{STATES[state]}\n\n{FRAME_DIRECTIVE}"


def build_all() -> dict[str, str]:
    return {state: build(state) for state in STATES}
