# eikon

Stateful terminal avatars. An `.eikon` is a single NDJSON file packing six
named animation states (idle · listening · thinking · speaking · working ·
error). A host TUI plays the right state based on what the agent is doing.

This repo is both the **format** (`docs/SPEC.md`) and the **registry**.

```
catalog/                packed .eikon files + index.json  — what plays
  <name>.eikon          header carries source_url → avatars/<name>/
  index.json            generated: {name, author, glyph, w, h, source, poster}
avatars/                source media                       — what Studio edits
  <name>/
    manifest.json       {name, source, states:{<k>:{file}}}
    base.png            still portrait
    states/<k>/*.mp4    per-state clips (loop.mp4 preferred over start.mp4)
faces/                  512² portraits used to generate the above
src/                    bun CLI + OpenTUI browser + ssh front door
scripts/                mk_eikon, mk_index, mk_manifest
docs/                   SPEC, VIDEO_HANDOFF, PLATFORM
```

## Use one

```sh
bunx eikon add ares          # → ~/.hermes/eikons/ares.eikon
bunx eikon show ares         # poster + state list
bunx eikon browse            # full-screen catalog browser
ssh eikon.sh                 # same, no install (when deployed)
```

The host fetches **source media** on demand from the `source_url` baked
into the header (`<raw>/avatars/<name>/manifest.json` + referenced files).

## Make one

Author in herm Studio (Eikon tab → `n`). Or by hand:

```sh
# 1. per-state mp4s → avatars/<name>/states/<state>/{loop,start}.mp4
#    layout + motion constraints: docs/VIDEO_HANDOFF.md
# 2. pack
bun src/cli.tsx pack avatars/<name>/states <name>.eikon --name <name> --glyph ◆
# 3. lint + publish (opens a PR against catalog/)
bun src/cli.tsx lint <name>.eikon
bun src/cli.tsx publish <name>.eikon
```

## Contribute source media

PR to `avatars/<name>/`. CI runs `eikon lint` on both the manifest and any
touched `.eikon`. `bun scripts/mk_manifest.ts` regenerates all manifests from
the `states/` tree; `bun scripts/mk_index.ts` regenerates `catalog/index.json`
and stamps `source_url` into catalog headers.

## Requirements

`bun`, `ffmpeg`, `chafa`. Python authoring pipeline: `uv sync`.
