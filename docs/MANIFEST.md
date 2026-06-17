# Eikon Package Manifest

**Kind:** `eikon.package`
**Schema version:** `1.0`
**Status:** Launch implementation-aligned

The package manifest is the launch install/edit/source contract for an eikon. It describes how to find renderable streams, optional editable source media, poster assets, compatibility, content-addressed file descriptors, and optional edit metadata. It is separate from the `.eikon` stream format and from the public catalog entry.

Older source-only manifests are still accepted by explicit migration/conversion tooling during conversion. Normal install/package readers reject source-only manifests and require the launch manifest below.

Launch public shapes do not define first-class `license`, `provenance`, `review`, or `reviewer` metadata fields. Migration/conversion tooling may reject, strip, or report those fields, but packages, catalog entries, platform metadata, and publish payloads should not expose them as active data.

## Minimal manifest

```json
{
  "kind": "eikon.package",
  "schemaVersion": "1.0",
  "id": "liftaris/nous",
  "name": "nous",
  "version": "1.0.0",
  "compatibility": { "eikon": ">=1 <2" },
  "entrypoints": { "default": "streams/nous.eikon" },
  "files": [
    { "path": "streams/nous.eikon", "role": "runtime", "mediaType": "application/vnd.eikon.stream+jsonl", "encoding": "gzip", "size": 12345, "digest": "sha256:<stored-bytes>", "decodedSize": 123456, "decodedDigest": "sha256:<decoded-ndjson>" }
  ]
}
```

## Full shape

```json
{
  "kind": "eikon.package",
  "schemaVersion": "1.0",
  "id": "liftaris/nous",
  "name": "nous",
  "version": "1.0.0",
  "display": {
    "title": "Nous",
    "author": "kaio",
    "description": "Monochrome sidebar avatar",
    "glyph": "⬡",
    "tags": ["monochrome"]
  },
  "compatibility": {
    "eikon": ">=1 <2"
  },
  "entrypoints": {
    "default": "streams/nous.eikon"
  },
  "files": [
    { "path": "streams/nous.eikon", "role": "runtime", "mediaType": "application/vnd.eikon.stream+jsonl", "encoding": "gzip", "size": 12345, "digest": "sha256:<stored-bytes>", "decodedSize": 123456, "decodedDigest": "sha256:<decoded-ndjson>" },
    { "path": "sources/base.png", "role": "source.base", "mediaType": "image/png", "size": 45678, "digest": "sha256:..." },
    { "path": "sources/states/thinking/loop.mp4", "role": "source.clip", "signal": "state.thinking", "mediaType": "video/mp4", "size": 456789, "digest": "sha256:..." },
    { "path": "posters/default.png", "role": "poster", "mediaType": "image/png", "size": 12345, "digest": "sha256:..." }
  ],
  "source": {
    "base": "sources/base.png",
    "states": {
      "thinking": { "file": "sources/states/thinking/loop.mp4" }
    }
  },
  "editability": {
    "sourcesIncluded": true,
    "mode": "full"
  },
  "poster": "posters/default.png",
  "triggers": [
    { "signal": "approval.waiting", "when": "reserved.host-rule", "fallback": "state.thinking" }
  ],
  "extensions": {
    "used": ["eikon.triggers.v1"],
    "required": []
  }
}
```

## Fields

| Field | Required | Description |
|---|---:|---|
| `kind` | yes | Must be `eikon.package`. |
| `schemaVersion` | yes | Package schema version. Launch uses `1.0`. |
| `id` | yes | Stable package identity, distinct from display title. |
| `name` | yes | Local install/display-safe slug. |
| `version` | yes for registry packages | Package content version. Registry-published versions should be immutable. |
| `display` | no | Human-facing title, author, glyph, description, and tags. Display text is untrusted. |
| `compatibility.eikon` | yes | Eikon contract range, for example `>=1 <2`. |
| `entrypoints.default` | yes | Relative path to the default launch `.eikon` stream. |
| `files` | yes for registry packages | Relative file descriptors with role, media type, size, and digest. Registry-served remote files require `size` and `digest`; gzip runtime descriptors also require `encoding`, `decodedSize`, and `decodedDigest`. |
| `source` | no | Optional editable source-media map. `source.base` and `source.states.<state>.file` point to package-relative files already covered by `files` descriptors when published through the registry. Runtime playback must not depend on these source files. |
| `editability` | no | Whether editable source/project files are included and how complete they are. |
| `poster` | no | Relative cached poster asset for cheap grid/catalog display. Standalone `.eikon` posters are derived from frames. |
| `triggers` | no | Reserved optional trigger-rule extension data. Trigger support is not required for launch playback. |
| `extensions` | no | Optional and required extension declarations. |

All file paths are package-relative. Human-authored/local manifests may use descriptive paths such as `streams/nous.eikon`; registry-normalized packages usually rewrite referenced files to content-addressed paths such as `blobs/sha256/<digest>`. Package readers and registry tooling must reject parent escapes, absolute paths, private/file URLs in remote contexts, symlinks/special files, and unsafe metadata before rendering or installing.

Runtime descriptor identity is byte-exact. `size` and `digest` always describe the stored artifact bytes at `path`, whether those bytes are identity NDJSON or gzip-compressed NDJSON. `encoding` may be omitted for identity descriptors and is otherwise `identity` or `gzip`. For registry gzip runtime descriptors, `decodedSize` and `decodedDigest` describe the UTF-8 NDJSON after explicit gzip decompression and are required with stored `size`/`digest`.

Digest-addressed gzip runtime blobs must be served as raw bytes. Do not set HTTP `Content-Encoding: gzip` on `blobs/sha256/<digest>` responses; clients fetch `arrayBuffer()`, verify stored-byte identity, then decompress according to descriptor metadata.

