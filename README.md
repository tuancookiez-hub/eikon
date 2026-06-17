# eikon

Stateful terminal avatars. An `.eikon` is a typed NDJSON runtime stream whose
header maps lifecycle signals such as `state.idle` and `state.working` to
clips; a host TUI plays the right signal based on what the agent is doing.

This repo is the **runtime format** ([SPEC.md](docs/SPEC.md)), the
**package/catalog contract** ([MANIFEST.md](docs/MANIFEST.md)), the
**TypeScript library** Herm and other consumers import, the **`eikon` CLI**,
and the **registry** of published eikons.

```
eikons/
  index.json                              — listing with posters
  <name>/
    <name>.eikon                          — packed; what plays
    manifest.json  base.png  states/**    — source; what Studio edits
src/              library (parse/serialize/lint/install) + CLI + browser
docs/             SPEC.md, MANIFEST.md
```

## Install and use

```sh
bunx eikon search ares --json                    # discover catalog entries
bunx eikon inspect ares                           # read metadata/trust before install
bunx eikon install ares                           # install only; does not activate
bunx eikon use ares                               # activate explicitly
bunx eikon list                                   # installed/active state
bunx eikon info ares                              # source, compatibility, trust, status
bunx eikon update ares                            # reinstall from recorded origin
bunx eikon remove ares                            # remove from local library
bunx eikon install github.com/you/catalog/mono    # multi-eikon GitHub catalog repo
bunx eikon install github.com/you/single          # single-package GitHub repo
bunx eikon install ./my-eikon/                    # local package dir
```

`install` writes into the Herm-compatible profile eikon library but never changes
the active avatar. `use` is the only activation command. `HERM_CONFIG_DIR` selects
the profile root; otherwise the CLI uses `$HERMES_HOME/herm` and stores eikons in
that profile's `eikons/` directory. Removing or updating the active eikon requires
`--active-ok` because it mutates the avatar the host is currently showing.

Default catalog installs fetch built package artifacts and verify package file
size/digest descriptors when present. Runtime `size`/`digest` bind the stored
`.eikon` bytes; gzip descriptors also carry decoded NDJSON size/digest metadata.
Digest-addressed gzip blobs are fetched as raw bytes and must not be served with
HTTP `Content-Encoding: gzip`. Direct GitHub paths use normal git
authentication; `github.com/owner/repo/name` selects an eikon from a catalog repo,
while `github.com/owner/repo` keeps the single-package fallback. Trust is reported
as `verified`, `unverified`, or `mismatch` in inspect/info/list output. Herm's
Marketplace tab uses the same package/catalog metadata in-process, and runtime
`.eikon` streams stay standalone without source URLs.

## Make one

One image, one clip, or a folder of per-state media:

```sh
eikon pack ./face.png --name mine --glyph ✦           # static
eikon pack ./loop.mp4 --name spin                       # one loop → all states
eikon pack ./dir/     --name full                       # per-state; see below
eikon pack ./face.png mine.eikon --gzip                 # gzip-stored .eikon bytes
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

For interactive tuning (pan/zoom/knobs/live preview), open Herm's Eikon →
Studio tab.

## Publish one

```sh
eikon publish mine.eikon
```

This creates a normal GitHub PR contribution against `EIKON_REPO` or the default
`liftaris/eikon` repository. The helper uses `gh` authentication and repository
mechanics, then submits the same generated registry bundle expected by CI:

```text
eikons/<name>/<name>.eikon
eikons/<name>/manifest.json
eikons/<name>/<source files, if referenced>
eikons/index.json
packages/liftaris/<name>/1.0.0.json
packages/liftaris/<name>/index.json
packages/liftaris/<name>/blobs/sha256/*
```

Creators can also prepare and share single-package or multi-eikon GitHub repos
directly with `pack`, `manifest`, and `index`. There is no hosted marketplace
account, upload API, dashboard, or moderation workflow in this v1 path.

Do not hand-edit `eikons/index.json` as the source of truth. Run the registry
generators and commit their output so catalog posters, runtime/package URLs,
source descriptors, sizes, and digests all agree. The CLI allowlists bundle paths,
skips hidden or secret-like extras by default, rejects path/symlink escapes, and
reports setup or validation errors before creating the PR request.

## States

| signal | host plays it when |
|---|---|
| `state.idle` | nothing happening |
| `state.listening` | user typing |
| `state.thinking` | model streaming, no visible text yet |
| `state.speaking` | model streaming with visible text |
| `state.working` | tool call in flight |
| `state.error` | one-shot, auto-returns to idle |

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
or author, previews selected `.eikon` files, and exposes copyable Herm install
instructions. It has no browser-native publish, auth,
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
  the page limited to copy instructions

Repo ownership is split deliberately: eikon owns the registry, gallery, catalog
client, install resolver, publish preflight, and shared player primitives; Herm
owns the native Marketplace UI, local install/use state, sidebar preview, and
submit dialog.
