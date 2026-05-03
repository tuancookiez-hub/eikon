# eikon

Stateful ASCII avatars for terminal agents.

An **eikon** is a single `.eikon` file containing named animation states
(idle, thinking, speaking, working, listening, error). A host TUI —
[herm](https://github.com/liftaris/herm) — plays the right state based on
what the agent is doing. One portrait in, one text file out.

## Requirements

`bun`, `ffmpeg`, `chafa`. Python side: `uv sync`.

## Make one

```sh
# 1. generate per-state mp4s (bring your own i2v) → avatars/<name>/states/
#    layout + motion constraints: docs/VIDEO_HANDOFF.md
# 2. crop to square
uv run eikon crop <name>
# 3. rasterize + pack
bun scripts/mk_eikon.ts avatars/<name>/states avatars/<name>/<name>.eikon \
    --name <name> --width 48 --height 24 --fps 16 \
    --symbols braille --colors none --dither none
```

## Preview

```sh
bun preview/src/index.tsx  avatars/<name>/<name>.eikon   # play a packed .eikon
bun preview/src/author.tsx avatars/<name>/states          # tune knobs live against source mp4s
```

## Layout

```
docs/SPEC.md            .eikon NDJSON format
docs/VIDEO_HANDOFF.md   what the video pipeline must deliver
src/eikon/              python CLI — crop, list, info, state prompts
scripts/mk_eikon.ts     mp4 → .eikon packer (ffmpeg + chafa)
scripts/lib.ts          shared rasterizer (packer + author both use this)
preview/                OpenTUI player + authoring widget
```

---

*εἰκών — image, likeness.*
