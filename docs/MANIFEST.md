# Source manifest — `manifest.json`

Describes the **editable source media** for an eikon: one base still +
per-state clips. Lives beside the media and the packed `.eikon`
(`eikons/<name>/manifest.json` in this repo, or at the root of a
standalone eikon repo). The packed `.eikon`'s header carries
`source_url` pointing at this directory.

```json
{
  "name": "ares",
  "version": 1,
  "eikon_requires": ">=1",
  "source": "base.png",
  "states": {
    "idle":      { "file": "states/idle/loop.mp4" },
    "listening": { "file": "states/listening/loop.mp4" },
    "thinking":  { "file": "states/thinking/start.mp4" },
    "speaking":  { "file": "states/speaking/loop.mp4" },
    "working":   { "file": "states/working/loop.mp4" },
    "error":     { "file": "states/error/start.mp4" }
  }
}
```

| Field | Type | Req | |
|---|---|---|---|
| `name` | string | yes | `^[a-z0-9-]{2,32}$`. Must match the enclosing folder. |
| `version` | int | no | Avatar content revision. Informational. |
| `eikon_requires` | string | no | Minimum `.eikon` format version (`>=N`, `==N`). `install()` refuses on mismatch. |
| `source` | string | no | Still portrait, relative to manifest dir. Becomes `base.<ext>` on install. |
| `states.<k>.file` | string | per | Clip path, relative to manifest dir. `<k>` ∈ the six reserved states. Becomes `<k>.<ext>` on install. |

Registry manifests are linted as public content. Source and state paths must be
relative paths inside the eikon directory, referenced files must exist, source
stills must be at most 250 KB, and installed `origin` blocks must not be
committed back to the registry.

## Installed form

`install()` writes the manifest back to `<dest>/<name>/manifest.json`
with one additional block — authors never ship this:

```json
"origin": {
  "source": "github.com/liftaris/eikon",
  "at": "2026-05-16T…Z",
  "sha": "c7b4d37…"
}
```

`origin.at` is the dirty-check anchor: any file in the install dir with
an mtime more than 2s past `at` marks the eikon locally-modified; `eikon
update` and profile-distribution updates skip it unless forced.

## Legacy shape

`{ "files": ["base.png", "idle.mp4", …] }` is accepted. Roles are
derived from basename (`base` → base, a reserved state name → that
state, anything else → base).
