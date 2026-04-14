# Eikon — Phase 1 Spec

**Video-state generation for AI avatars using Veo 3.1 Fast**

> Previously *Agalma*. Renamed to **Eikon** (εἰκών) — Greek for *image, likeness, representation*. Where agalma was the consecrated statue, eikon is the living image itself.

---

## Overview

Phase 1 delivers a CLI pipeline that takes a **single static avatar image** (PNG) and generates a library of **short looping videos** — one per agent state — using Google Veo 3.1 Fast. These videos are the raw material that downstream consumers (Herm's ASCII renderer, web frontends, etc.) use to animate the avatar.

**Input:** One PNG image (the avatar's canonical appearance)
**Output:** A directory of 1:1 aspect ratio `.mp4` clips, one per state, ready for consumption
**Engine:** Google Veo 3.1 Fast (image-to-video via Gemini API)

---

## Veo 3.1 API — Complete Reference

### Model Variants

| Model | Model ID | Speed | Quality | Cost (720p/s) | Cost (1080p/s) | Cost (4k/s) |
|-------|----------|-------|---------|---------------|-----------------|-------------|
| **Veo 3.1 Standard** | `veo-3.1-generate-preview` | Slow | Highest | $0.40 | $0.40 | $0.60 |
| **Veo 3.1 Fast** ⭐ | `veo-3.1-fast-generate-preview` | Fast | High | $0.10 | $0.12 | $0.30 |
| Veo 3.1 Lite | `veo-3.1-lite-generate-preview` | Fastest | Good | $0.05 | $0.08 | N/A |

**We use Veo 3.1 Fast** — best balance of speed, quality, and cost for avatar loops.

### Core API: `generate_videos()`

```python
from google import genai
from google.genai import types

client = genai.Client()

operation = client.models.generate_videos(
    model="veo-3.1-fast-generate-preview",
    prompt="...",                           # Text description
    image=types.Image(...),                 # First frame / input image (optional)
    video=types.Video(...),                 # For video extension only (optional)
    source=types.GenerateVideosSource(...), # Alternative source container (optional)
    config=types.GenerateVideosConfig(...), # All generation parameters
)
```

### GenerateVideosConfig — Complete Schema

| Parameter | Type | Values | Notes |
|-----------|------|--------|-------|
| `aspectRatio` | `str` | `"16:9"` (default), `"9:16"` | **Only two options. No 1:1.** |
| `durationSeconds` | `int` | `4`, `6`, `8` | Must be `8` for 1080p/4k, reference images, or extension |
| `resolution` | `str` | `"720p"` (default), `"1080p"`, `"4k"` | 1080p/4k require 8s duration |
| `fps` | `int` | `24` (only documented value) | All Veo models output 24fps |
| `seed` | `int` | Any integer | Slightly improves determinism, **not** guaranteed |
| `numberOfVideos` | `int` | `1` | Veo 3.1 only supports 1 per request |
| `personGeneration` | `str` | `"allow_all"` (text-to-video), `"allow_adult"` (image-to-video) | Image-to-video is restricted to `"allow_adult"` only |
| `negativePrompt` | `str` | Free text | What to avoid in generation |
| `enhancePrompt` | `bool` | `true`/`false` | Let the model enhance your prompt |
| `generateAudio` | `bool` | `true`/`false` | Audio is on by default in Veo 3.1. We can disable it. |
| `lastFrame` | `Image` | Image object | **End frame for interpolation.** Used with `image` param for loop strategy. |
| `referenceImages` | `list[VideoGenerationReferenceImage]` | Up to 3 images | Style/content references. Veo 3.1 only. Requires 8s duration. |
| `mask` | `VideoGenerationMask` | Image + mode | For inpainting/outpainting (INSERT, OUTPAINT, REMOVE, REMOVE_STATIC) |
| `compressionQuality` | `VideoCompressionQuality` | `LOSSLESS`, `OPTIMIZED` | Output quality |
| `outputGcsUri` | `str` | GCS path | Optional cloud storage output |
| `pubsubTopic` | `str` | Pub/Sub topic | Optional webhook notification |
| `labels` | `dict[str, str]` | Key-value pairs | Metadata labels |
| `webhookConfig` | `WebhookConfig` | Webhook settings | Alternative notification |

### Input Types

```python
# Image input (first frame or reference)
types.Image(
    imageBytes=bytes,   # Raw image bytes
    mimeType="image/png",
    gcsUri="gs://..."   # OR GCS path
)

# Reference image (for content/style guidance)
types.VideoGenerationReferenceImage(
    image=types.Image(...),
    referenceType="ASSET" | "STYLE"  # ASSET = preserve appearance, STYLE = match aesthetic
)

# Video input (for extension only)
types.Video(
    uri="...",          # From previous generation
    videoBytes=bytes,
    mimeType="video/mp4"
)
```

### Async Operation Pattern

All generation is async. Returns an `Operation` that must be polled:

```python
operation = client.models.generate_videos(...)

while not operation.done:
    time.sleep(10)
    operation = client.operations.get(operation)

video = operation.response.generated_videos[0]
client.files.download(file=video.video)
video.video.save("output.mp4")
```

**Latency:** Min 11 seconds, max ~6 minutes during peak.
**Retention:** Generated videos stored for 2 days on server, then deleted.

### Key Capabilities for Eikon

1. **Image-to-Video** — Pass avatar PNG as `image` param → Veo uses it as the starting frame and animates from there.

2. **First + Last Frame (Interpolation)** — Pass `image` as first frame + `config.lastFrame` as last frame → Veo generates video that transitions between them. **Critical for seamless looping**: if first frame = last frame (or near-identical), the video naturally loops.

3. **Reference Images** — Up to 3 images as content/style references with `ASSET` type to preserve subject appearance. Requires 8s duration.

4. **Negative Prompt** — Explicitly exclude unwanted elements (camera movement, background changes, etc.)

5. **Seed** — Slight determinism improvement for regeneration consistency.

### Constraints & Limitations

- **No 1:1 aspect ratio** — must generate 9:16 portrait and crop (see strategy below)
- **personGeneration** for image-to-video is locked to `"allow_adult"` — no configuration flexibility
- Audio always generated by default — we should disable with `generateAudio=False` to save processing
- 1 video per request — parallel generation must use concurrent API calls
- Videos stored for only 2 days — must download immediately
- Safety filters can block generation — need retry logic
- Extension only works with Veo-generated videos (not arbitrary uploads)

---

## The 1:1 Aspect Ratio Strategy

Veo only supports `16:9` (1280×720) and `9:16` (720×1280). Eikon needs 1:1.

### Approach: Generate 9:16 Portrait → Crop to 1:1

```
9:16 Portrait (720×1280)          1:1 Crop (720×720)
┌──────────────┐                  ┌──────────────┐
│              │                  │              │
│   headroom   │ ← discard       │  ┌────────┐  │
│              │                  │  │ avatar │  │
├──────────────┤ ─┐              │  │  face  │  │
│              │  │              │  │ + upper│  │
│   avatar     │  │ 720×720      │  │  body  │  │
│   face +     │  │ center       │  └────────┘  │
│   upper body │  │ crop         │              │
│              │  │              └──────────────┘
├──────────────┤ ─┘
│   lower body │ ← discard
│              │
└──────────────┘
```

**Why 9:16 not 16:9:**
- Avatar is a character portrait — vertical framing keeps the subject centered and large
- Cropping the vertical center of a portrait preserves the face + upper body (the expressive parts)
- 16:9 landscape would waste horizontal space or require the character to be tiny

### Prompt Strategy for Crop-Safe Composition

Every prompt must include framing directives that ensure the important content lives in the center 720×720 region of a 720×1280 frame:

```
... Head and shoulders centered in frame. Subject fills the middle third of the frame
vertically. Clean minimal background extends above and below the subject.
Static camera, no pans or zooms. ...
```

**Key prompt rules:**
- **"Head and shoulders centered in frame"** — keeps face in the crop zone
- **"Clean minimal background"** — ensures cropped edges don't cut through important content
- **"Static camera"** — prevents the subject from drifting out of the crop zone
- **"No full body"** — we don't want legs/feet that would be cropped away

### Post-Processing Crop

```bash
# ffmpeg center-crop from 720×1280 to 720×720
ffmpeg -i input.mp4 -vf "crop=720:720:0:280" -c:a copy output_square.mp4
```

The `280` vertical offset = `(1280 - 720) / 2` = center crop. May need per-video adjustment if Veo places the subject higher or lower.

**Smarter crop:** Use face detection on frame 0 to find the subject's face center, then crop around it. Ensures the face is always centered even if Veo's composition varies.

---

## Seamless Loop Strategy

### Primary: First Frame = Last Frame (Interpolation)

Veo 3.1 supports passing both `image` (first frame) and `config.lastFrame` (last frame). If we pass the **same image** as both:

```python
avatar_image = types.Image(imageBytes=open("avatar.png", "rb").read(), mimeType="image/png")

operation = client.models.generate_videos(
    model="veo-3.1-fast-generate-preview",
    prompt="...",
    image=avatar_image,          # First frame
    config=types.GenerateVideosConfig(
        lastFrame=avatar_image,  # Last frame = same image → forces return to start
        aspectRatio="9:16",
        durationSeconds=8,       # 8s gives Veo room for a full gesture cycle
        resolution="720p",
        generateAudio=False,
        personGeneration="allow_adult",
        negativePrompt="camera movement, zoom, pan, background change, scene change",
    ),
)
```

**Why this should work:** Veo interpolates between first and last frames. Same image on both ends means the video must start and end in the same pose → natural loop point.

**Risks:**
- Veo might generate minimal motion if the frames are identical (it's "already there")
- The motion prompt needs to be strong enough to push Veo away from the start pose and back
- Need to test whether Veo actually respects identical start/end or just ignores it

### Fallback: Crossfade Post-Processing

If interpolation doesn't produce satisfying loops:

```bash
# Crossfade last 0.5s into first 0.5s for seamless loop
ffmpeg -i input.mp4 -filter_complex \
  "[0:v]split[body][tail]; \
   [tail]trim=start=7.5,setpts=PTS-STARTPTS[tailclip]; \
   [body]trim=end=0.5,setpts=PTS-STARTPTS[headclip]; \
   [tailclip][headclip]blend=all_mode=overlay:all_opacity=0.5[crossfade]; \
   [0:v]trim=0.5:7.5,setpts=PTS-STARTPTS[middle]; \
   [crossfade][middle]concat=n=2:v=1[out]" \
  -map "[out]" output_loop.mp4
```

### Validation

After generation, verify loop quality:
1. Extract first and last frames
2. Compute SSIM (structural similarity) between them
3. If SSIM > 0.85, loop is good. If < 0.85, apply crossfade or regenerate.

---

## Avatar States (Phase 1 — 6 Agent States Only)

Phase 1 focuses on the 6 functional agent states. No emotion overlays.

| State | Description | Prompt Direction |
|-------|-------------|-----------------|
| `idle` | Default resting state. Agent present but not active. | Subtle breathing, micro-movements, occasional blinks. Slight weight shifts. Relaxed neutral expression. Calm energy. Very subtle — barely perceptible motion. |
| `listening` | Receiving user input. | Head slightly tilted, eyes focused forward, attentive posture. Occasional small nods. Mouth closed. Alert but still energy. |
| `thinking` | Processing / generating a response. | Gaze drifts slightly up-right. Subtle lip compression. Slight squint. Contemplative energy. Slower movements than idle. |
| `speaking` | Delivering a response. | Mouth moves in natural talking motion (not lip-synced). Head and eyebrow gestures for emphasis. Direct eye contact ~60% of the time. More energetic than idle. |
| `working` | Executing tools, running code, performing actions. | Focused gaze, slightly downward. Determined expression. Busy energy — typing or concentrating feel. More active than thinking. |
| `error` | Something went wrong. | Slight wince, apologetic expression. One eyebrow raised. Brief head shake. Settles back toward neutral. |

### State Selection Rationale

These 6 states map 1:1 to agent lifecycle events in Hermes:
- User sends message → `listening`
- Agent generates response → `thinking`
- Agent calls tools → `working`
- Tool completes → `thinking` (resume)
- Agent streams response → `speaking`
- Agent finishes → `idle`
- Error occurs → `error`

This matches hermes-waifu's 6-state set (`idle`, `listening`, `speaking`, `thinking`, `working`, `error`), which is battle-tested.

---

## Video Specifications

| Property | Value | Rationale |
|----------|-------|-----------|
| **Generation AR** | 9:16 portrait (720×1280) | Vertical framing preserves face/shoulders for center crop |
| **Final AR** | 1:1 (720×720) | Target square format for avatar display |
| **Duration** | 8 seconds | Required for first+last frame interpolation. Longer = smoother loop. |
| **Resolution** | 720p | Cost-effective. Sufficient for avatar use (will be downsampled further for ASCII). |
| **Frame rate** | 24fps (Veo default) | Herm downsamples to 12fps for ASCII. Web consumers use full 24. |
| **Format** | MP4 (H.264) | Universal compatibility. |
| **Audio** | Disabled | Avatar videos don't need audio. Saves generation cost/time. |

### Cost Estimate

Veo 3.1 Fast at 720p = **$0.10/second**

| Per avatar | Calculation | Cost |
|------------|-------------|------|
| 1 state | 8 seconds × $0.10 | $0.80 |
| **6 states** | 6 × $0.80 | **$4.80** |
| With retries (~30%) | $4.80 × 1.3 | **~$6.24** |

~$5–7 per complete avatar. Reasonable for a generation tool.

---

## Pipeline Architecture

```
┌─────────────┐     ┌───────────────┐     ┌─────────────────┐     ┌──────────────┐     ┌────────────┐
│  Input PNG   │────▶│ Subject Desc. │────▶│  Prompt Builder │────▶│  Veo 3.1 Fast│────▶│ Post-Proc  │
│  (avatar)    │     │ (Gemini vision)│    │ (per state)     │     │ (×6 parallel)│     │ crop+loop  │
└─────────────┘     └───────────────┘     └─────────────────┘     └──────────────┘     └────────────┘
                                                                                              │
                                                                                              ▼
                                                                                       ┌────────────┐
                                                                                       │ Output Dir  │
                                                                                       │ + manifest  │
                                                                                       └────────────┘
```

### Step 1: Subject Description (one-time)

Use Gemini to analyze the input PNG and produce a stable subject description:

```python
# Using Gemini to describe the avatar for consistent Veo prompts
response = client.models.generate_content(
    model="gemini-2.5-flash",
    contents=[
        types.Part.from_image(avatar_image),
        "Describe this character's appearance in detail for video generation: "
        "hair color/style, eye color, clothing, art style, skin tone, "
        "distinguishing features. Be specific and concise. "
        "Do not describe pose or expression — only stable appearance traits."
    ]
)
subject_description = response.text
```

This description anchors all 6 video prompts to the same character.

### Step 2: Prompt Construction

For each state, build a complete prompt:

```python
def build_prompt(subject_desc: str, state: str, state_direction: str) -> str:
    return f"""{subject_desc}

{state_direction}

Head and shoulders portrait, centered in frame. Subject fills the middle
third of the frame vertically. Clean solid neutral background. Static camera,
no pans, zooms, or camera movement. No full body shot. Subtle natural
movements only — breathing, micro-expressions, blinks. Smooth, continuous
motion suitable for seamless looping."""
```

### Step 3: Parallel Veo Generation

Fire all 6 requests concurrently (Veo returns async operations):

```python
import asyncio

operations = {}
for state_name, state_prompt in states.items():
    op = client.models.generate_videos(
        model="veo-3.1-fast-generate-preview",
        prompt=state_prompt,
        image=avatar_image,
        config=types.GenerateVideosConfig(
            lastFrame=avatar_image,
            aspectRatio="9:16",
            durationSeconds=8,
            resolution="720p",
            generateAudio=False,
            personGeneration="allow_adult",
            negativePrompt="camera movement, zoom, pan, tilt, background change, full body, legs, scene transition",
            seed=42,  # Same seed for consistency across states
        ),
    )
    operations[state_name] = op
```

### Step 4: Post-Processing

For each downloaded video:

1. **Center-crop to 1:1** — `ffmpeg -vf "crop=720:720:0:280"`
   - Optionally: face-detect on frame 0, compute optimal vertical offset
2. **Verify loop** — SSIM between first/last frames. If < 0.85, crossfade.
3. **Extract thumbnail** — Pull a representative frame for UI previews
4. **Strip audio** — Belt-and-suspenders (already disabled in generation)

```bash
# Full post-processing pipeline per video
ffmpeg -i raw_state.mp4 \
  -vf "crop=720:720:0:280" \
  -an \
  -c:v libx264 -crf 18 \
  states/state_name.mp4

# Extract thumbnail
ffmpeg -i states/state_name.mp4 \
  -vframes 1 -q:v 2 \
  thumbnails/state_name.png
```

---

## Output Structure

```
eikon/
└── avatars/
    └── {avatar-name}/
        ├── source.png              # Original input image
        ├── manifest.json           # Metadata
        ├── raw/                    # Raw Veo output (9:16, pre-crop) — kept for re-processing
        │   ├── idle.mp4
        │   ├── listening.mp4
        │   ├── thinking.mp4
        │   ├── speaking.mp4
        │   ├── working.mp4
        │   └── error.mp4
        ├── states/                 # Processed 1:1 videos (final output)
        │   ├── idle.mp4
        │   ├── listening.mp4
        │   ├── thinking.mp4
        │   ├── speaking.mp4
        │   ├── working.mp4
        │   └── error.mp4
        └── thumbnails/
            ├── idle.png
            ├── listening.png
            ├── thinking.png
            ├── speaking.png
            ├── working.png
            └── error.png
```

### manifest.json

```json
{
  "name": "nous-girl",
  "version": 1,
  "created": "2026-04-13T15:10:00Z",
  "source": "source.png",
  "engine": {
    "model": "veo-3.1-fast-generate-preview",
    "seed": 42
  },
  "subject_description": "Anime-style girl with short dark hair, large expressive eyes...",
  "spec": {
    "raw_resolution": "720x1280",
    "raw_aspect_ratio": "9:16",
    "final_resolution": "720x720",
    "final_aspect_ratio": "1:1",
    "crop_offset_y": 280,
    "fps": 24,
    "duration": 8,
    "format": "mp4",
    "audio": false
  },
  "states": {
    "idle": {
      "raw": "raw/idle.mp4",
      "file": "states/idle.mp4",
      "thumbnail": "thumbnails/idle.png",
      "duration": 8.0,
      "frames": 192,
      "loop_ssim": 0.92,
      "loop_method": "interpolation"
    },
    "listening": { "..." : "..." },
    "thinking": { "..." : "..." },
    "speaking": { "..." : "..." },
    "working": { "..." : "..." },
    "error": { "..." : "..." }
  }
}
```

---

## CLI Interface

```bash
# Generate all 6 state videos for an avatar
eikon generate --input ./nous-girl.png --name nous-girl

# Generate a single state (for iteration/re-generation)
eikon generate --input ./nous-girl.png --name nous-girl --state thinking

# Generate with specific seed
eikon generate --input ./nous-girl.png --name nous-girl --seed 42

# Skip post-processing (keep raw 9:16 only)
eikon generate --input ./nous-girl.png --name nous-girl --raw-only

# Re-crop existing raw videos (adjust crop offset)
eikon crop --name nous-girl --offset 300

# List available avatars
eikon list

# Show avatar manifest
eikon info nous-girl

# Validate avatar directory (all states present, videos playable, loops verified)
eikon validate nous-girl
```

### Configuration

```yaml
# ~/.eikon/config.yaml
output_dir: ~/Dev/eikon/avatars

veo:
  model: veo-3.1-fast-generate-preview
  api_key_env: GOOGLE_AI_API_KEY

defaults:
  aspect_ratio: "9:16"
  resolution: "720p"
  duration: 8
  generate_audio: false
  seed: null                    # null = random per generation
  negative_prompt: "camera movement, zoom, pan, tilt, background change, full body, legs, scene transition"

crop:
  target_aspect_ratio: "1:1"
  target_resolution: 720
  auto_face_detect: true        # Use face detection for optimal crop offset
  fallback_offset_y: 280        # Center crop if face detection fails
```

---

## Tech Stack

| Component | Choice | Why |
|-----------|--------|-----|
| Language | **Python 3.11+** | Best `google-genai` SDK support, `ffmpeg` subprocess, rich CLI ecosystem |
| CLI | **Click** | Clean subcommand structure, established |
| Veo SDK | **`google-genai`** | Official Google Gen AI SDK |
| Subject analysis | **Gemini 2.5 Flash** | Same ecosystem, cheap, fast vision analysis |
| Video processing | **ffmpeg** (subprocess) | Industry standard for crop, codec, thumbnail |
| Face detection | **mediapipe** or **opencv** | For smart crop offset calculation |
| Config | **YAML** (PyYAML) | Consistent with Hermes ecosystem |
| Output metadata | **JSON** | Easy consumption from TypeScript (Herm), Python, etc. |

---

## Integration Points

### Herm (primary consumer)

Current state: Single animation loop from `nous_girl.mp4` → 84 ASCII frames at 12fps. No state awareness.

**Eikon enables:**
- Herm reads `manifest.json` to discover available states
- On agent lifecycle events, Herm switches to the corresponding state video
- Each state video → ASCII frame conversion (existing pipeline) → display
- Transition between states: crossfade between frame sets or hard cut

### Hermes Agent (state source)

Agent lifecycle events → avatar state mapping:
```
user message    → listening
generating      → thinking  
tool call       → working
tool complete   → thinking
streaming reply → speaking
done            → idle
error           → error
```

---

## Open Questions

1. **Same-image interpolation behavior** — Does Veo produce meaningful motion when `image` and `lastFrame` are identical? Or does it just produce a near-static video? Need to test empirically. If it doesn't work, we fall back to single-image input + crossfade post-processing.

2. **Subject consistency across states** — How much does the character's appearance drift between 6 separate Veo calls? Seed helps but isn't deterministic. Reference images (`ASSET` type) could help but force 8s duration (which we're already using). Worth testing: `image` input vs. `referenceImages` approach.

3. **Smart crop reliability** — Face detection assumes the face is always visible and detectable in Veo output. Need fallback for frames where Veo places the subject unexpectedly.

4. **Motion magnitude tuning** — `idle` should have barely-perceptible motion; `speaking` should have clear mouth/gesture movement. How much control does the text prompt give us over motion intensity? May need iteration.

5. **Background consistency** — All 6 videos should have the same background for clean transitions between states. Prompt engineering may not be enough — may need to specify exact color.

---

## Success Criteria

- [ ] CLI tool generates all 6 state videos from a single input PNG
- [ ] Generated 9:16 videos crop cleanly to 1:1 without losing the subject's face
- [ ] Videos loop smoothly (via first=last frame interpolation or crossfade fallback)
- [ ] Character appearance is visually consistent across all 6 states
- [ ] `manifest.json` accurately describes all generated assets
- [ ] `nous-girl` avatar fully generated as proof-of-concept
- [ ] Total generation cost per avatar is under $10
- [ ] Herm can consume the output (manually verified — load one state through ASCII pipeline)

---

## What Phase 1 Is NOT

- **Not real-time** — Videos are pre-generated, not streamed
- **Not a state machine** — Eikon doesn't decide which state to play. Consumers do.
- **Not emotion overlays** — Phase 1 is agent states only. Emotions are Phase 2.
- **Not lip-synced** — Speaking state is generic mouth movement, not phoneme-driven
- **Not a platform** — No web UI, no sharing, no marketplace. CLI that makes videos.

---

*Phase 2+ considerations: emotion overlay states, lip-sync from TTS audio, real-time state blending, web gallery, reference image approach for better consistency, video extension for longer loops, custom state definitions.*
