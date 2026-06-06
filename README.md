# eikon

Stateful terminal avatars. An `.eikon` is a single NDJSON file packing six
named animation states; a host TUI plays the right state based on what the
agent is doing.

This repo is the **format** ([SPEC.md](docs/SPEC.md)), the **TypeScript
library** herm and other consumers import, the **`eikon` CLI**, and the
**registry** of published eikons.

```
eikons/
  index.json                              — listing with posters
  <name>/
    <name>.eikon                          — packed; what plays
    manifest.json  base.png  states/**    — source; what Studio edits
src/              library (parse/serialize/lint/install) + CLI + browser
docs/             SPEC.md, MANIFEST.md
```

## Install one

```sh
bunx eikon install ares              # from the default registry
bunx eikon install github.com/you/x  # from any git repo with a manifest.json
bunx eikon install ./my-eikon/       # from a local dir
bunx eikon info ares                 # what's installed, where it came from
```

Lands in `$HERMES_HOME/eikons/<name>/`. herm's Gallery tab does the same
in-process; its Studio tab fetches package source from the package/catalog
metadata. Runtime `.eikon` streams stay standalone and do not carry source URLs.

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
eikon publish mine.eikon
```

This submits a bundle to `eikons/<name>/`: the packed `.eikon`,
`manifest.json` when present, referenced source files, and catalog metadata. The
CLI previews and allowlists bundle paths, skips hidden or secret-like extras by
default, rejects path/symlink escapes, and reports setup or validation errors
before creating the submission request.

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

For browser-safe catalog consumers, import `eikon/catalog`. For renderer-neutral
playback helpers, import `eikon/player`.

## Browser gallery and launch gate

The static catalog gallery builds with:

```sh
bun run web:build
```

The page is discovery-only: it reads the public catalog, filters by eikon name
or author, previews selected `.eikon` files, and exposes copyable Herm
install/open-detail instructions. It has no browser-native publish, auth,
install, or activation path. Install/use/publish happen in Herm or through the
`eikon` CLI.

Before promoting `eikon.liftaris.dev`, verify:

- the Vercel project is owned from this repo and serves `dist/web` from the
  `main` branch build
- DNS maps `eikon.liftaris.dev` to that Vercel project, not another repo or
  deployment
- `/eikons/index.json`, posters, manifests, and packed `.eikon` assets are
  hosted by the eikon registry path with `Access-Control-Allow-Origin: *`
- catalog JSON uses a short revalidation cache, while packed assets/posters can
  use long immutable cache headers
- staging and production smoke both load the catalog, preview an eikon, and keep
  the page limited to copy instructions and Herm detail links

Repo ownership is split deliberately: eikon owns the registry, gallery, catalog
client, install resolver, publish preflight, and shared player primitives; Herm
owns the native Marketplace UI, local install/use state, sidebar preview, and
submit dialog.
