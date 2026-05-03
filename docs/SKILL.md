---
name: eikon-avatar-pipeline
description: "End-to-end workflow for creating a 6-state animated ASCII avatar (herma/eikon). From a single starter image, generates state-specific videos via AI, then converts to ASCII frames. Use when: creating avatar animations, building TUI character states, or generating eikon assets."
tags: [eikon, avatar, ascii, animation, states, workflow]
related_skills: [video-to-ascii-frames, ascii-art]
---

# Eikon Avatar Pipeline

Create a 6-state animated ASCII avatar from a single starter image. Each state (idle, listening, thinking, speaking, working, error) gets its own looping animation video, then converted to ASCII frames.

## Phase 0: Starter Image

A starter image is **required** before anything else.

### If the user provides an image

- Use it directly. Prefer **monochrome** images (dark/black background, light foreground) for best ASCII output.

### If the user does NOT have an image

Ask:

> Do you have a starter image for your avatar, or would you like to generate one?
> For best ASCII results, monochrome images work best — dark/black background with a light foreground subject (think white-on-black illustration style).

If the agent has image generation capabilities (DALL-E, Stable Diffusion, Flux, etc.), offer to generate one. Suggest a prompt like:

> "Monochrome portrait illustration, head and shoulders, [character description], white lines on pure black background, clean lineart style, no background detail, facing camera"

### Image suggestions

- **Suggested default framing:** Head and shoulders portrait (neck + head, no full body) — but the user can choose whatever framing they want
- Clean silhouette — fine detail is lost at ASCII resolution
- Any props the character wears (headphones, glasses, hat) must be **visually visible** — video models can't infer hidden items
- Image format depends on what the generation tool supports

---

## Phase 1: Video Generation Setup

### Check capabilities

Before generating video, verify the agent has access to **an** image-to-video generation API. **If no video generation capability is available, this skill cannot proceed — do not start.**

The pipeline is backend-agnostic — any image-to-video model that accepts a
still + text prompt and returns a short (2–4s) clip will do. Use whichever
is already configured in the environment. Requirements of the output:

- Accepts a starter image as the first frame / identity anchor
- Accepts a text prompt for motion direction
- Returns 2–4 s of video, any reasonable resolution
- Ideally supports a negative prompt (to suppress camera movement, borders)

If nothing is available, tell the user and stop.

---

## Phase 2: State Prompt Design

### The 6 states

Every eikon has exactly 6 (default) animation states:

| State       | Purpose               | Key differentiator                    |
| ----------- | --------------------- | ------------------------------------- |
| `idle`      | Resting/default       | Baseline — still, centered, breathing |
| `listening` | Receiving input       | Distinct gesture showing attention    |
| `thinking`  | Processing/reasoning  | Hand or head position change          |
| `speaking`  | Generating response   | Mouth movement                        |
| `working`   | Executing tools/tasks | Head-down or focused pose             |
| `error`     | Something went wrong  | Recoil or defensive gesture           |

### ASCII-first design principles

By default, output **3 sizes** of ASCII animations: **32, 48, and 64** characters wide. Ask the user if they want all 3 or a specific size.

✅ **Reads well at ASCII resolution:**

- Head angle changes (tilted, lowered, pulled back)
- Hand/forearm entering frame near face
- Distinct pose silhouettes (finger to temple, palm-out)
- Mouth movement (speaking)
- Props being manipulated (headphones moved)

❌ **Invisible at ASCII resolution:**

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
   or side of head. Attentive expression, mouth closed."

thinking:
  "Head tilts to one side, gaze drifts. Contemplative.
   Forearm visible against head — distinct outline change."

speaking:
  "Mouth moves in natural talking motion. Head and eyebrow gestures
   for emphasis. More energetic than idle.
   Facing camera."

working:
  "Head lowered, looking downward or behind. Chin drops toward or below frame.
   Focused, head-down posture."

error:
  "Abrupt, quick, explosive motion expressing surprise.
   Wince/stop gesture. posture settles toward neutral."
```

### Shared frame directive (appended to every state prompt)

This is appended to every state prompt. **Present it to the user for review alongside the state prompts** — they may want to customize it for their character.

```
"Head and shoulders portrait, centered in frame. Static camera.
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
3. **Present all 6 prompts AND the shared frame directive to the user for review before generating**

```
Here are the prompts I've drafted for each state:

**idle:** [prompt]
**listening:** [prompt]
**thinking:** [prompt]
**speaking:** [prompt]
**working:** [prompt]
**error:** [prompt]

**Shared frame directive** (appended to all): [directive]

Want to adjust any of these before I start generating?
```

Wait for explicit approval before proceeding.

---

## Phase 3: Video Generation

### Default: One at a time with review

Generate states **one at a time**. After each:

1. Show/share the result video
2. Ask if it looks good
3. If not, offer to regenerate with a modified prompt or a stronger model tier

**Important reminder to give the user:**

> Small details like exact subtle expressions won't matter in the final ASCII version — the conversion is only ~48 characters wide. If you're unsure about a detail, we can convert this to ASCII first to see how it actually looks before iterating further.

If the user is iterating on small visual details after 2+ regeneration attempts on the same state, proactively suggest:

> Want to see the ASCII version of this generation first? Many small details disappear in the conversion — it might already look great as ASCII.

### Batch mode

If the user requests it, generate all 6 states in sequence without review:

> Running all 6 states back-to-back. I'll show you the results when they're all done.

### Output structure

Videos land under `avatars/<name>/states/<state>/`. The directory layout
encodes playback intent — `mk_eikon.ts` reads it directly:

```
avatars/<name>/
├── source.png
├── raw/                      # Un-cropped generator output (any aspect)
│   └── ...
└── states/
    ├── idle/loop.mp4         # loop.mp4 only → loop whole clip
    ├── listening/start.mp4   # start.mp4 only → play once, hold last frame
    ├── thinking/start.mp4
    ├── speaking/
    │   ├── start.mp4         # both → play start once,
    │   └── loop.mp4          #        then loop loop.mp4
    ├── working/
    │   ├── start.mp4
    │   └── loop.mp4
    └── error/start.mp4
```

---

## Phase 4: Pack to .eikon

Rasterize the state clips to a single `.eikon` file. All authoring
knobs (width, symbol set, dither, invert) live here; players are dumb
text replay.

```bash
cd ~/Dev/eikon
bun scripts/mk_eikon.ts avatars/<name>/states avatars/<name>/<name>.eikon \
  --name <name> --width 48 --height 24 --fps 16 \
  --symbols block --colors none        # add --no-invert for dark-on-light sources
```

Requires `ffmpeg` and `chafa` on PATH. `--invert` is on by default
(dark-subject-on-light-background sources → light subject on black for
dark terminals).

The `.eikon` format is NDJSON — see `docs/SPEC.md`. Each state carries
`loop_from` derived from the directory layout above.

### Inversion guide

- **Dark subject on light background** (typical generator output) → default (invert on)
- **Light subject on dark background** → pass `--no-invert`
