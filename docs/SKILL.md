---
name: eikon-avatar-pipeline
description: "End-to-end workflow for creating a 6-state animated ASCII avatar (herma/eikon). From a single starter image, generates state-specific videos via AI, then converts to ASCII frames. Use when: creating avatar animations, building TUI character states, or generating eikon assets."
tags: [eikon, avatar, veo, ascii, animation, states, workflow]
related_skills: [video-to-ascii-frames, google-genai-vertex-ai, ascii-art]
---

# Eikon Avatar Pipeline

Create a 6-state animated ASCII avatar from a single starter image. Each state (idle, listening, thinking, speaking, working, error) gets its own looping animation video, then converted to ASCII frames.

## Phase 0: Starter Image

A starter image is **required** before anything else.

### If the user provides an image
- Use it directly. Prefer **monochrome** images (dark/black background, light foreground) for best ASCII output.
- Portrait orientation, head-and-shoulders framing, neck + head visible, no shoulders.

### If the user does NOT have an image
Ask:
> Do you have a starter image for your avatar, or would you like to generate one?
> For best ASCII results, monochrome images work best — dark/black background with a light foreground subject (think white-on-black illustration style).

If the agent has image generation capabilities (DALL-E, Stable Diffusion, Flux, etc.), offer to generate one. Suggest a prompt like:
> "Monochrome portrait illustration, head and shoulders, [character description], white lines on pure black background, clean lineart style, no background detail, facing camera"

### Image requirements
- Head and shoulders portrait (neck + head, no full body)
- Clean silhouette — the final output is ~48 chars wide, fine detail is lost
- Any props the character wears (headphones, glasses, hat) must be **visually visible** — Veo can't infer hidden items
- PNG format preferred

---

## Phase 1: Video Generation Setup

### Check capabilities
Before generating video, verify the agent has access to a video generation API.

**Default: Google Veo via Vertex AI**

Requirements:
- `google-genai` Python package
- Google Cloud project with Vertex AI enabled
- Authentication (one of):
  - `GOOGLE_APPLICATION_CREDENTIALS` env var pointing to service account JSON
  - `gcloud auth application-default login` (ADC)
  - `GOOGLE_API_KEY` env var (AI Studio path, non-Vertex)

If eikon CLI is installed (`~/Dev/eikon`):
```bash
# Check if eikon is available
cd ~/Dev/eikon && uv run eikon --help
```

If eikon is NOT installed, or the agent is working standalone:
```python
# Minimal Veo generation (no eikon dependency)
from google import genai
from google.genai import types
import base64

client = genai.Client(vertexai=True, project="PROJECT", location="us-central1")

# Load starter image
with open("starter.png", "rb") as f:
    img_bytes = f.read()

response = client.models.generate_videos(
    model="veo-3.1-lite-generate-001",
    image=types.Image(image_bytes=img_bytes, mime_type="image/png"),
    config=types.GenerateVideoConfig(
        aspect_ratio="9:16",
        resolution="720p",
        duration_seconds=4,
        negative_prompt="full body shot, border, frame, outline around image, black border, vignette",
    ),
    prompt="<state prompt here>",
)
# Poll for completion
operation = response
while not operation.done:
    import time; time.sleep(30)
    operation = client.operations.get(operation)
# Save video
video = operation.result.generated_videos[0]
with open("output.mp4", "wb") as f:
    f.write(video.video.video_bytes)
```

### If no video generation is available
Ask the user:
> I don't have access to a video generation API. Options:
> 1. Provide a Google Cloud API key or service account for Veo
> 2. Use a different video gen service you have access to
> 3. Provide pre-made state videos (one per state, ~4s loops)

### Veo model tiers

| Model | Speed | Quality | Use when |
|-------|-------|---------|----------|
| `veo-3.1-lite-generate-001` | Fast | Good for simple motion | Default — head angles, mouth, breathing |
| `veo-3.1-generate-001` | Slower | Better prompt adherence | Complex gestures, hand movements, props |

Always use the latest version available. If newer models exist at time of invocation, prefer them. Use `lite` variant by default.

---

## Phase 2: State Prompt Design

### The 6 states

Every eikon has exactly 6 animation states:

