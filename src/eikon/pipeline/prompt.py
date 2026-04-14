"""Step 2: Build Veo prompts from subject description + state direction."""

from ..states import STATES

FRAME_DIRECTIVE = (
    "Head and shoulders portrait, centered in frame. Subject fills the middle "
    "third of the frame vertically. Clean solid neutral background. Static camera, "
    "no pans, zooms, or camera movement. No full body shot. Subtle natural "
    "movements only — breathing, micro-expressions, blinks. Smooth, continuous "
    "motion suitable for seamless looping."
)


def build(subject: str, state: str) -> str:
    """Build a complete Veo prompt for a given state."""
    direction = STATES[state]
    return f"{subject}\n\n{direction}\n\n{FRAME_DIRECTIVE}"


def build_all(subject: str) -> dict[str, str]:
    """Build prompts for all 6 states."""
    return {state: build(subject, state) for state in STATES}