The package manifest does not own runtime signal-to-clip mappings. Those mappings live in the `.eikon` stream header so a standalone stream can render without a package manifest. Package tooling may validate, index, or cache derived signal information, but playback must not depend on package metadata.

## Registry/catalog entry shape

A catalog entry is not a package manifest. It is cheap discovery data that points at package/detail/runtime assets:

```json
{
  "kind": "eikon.catalog.entry",
  "schemaVersion": "1.0",
  "id": "liftaris/nous",
  "version": "1.0.0",
  "sourceKey": "registry:eikon.liftaris.dev:liftaris/nous@1.0.0",
  "name": "nous",
  "title": "Nous",
  "author": "kaio",
  "description": "Monochrome sidebar avatar",
  "glyph": "⬡",
  "tags": ["monochrome"],
  "poster": "<24-line text poster>",
  "runtimeUrl": "https://eikon.liftaris.dev/packages/liftaris/nous/blobs/sha256/<runtime-digest>",
  "packageUrl": "https://eikon.liftaris.dev/packages/liftaris/nous/1.0.0.json",
  "detailUrl": "https://eikon.liftaris.dev/eikons/liftaris/nous",
  "compatibility": { "eikon": ">=1 <2", "available": true },
  "trust": { "manifestDigest": "sha256:...", "runtimeDigest": "sha256:...", "runtimeSize": 12345, "runtimeEncoding": "gzip", "runtimeDecodedSize": 123456, "runtimeDecodedDigest": "sha256:..." }
}
```

Catalog clients may search by `name`, `title`, `author`, and `tags`. Installed-state matching should prefer validated registry identity, version, source key, and digest. Name-only matching must not decide remote install/active state.

`poster` in a catalog entry is cheap display data, normally an inline text poster for terminal-native grids and browser cards. `runtimeUrl` is the fetchable live-preview/runtime URL.

A shadcn-like registry may expose:

```text
registry.json
packages/<namespace>/<name>/index.json
packages/<namespace>/<name>/<version>.json
packages/<namespace>/<name>/blobs/sha256/<digest>
```

Inside a published package manifest, descriptor paths remain package-relative (`blobs/sha256/<digest>`). Catalog URLs expand those paths under the package root (`packages/<namespace>/<name>/blobs/sha256/<digest>`). A root-level `blobs/` mirror is not part of the launch registry shape unless a future registry explicitly chooses global deduplication.

Contributor PRs should commit both the source-side `eikons/<name>/` files and the generated package artifacts under `packages/<namespace>/<name>/`. Run `bun src/cli.tsx manifest --gzip`, `bun src/cli.tsx index`, and `bun run verify:artifacts` before opening or updating a registry PR. `eikons/index.json` is generated discovery metadata, not a hand-authored source of truth; submit PRs must not remove unrelated catalog entries.

Herm's normal marketplace flow resolves `id`/`version` through configured trusted registries, fetches the package manifest, verifies descriptor/path/size/digest/security policy, downloads the runtime `.eikon` by default, and fetches source/edit files lazily or selectively when needed. Direct GitHub sharing may use the same static registry shape: `github.com/owner/repo/name` selects a package from `eikons/index.json`, `registry.json`, root `index.json`, or an unambiguous `packages/<namespace>/<name>/index.json`; `github.com/owner/repo` remains the single-package fallback when no selector is provided.

## Platform metadata

Platform metadata is mutable service state. Examples include canonical detail URL, source URL, likes, downloads, moderation, and account/auth data. It may appear beside catalog entries in a registry service, but it is not needed for package playback, must not be embedded as required rendering data, and must not reintroduce retired public metadata fields.

## Signal mappings and triggers

Runtime signal mappings live in the `.eikon` stream header. Package manifests may declare optional trigger-rule extension data for future host/plugin integrations, but trigger support is not part of launch playback.

The six canonical lifecycle signals are:

- `state.idle`
- `state.listening`
- `state.thinking`
- `state.speaking`
- `state.working`
- `state.error`

Packages may include trigger declarations only as optional extension data. Launch package readers treat unsupported trigger, decorator, layer, semantic-classifier, and host-transport extensions according to the declared extension fallback rules.

## Extension behavior

- Unknown optional extensions listed in `extensions.used` are ignored and resolved through fallback behavior.
- Unknown required extensions listed in `extensions.required` fail cleanly before rendering/installing.
- Required trigger support is not part of launch.

Reserved launch/future extension names:

- `eikon.triggers.v1`
- `eikon.decorators.v1`
- `eikon.layers.v1`

## Legacy manifest migration

The previous source-only manifest shape described editable source media only:

```json
{
  "name": "ares",
  "version": 1,
  "eikon_requires": ">=1",
  "source": "base.png",
  "states": { "idle": { "file": "states/idle/loop.mp4" } }
}
```

Migration tools may read that legacy shape only to preserve existing assets during conversion. Normal package readers and installers reject it. Launch migration should produce an `eikon.package` manifest and report moved/dropped metadata outside the package manifest:

- `eikon_requires` becomes `compatibility.eikon`.
- source and state media move under file descriptors and optional editability metadata.
- draft `.eikon` data converts to a launch `.eikon` stream entrypoint.
- author, source/edit URLs, and digest/source-key data move to display/catalog/platform fields as appropriate; unsupported license/provenance fields are dropped.

## Browser-safe boundary

Browser-safe exports may expose contract types, catalog normalization/search, package read validation, and runtime preview helpers. They must not import host-only install, publish, GitHub, filesystem, SSH, OpenTUI, or Herm-specific code.
