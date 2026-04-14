"""Google GenAI client factory — Vertex AI with ADC."""

import os

from google import genai
from google.genai.types import HttpOptions


def create() -> genai.Client:
    """Create a Google GenAI client via Vertex AI (ADC).

    Requires GOOGLE_CLOUD_PROJECT and GOOGLE_CLOUD_LOCATION env vars,
    plus ADC configured via `gcloud auth application-default login`.
    """
    project = os.environ.get("GOOGLE_CLOUD_PROJECT")
    location = os.environ.get("GOOGLE_CLOUD_LOCATION", "us-central1")
    if not project:
        raise RuntimeError(
            "GOOGLE_CLOUD_PROJECT not set. "
            "Set it in your environment or in ~/Dev/eikon/.env"
        )
    return genai.Client(
        vertexai=True,
        project=project,
        location=location,
        http_options=HttpOptions(api_version="v1"),
    )
