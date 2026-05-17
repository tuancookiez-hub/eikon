# eikon

Stateful terminal avatars. An `.eikon` is a single NDJSON file packing six
named animation states; a host TUI plays the right state based on what the
agent is doing.

This repo is the **format** ([SPEC.md](docs/SPEC.md)), the **TypeScript
library** herm and other consumers import, the **`eikon` CLI**, and the
**registry** of published eikons.

```
catalog/          packed .eikon files + index.json       — what plays
eikons/<name>/    manifest.json + base.png + states/**   — what Studio edits
src/              library (parse/serialize/lint/install) + CLI + browser
docs/             SPEC.md, MANIFEST.md
```

## Install one

```sh
bunx eikon install ares              # from the default catalog
bunx eikon install github.com/you/x  # from any git repo with a manifest.json
bunx eikon install ./my-eikon/       # from a local dir
bunx eikon info ares                 # what's installed, where it came from
```

Lands in `$HERMES_HOME/eikons/<name>/`. herm's Gallery tab does the same
in-process; its Studio tab fetches source on demand via the `source_url`
baked into the `.eikon` header.

## Make one

One image, one clip, or a folder of per-state media:

```sh
eikon pack ./face.png --name mine --glyph ✦           # static
eikon pack ./loop.mp4 --name spin                       # one loop → all states
eikon pack ./dir/     --name full                       # per-state; see below
eikon lint mine.eikon
eikon show mine.eikon
```

Directory layout (anything you omit falls back to idle):

```
dir/
  idle.png              # or idle.mp4, or:
  idle/loop.mp4         # loops
  thinking/start.mp4    # plays once, holds last frame
  error/
    start.mp4           # intro (plays once) …
    loop.mp4            # … then this loops. loop_from is set automatically.
```

Flags: `--width 48 --height 24 --fps 16 --symbols block|braille|ascii|sextant
--colors none|256|full --no-invert --author NAME`. Requires `chafa`;
`ffmpeg` for video/gif.

For interactive tuning (pan/zoom/knobs/live preview), open herm's Eikon →
Studio tab.

## Publish one

```sh
eikon publish mine.eikon   # opens a PR against catalog/
```

Or PR source media directly to `eikons/<name>/`. CI lints both; on merge,
`eikon index` regenerates `catalog/index.json` and stamps `source_url` into
the catalog header.

## States

| state | host plays it when |
|---|---|
| `idle` | nothing happening |
| `listening` | user typing |
| `thinking` | model streaming, no visible text yet |
| `speaking` | model streaming with visible text |
| `working` | tool call in flight |
| `error` | one-shot, auto-returns to idle |

## As a library

```ts
import { parse, serialize, lint, install, peek, STATES } from "eikon"
```

See [`src/index.ts`](src/index.ts) for the full export surface.