| State | Purpose | Key differentiator |
|-------|---------|-------------------|
| `idle` | Resting/default | Baseline — still, centered, breathing |
| `listening` | Receiving input | Distinct gesture showing attention |
| `thinking` | Processing/reasoning | Hand or head position change |
| `speaking` | Generating response | Mouth movement |
| `working` | Executing tools/tasks | Head-down or focused pose |
| `error` | Something went wrong | Recoil or defensive gesture |

### ASCII-first design principles

The final output is **~48 characters wide**. This means:

✅ **Reads well at ASCII resolution:**
- Head angle changes (tilted, lowered, pulled back)
- Hand/forearm entering frame near face
- Distinct pose silhouettes (finger to temple, palm-out)
- Mouth movement (speaking)
- Props being manipulated (headphones moved)

❌ **Invisible at ASCII resolution:**
- Eye direction / gaze shifts
- Eyebrow raises, lip compression
- Micro-expressions, subtle weight shifts
- "Determined" vs "calm" expression — indistinguishable

**Rule: Every state must differ in SILHOUETTE, not expression.**

### Default prompt templates

These are **generalizable defaults** — not tied to any specific character. Adapt the gesture details to match the character's appearance and props.

```
idle:
  "Relaxed, facing camera. Gentle breathing. Calm neutral expression,
   occasional slow blink. Still and centered."

listening:
  "Attention gesture — head tilts slightly, one hand rises near ear
   or side of head. Attentive expression, mouth closed.
   Clear silhouette difference from idle."

thinking:
  "Hand rises into frame, index finger pointing to temple or chin.
   Head tilts to one side, gaze drifts upward. Contemplative.
   Forearm visible against head — distinct outline change."

speaking:
  "Mouth moves in natural talking motion. Head and eyebrow gestures
   for emphasis. More energetic than idle.
   Direct eye contact about 60% of the time."

working:
  "Head lowers down, looking downward. Chin drops toward or below frame.
   Focused, head-down posture. Completely different silhouette from idle."

error:
  "Head pulls back in a recoil. One hand rises into frame palm-out
   in a wince/stop gesture near the face. Slight head shake.
   Hand lowers back, posture settles toward neutral."
```

### Shared frame directive (appended to every state prompt)

```
"Head and shoulders portrait, centered in frame. Static camera.
 Hair has gentle, smooth bounce and sway throughout —
 soft natural movement as if in a light breeze.
 No border or frame around the image — content extends to the very edge."
```

### Negative prompt (applied to every generation)

```
"full body shot, border, frame, outline around image, black border, vignette"
```

### Creating prompts for the user's character

1. Examine the starter image — note the character's appearance, props, clothing
2. Adapt the default templates above to reference specific visible features
   - If character has headphones → listening state can grab a headphone cup
   - If character has glasses → thinking state can adjust glasses
   - If character has no props → use pure pose/hand gestures
3. **Present all 6 prompts to the user for review before generating**

```
Here are the prompts I've drafted for each state:

**idle:** [prompt]
**listening:** [prompt]
**thinking:** [prompt]
**speaking:** [prompt]
**working:** [prompt]
**error:** [prompt]

Want to adjust any of these before I start generating?
```

Wait for explicit approval before proceeding.

---

## Phase 3: Video Generation

### Default: One at a time with review

Generate states **one at a time**. After each:
1. Show/share the result video
2. Ask if it looks good
3. If not, offer to regenerate with a modified prompt or the full (non-lite) model

**Important reminder to give the user:**
> Small details like exact finger placement or subtle expressions won't matter in the final ASCII version — the conversion is only ~48 characters wide. If you're unsure about a detail, we can convert this to ASCII first to see how it actually looks before iterating further.

If the user is iterating on small visual details after 2+ regeneration attempts on the same state, proactively suggest:
> Want to see the ASCII version of this generation first? Many small details disappear in the conversion — it might already look great as ASCII.

### Batch mode

If the user requests it, generate all 6 states in sequence without review:
> Running all 6 states back-to-back. I'll show you the results when they're all done.

### Using eikon CLI (if available)

```bash
cd ~/Dev/eikon
set -a && source .env && set +a  # REQUIRED — uv run won't load .env

# Single state
uv run eikon generate -i faces/starter.png -n avatar-name -s idle

# All states
uv run eikon generate -i faces/starter.png -n avatar-name

# With full model (for complex gestures)
uv run eikon generate -i faces/starter.png -n avatar-name -s thinking -m veo-3.1-generate-001
```

