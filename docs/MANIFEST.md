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

## Catalog index fields

`eikons/index.json` is the public registry catalog. It is intentionally cheap
to list: entries carry poster and metadata, not the full `.eikon` body. Current
legacy fields remain valid:

```json
{
  "name": "ares",
  "author": "kaio",
  "glyph": "⚔",
  "w": 48,
  "h": 24,
  "source": "ares/",
  "poster": "..."
}
```

V1 registry generation may also emit enriched fields:

| Field | Description |
|---|---|
| `description` | Human-readable catalog copy. |
| `license` | SPDX/license string from the eikon header. |
| `provenance` | Human-authored source/provenance note. |
| `review_status` | Registry state such as `reviewed`, `pending`, or `unreviewed`. |
| `source_url` | Human/source provenance URL. Kept distinct from preview/install URLs. |
| `preview_url` | URL of the packed `.eikon` body for lazy preview/full load. |
| `install_url` | Manifest/source base URL used by install resolution. |

Consumers should use the package catalog client to normalize old and enriched
entries. The client derives stable `identityKey`/`sourceKey` values from the
source directory so entries with colliding display names are not conflated.

The canonical public v1 catalog base is
`https://eikon.liftaris.dev/eikons`. Generated `source_url`, `preview_url`, and
`install_url` values are rooted there by default. Mirrors should serve
`index.json`, packed `.eikon` files, `manifest.json`, and source media with
CORS headers that allow browser discovery clients to fetch them and with normal
HTTP caching; consumers should treat the catalog as reloadable and full bodies
as lazy assets.

Public catalog URLs are constrained to `http`/`https`, the catalog asset root,
and non-private hosts. `file:`, localhost/private networks, parent path escapes,
root escapes, and mutable unreviewed external sources are not valid public
catalog preview/install URLs.

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
