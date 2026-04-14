"""Agent avatar states and their prompt directions."""

STATES: dict[str, str] = {
    "idle": (
        "Subtle breathing, micro-movements, occasional blinks. "
        "Slight weight shifts. Relaxed neutral expression. Calm energy. "
        "Very subtle — barely perceptible motion."
    ),
    "listening": (
        "Head slightly tilted, eyes focused forward, attentive posture. "
        "Occasional small nods. Mouth closed. Alert but still energy."
    ),
    "thinking": (
        "Gaze drifts slightly up-right. Subtle lip compression. Slight squint. "
        "Contemplative energy. Slower movements than idle."
    ),
    "speaking": (
        "Mouth moves in natural talking motion. Head and eyebrow gestures "
        "for emphasis. Direct eye contact about 60% of the time. "
        "More energetic than idle."
    ),
    "working": (
        "Focused gaze, slightly downward. Determined expression. "
        "Busy energy — typing or concentrating feel. More active than thinking."
    ),
    "error": (
        "Slight wince, apologetic expression. One eyebrow raised. "
        "Brief head shake. Settles back toward neutral."
    ),
}

ALL_STATES = list(STATES.keys())
