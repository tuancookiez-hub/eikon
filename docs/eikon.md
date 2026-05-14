# Making an eikon

An eikon is a single `.eikon` file: six named ASCII-animation states the
host TUI plays based on what the agent is doing. You bring an image, a
clip, or a folder of per-state media; `eikon pack` does the rest.

Requires `chafa` on PATH. `ffmpeg` only if your input is video/gif.

## Quickest path: one image

```sh
eikon pack ./face.png --name my-face --glyph ✦ --author you
```

Writes `my-face.eikon`. All six states share the same single frame. Good
enough to drop into herm today:

```sh
cp my-face.eikon ~/.hermes/eikons/
# then /eikon in herm → pick it
```

## One video or gif

```sh
eikon pack ./loop.mp4 --name spin --glyph ◐
```

Every state gets the same loop. `--fps 16` (default) is how densely the
clip is sampled; lower it for smaller files.

## Per-state media (mix freely)

Drop files named after states into a directory:

```
avatar/
  idle.png
  thinking.gif
  error.mp4
```

```sh
eikon pack ./avatar --name avatar --glyph ⬡
```

Any of the six canonical states you don't supply falls back to `idle`
(or the first file found, if there's no `idle.*`). Images and video can
mix; each file is rasterized independently.

## Knobs

| flag | default | |
|---|---|---|
| `--width N` / `--height N` | 48 / 24 | cell dimensions (herm's sidebar slot is 48×24) |
| `--symbols braille\|block\|ascii\|sextant\|all` | `block` | chafa glyph set |
| `--colors none\|256\|full` | `none` | ANSI color in frames (monochrome reads best at 48×24) |
| `--no-invert` | off | default assumes bright subject on dark terminal |
| `--fps N` | 16 | video sample rate |
| `--glyph G` | `◆` | single unicode char shown inline in chat |
| `--author NAME` | `$USER` | attribution in the header |

## Check it

```sh
eikon lint my-face.eikon    # header + all 6 states present
eikon show my-face.eikon    # prints idle frame 0 + state list
bun preview/src/index.tsx my-face.eikon   # all states playing side-by-side
```

## Use it without publishing

```sh
cp my-face.eikon ~/.hermes/eikons/
```

Herm's `/eikon` picker lists everything there alongside bundled avatars.

## Publish it

```sh
eikon publish my-face.eikon
```

Runs lint, forks `liftaris/eikon`, pushes `catalog/my-face.eikon` on a
branch, opens a PR. CI re-lints. When merged it shows up in `/eikons` and
`ssh eikon.sh` for everyone.

## When to use the full pipeline instead

`eikon pack` is the fast path. If you're authoring per-state motion with
intro + loop segments (`start.mp4` + `loop.mp4` per state), use
`scripts/mk_eikon.ts` with the layout in `docs/VIDEO_HANDOFF.md` — it
handles `loop_from` correctly and there's an interactive knob tuner at
`bun preview/src/author.tsx <states-dir>`.

## States (for reference)

| state | when the host plays it |
|---|---|
| `idle` | nothing happening |
| `listening` | user typing in the composer |
| `thinking` | tokens streaming, no visible text yet |
| `speaking` | tokens streaming with visible text |
| `working` | tool call in flight |
| `error` | one-shot, auto-returns to idle |
