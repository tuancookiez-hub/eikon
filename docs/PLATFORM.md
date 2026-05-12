# eikon platform — MVP

Browse, preview, install, and publish `.eikon` avatars. One OpenTUI
component, three front doors, a static registry, and a `gh`-driven publish
loop. Custom states, triggers, and fragments are out of scope for this cut.

## Registry

The `catalog/` directory of this repo is the registry. Layout:

```
catalog/
  index.json       generated, committed
  <name>.eikon     one file per avatar
```

`index.json` is an array of `{name, author, glyph, w, h, poster}` where
`poster` is the raw `data` string of idle frame 0. CI regenerates it on any
push to `main` touching `catalog/**` (script: `bun scripts/mk_index.ts`).

Served over plain HTTP (GH Pages from `/catalog`, or R2). Clients resolve
`$EIKON_URL` with default `https://eikon.sh`; unset or `file://` reads a
local directory.

## Format delta

Header gains one field: `glyph` (single grapheme, the inline stand-in for
the avatar in chat lines). No other changes to `docs/SPEC.md`.

## Browse component

`<Browser catalog onPick? />` in `src/browse/Browser.tsx`.

- Left column: scrollable list. Each row shows poster, name, author.
- Right pane: live `AnimatedAvatar` of the focused entry, auto-cycling
  `idle → listening → thinking → speaking → working → error` at 2s each.
  `←/→` steps states manually; a badge shows the current state name.
- `↑/↓` move focus; focusing an entry fetches and parses the full file.
- `Enter` fires `onPick(name, raw)`. If `onPick` is absent the right pane
  swaps to a detail view with a copyable
  `curl $EIKON_URL/<name>.eikon -o ~/.hermes/eikons/<name>.eikon` line.
- `q` / `Esc` exits.

`catalog` is `{ list(): Entry[]; load(name): Promise<string> }`. A local
impl wraps `listEikons([dir])` + `Bun.file().text()`; a remote impl wraps
`fetch(index.json)` + `fetch(<name>.eikon)`.

Depends on `parseEikon`, `listEikons`, `AnimatedAvatar` from `src/ui/`
(hoisted from herm and `preview/`; those callers switch to importing from
here).

## Install side-channel

`onPick` writes to a stream the parent reads. stderr is used because the
renderer owns stdout and stderr passes through both a direct spawn and an
ssh channel unchanged.

```
\x1e{"pick":"<name>","size":N}\n
<N bytes of raw .eikon>
```

`\x1e` is ASCII RS. The parent scans for it, parses the header line, reads
`size` bytes, writes `~/.hermes/eikons/<name>.eikon`. Lines without the
marker are ignored. Helpers `emit(out)` and `picks(stream)` live in
`src/browse/ipc.ts`.

## Entry points

| file | transport | `onPick` sink |
|---|---|---|
| `src/browse/main.ts` | process tty (`render(<Browser/>)`) | `process.stderr` |
| `src/browse/sshd.ts` | `ssh2` on `127.0.0.1:2222`, no auth; per connection: `createCliRenderer({ stdin: chan, stdout: chan, remote: true })` then `createRoot().render(<Browser/>)` | `chan.stderr` |

`sshd.ts` wires `window-change` → `renderer.resize(cols, rows)` and
destroys the renderer on channel close. Local only for now; public deploy
is a follow-up.

## Herm integration

`src/utils/eikonsh.ts` in herm, shaped like `utils/editor.ts`:

```ts
renderer.suspend()
const child = Bun.spawn(["bun", EIKON_MAIN], { stdio: ["inherit", "inherit", "pipe"] })
for await (const msg of picks(child.stderr)) install(msg)  // write file, set active
await child.exited
renderer.resume()
```

Bound to `/eikons` and a key in the catalog. To exercise the ssh path, swap
the argv for `["ssh", "-p", "2222", "localhost"]`; nothing else changes.

## Publish

`eikon publish <file>` (bun CLI, `src/cli.ts`):

1. Lint via `parseEikon`: header has `{name, author, glyph, width, height}`;
   all six canonical states present with ≥1 frame; `name` matches
   `^[a-z0-9-]{2,32}$`.
2. `gh repo fork liftaris/eikon --clone=false` (idempotent).
3. `gh api -X PUT repos/<user>/eikon/contents/catalog/<name>.eikon` on
   branch `add/<name>` with the base64 body.
4. `gh pr create -R liftaris/eikon -H <user>:add/<name> -B main
   -t "catalog: add <name>" -b <template>`.

CI on the PR re-runs the linter. On merge to `main`, CI regenerates
`catalog/index.json` and deploys.

The python authoring CLI keeps its commands under `uv run eikon`; the bun
CLI owns the bare `eikon` name going forward.

## Repo layout

```
src/ui/        parseEikon, listEikons, AnimatedAvatar  (single source)
src/browse/    Browser.tsx, main.ts, sshd.ts, ipc.ts
src/cli.ts     publish, add, show
scripts/       mk_eikon.ts, lib.ts, mk_index.ts
catalog/       *.eikon, index.json
preview/       player + author widget (imports from src/ui/)
```

## Build order

1. Hoist parser + `AnimatedAvatar` → `src/ui/`; repoint `preview/`.
2. `<Browser/>` + `main.ts` against local `catalog/`.
3. `sshd.ts`; verify `ssh -p 2222 localhost` renders and picks.
4. Herm `/eikons` suspend-into spawning `main.ts`.
5. `eikon publish` + linter; `scripts/mk_index.ts`; CI workflow.
6. Remote `catalog` impl behind `EIKON_URL`; flip herm to ssh localhost to
   prove transport independence.

## Deferred

Custom states, trigger rules, `base:` fragments. Herm tab mount (in-process
`<Browser/>`). Web gallery. Public sshd deploy, DNS, TLS. Upload auth and
moderation beyond PR review.
