"""Google GenAI client factory."""

from google import genai

from .config import Config


def create(cfg: Config) -> genai.Client:
    """Create a Google GenAI client from config."""
    if not cfg.api_key:
        raise RuntimeError(
            "GOOGLE_API_KEY not set. "
            "Set it in your environment or in ~/.eikon/.env"
        )
    return genai.Client(api_key=cfg.api_key)
