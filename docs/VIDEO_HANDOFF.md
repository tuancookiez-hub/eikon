# Video pipeline handoff — what eikon needs from you

You're generating short i2v clips from a single base portrait. Downstream, `mk_eikon.ts` rasterizes those clips to monochrome braille via ffmpeg+chafa and packs them into a `.eikon` file that a TUI plays back in a 48×24-cell sidebar slot. You don't touch any of that. **Your deliverable is a `states/` directory of mp4s.** Everything below is about what goes in that directory and why.

## Deliverable

```
eikons/<name>/states/
  idle/       loop.mp4
  listening/  start.mp4  loop.mp4
  thinking/   start.mp4
  speaking/   start.mp4  loop.mp4
  working/    start.mp4  loop.mp4
  error/      start.mp4
```

That's it. No metadata, no json. Playback behaviour is encoded entirely by **which files exist** in each state's subdir.

## The three playback modes (by filename)

| Files present            | Mode         | Player does                                   | Use for                 |
|--------------------------|--------------|-----------------------------------------------|-------------------------|
| `loop.mp4` only          | **loop**     | plays 0→N→0→N… forever                        | idle                    |
| `start.mp4` only         | **hold**     | plays 0→N once, freezes on last frame         | thinking, error         |
| `start.mp4` + `loop.mp4` | **intro→loop** | plays start once, then loops `loop.mp4`     | listening, speaking, working |

A bare `<state>.mp4` at `states/` root is treated as `loop.mp4` (legacy; don't produce this).

In the packed file this becomes `{frame_count, loop_from}`: loop ⇒ `loop_from=0`, hold ⇒ `loop_from=frame_count`, intro→loop ⇒ `loop_from=len(start)`. You don't need to emit that — `mk_eikon` derives it from the filenames.

## The six states

The TUI drives state from agent lifecycle. Precedence (first match wins):

```
error      one-shot. plays once, host auto-returns to idle when it finishes.
working    tool call in flight.
speaking   tokens streaming and there's visible text.
thinking   tokens streaming, nothing visible yet.
listening  user is typing in the composer.
idle       nothing happening.
```

Prompt directions for each are in `src/eikon/states.py` (`STATES` dict). Use those verbatim as the motion brief; they were written to produce silhouettes that survive 48×24 monochrome.

## Motion constraints (read this or your clips will look like noise)

The rasterizer is `chafa --symbols braille --colors none --invert` at 48×24. That's ~9k sub-dots, 1-bit, on a dark terminal. What survives:

- **Silhouette, not detail.** A hand entering frame reads. A facial micro-expression does not. Each state's prompt deliberately changes the *outline* (hand up, head down, recoil) — keep that.
- **Subject locked.** Head/shoulders framing, subject centered, camera static. No dolly, no zoom, no pan. Background plain and bright (it inverts to black).
- **First frame = base image.** Every clip must start on (or within a frame of) the base portrait pose. The player hard-cuts between states; if `thinking` frame 0 ≠ `idle` frame 0 the cut is visible.
- **Seamless-loop rule applies only to `loop.mp4`.** Its last frame must match its first frame (or use first/last-frame conditioning so it wraps). `start.mp4` does NOT need to loop — it plays once.
- **Intro→loop seam.** Where both exist, last frame of `start.mp4` must match first frame of `loop.mp4`. Easiest: generate one clip (neutral → action → sustained action), split it, and trim `loop.mp4` to a wrappable sub-segment.
- **`error` returns to neutral.** It's a one-shot that falls back to idle, so its *last* frame should be near the base pose, not mid-wince. The `states.py` prompt already says "settles toward neutral."
- **Hold states end on the pose.** `thinking` freezes on its last frame for an unbounded time. Make the last frame a clean, readable held pose (hand at temple), not a motion-blur in-between.

## Clip specs

- **Duration:** ~2s for `start.mp4`, ~2–4s for `loop.mp4`. The packer samples at 16 fps, so 2s → 33 frames, 4s → 65.
- **Format:** mp4/h264, any sane resolution ≥ 360p. `eikon crop` center-crops to 1:1 square downstream (48×24 cells ≈ square on a terminal), so keep the subject inside a centered square safe area. 9:16 portrait is fine.
- **fps:** whatever the model emits; ffmpeg resamples.
- **Audio:** ignored.

## Post-gen steps (not yours, but so you know the chain)

```
eikon crop eikons/<name>/states            # ffmpeg center-crop to 2:1
bun scripts/mk_eikon.ts eikons/<name>/states eikons/<name>/<name>.eikon \
    --name <name> --width 48 --height 24 --fps 16 \
    --symbols braille --colors none --dither none
# tune knobs interactively: herm → Eikon tab → Studio
```

If a state reads badly in `author.tsx`, the fix is almost always "regenerate that clip with a bigger silhouette change," not "tweak chafa knobs." The knobs above are locked for the hackathon build.

## Reference

- State prompts: `src/eikon/states.py`
- Packer: `scripts/mk_eikon.ts`, shared rasterizer `scripts/lib.ts`
- Format: `docs/SPEC.md`
- Worked example: `eikons/nous/states/`
