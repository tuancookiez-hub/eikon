"""Step 2: Build Veo prompts from state direction + frame directive."""

from ..states import STATES

FRAME_DIRECTIVE = (
    "Head and shoulders portrait, centered in frame. Static camera. "
    "Hair has gentle, smooth bounce and sway throughout — soft natural movement "
    "as if in a light breeze."
)


def build(state: str) -> str:
    """Build a complete Veo prompt for a given state."""
    return f"{STATES[state]}\n\n{FRAME_DIRECTIVE}"


def build_all() -> dict[str, str]:
    """Build prompts for all 6 states."""
    return {state: build(state) for state in STATES}
