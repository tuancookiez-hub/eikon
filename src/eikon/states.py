"""Agent avatar states and their prompt directions."""

STATES: dict[str, str] = {
    "idle": (
        "Relaxed, facing camera. Gentle breathing. "
        "Calm neutral expression, occasional slow blink. Still and centered."
    ),
    "listening": (
        "She reaches her right hand up to the side of her head and grabs "
        "the right headphone ear cup, pulling it away from her ear. "
        "She holds the cup out to the side with her hand raised. "
        "Head faces camera. Attentive expression, mouth closed."
    ),
    "thinking": (
        "Hand rises into frame, index finger pointing to temple. "
        "Head tilts to one side, gaze drifts upward. "
        "Contemplative expression. Forearm and pointed finger visible "
        "against the side of the head — distinct outline change from idle."
    ),
    "speaking": (
        "Mouth moves in natural talking motion. Head and eyebrow gestures "
        "for emphasis. Direct eye contact about 60% of the time. "
        "More energetic than idle."
    ),
    "working": (
        "Head lowers down, looking downward. Chin drops below the frame. "
        "Only the top of the head and hair visible — lofi study girl pose. "
        "Cozy, focused, head-down. Completely different silhouette from idle."
    ),
    "error": (
        "Head pulls back in a recoil. One hand rises into frame palm-out "
        "in a wince/stop gesture near the face. Apologetic expression, "
        "slight head shake. Hand lowers back out of frame, "
        "posture settles toward neutral."
    ),
}

ALL_STATES = list(STATES.keys())