### Output structure

```
avatars/<name>/
├── manifest.yaml          # Generation metadata
├── states/
│   ├── idle.mp4          # Cropped 1:1 state videos
│   ├── listening.mp4
│   ├── thinking.mp4
│   ├── speaking.mp4
│   ├── working.mp4
│   └── error.mp4
└── raw/                   # Original 9:16 videos from Veo
    ├── idle.mp4
    └── ...
```

---

## Phase 4: ASCII Conversion

Convert the generated videos to the format the user needs.

### Determine output format

If the user specifies a format, use it. Otherwise, infer from context:
- Building a **Herm TUI / OpenTUI app** → TypeScript module (`states/*.ts`)
- Building a **terminal app** → TypeScript or text frames
- General use / preview → MP4 ASCII video or text frame files
- Just want to see it → display in terminal

### Conversion script

The eikon project includes `scripts/to_ascii.py`. If available:

```bash
cd ~/Dev/eikon
python scripts/to_ascii.py <avatar-name> [--no-invert]
```

This produces TypeScript modules at `avatars/<name>/ascii/`.

### Manual conversion (no eikon dependency)

```python
import numpy as np
from PIL import Image
import subprocess
from pathlib import Path

ASCII_WIDTH = 48
ASCII_HEIGHT = 24
FPS = 12
CHAR_PALETTE = " .:-=+*#%@"  # space=black, @=white

def extract_frames(video: Path, out: Path, fps: int) -> list[Path]:
    out.mkdir(parents=True, exist_ok=True)
    subprocess.run([
        "ffmpeg", "-y", "-i", str(video),
        "-vf", f"fps={fps}", "-q:v", "2",
        str(out / "frame_%04d.png"),
    ], check=True, capture_output=True)
    return sorted(out.glob("frame_*.png"))

def to_ascii(path: Path, invert: bool = True) -> str:
    img = Image.open(path).convert("L")
    img = img.resize((ASCII_WIDTH, ASCII_HEIGHT), Image.Resampling.LANCZOS)
    px = np.array(img, dtype=float) / 255.0
    if invert:
        px = 1.0 - px  # Dark bg: black→space, white→@
    px = np.power(px, 0.8)  # Gamma
    idx = (px * (len(CHAR_PALETTE) - 1)).astype(int)
    return "\n".join("".join(CHAR_PALETTE[c] for c in row) for row in idx)
```

### TypeScript module format (for Herm TUI)

Each state becomes a `.ts` file:

```typescript
// Auto-generated ASCII avatar frames
export const FRAMES: string[] = [
  `line1\nline2\n...`,  // template literal per frame
];
export const FRAME_COUNT = FRAMES.length;
export const FPS = 12;
export const FRAME_WIDTH = 48;
export const FRAME_HEIGHT = 24;
```

Index file re-exports all states:
```typescript
export type AvatarState = "idle" | "listening" | "thinking" | "speaking" | "working" | "error"
export const STATE_FRAMES: Record<AvatarState, string[]> = { idle, listening, ... }
```

Animation plays continuous **ping-pong** (forward → reverse → repeat). State changes interrupt immediately from frame 0.

### Inversion guide

- **Light subject on dark background** (recommended) → `invert=False`
- **Dark subject on light background** → `invert=True` (flips so subject becomes light ASCII chars on dark terminal)

Monochrome starter images with dark backgrounds need no inversion.

---

## Pitfalls

- **`uv run` won't load `.env`** — always `set -a && source .env && set +a` first
- **Veo lite ignores complex gestures** — escalate to `veo-3.1-generate-001` before rewriting prompts
- **Don't mention body parts not in frame** — if only head/neck visible, don't reference shoulders or arms "at sides"
- **Props must be visible in the starter image** — Veo cannot infer hidden items
- **Don't say "subtle"** — if it's subtle, it won't survive ASCII conversion
- **Frame directive is sacred** — don't widen framing; write gestures that enter the existing tight frame
- **Gemini image-gen models aren't on Vertex** — `gemini-3.1-flash-image-preview` requires AI Studio API key, not Vertex AI
- **Border artifacts** — always include border/frame/vignette in negative prompt
- **Test with ASCII before perfecting video** — users often iterate on video details that vanish in conversion
