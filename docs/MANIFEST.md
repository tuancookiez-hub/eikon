# Eikon Package Manifest

**Kind:** `eikon.package`
**Schema version:** `1.0`
**Status:** Draft for launch implementation

The package manifest is the launch package contract for an eikon. It describes how to find renderable streams, editable source media, poster/preview assets, compatibility, signal mappings, and optional extension data. It is separate from the stream format and from the public catalog entry.

Legacy source manifests are still accepted by compatibility code during migration, but the launch manifest below is the shape gallery, registry, Herm marketplace, and package readers should target.

## Minimal manifest

```json
{
  "kind": "eikon.package",
  "schemaVersion": "1.0",
  "id": "liftaris/nous",
  "name": "nous",
  "compatibility": { "eikon": ">=2 <3" },
  "entrypoints": { "default": "streams/nous.eikonl" }
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
    "eikon": ">=2 <3",
    "hosts": { "herm": ">=0.0.0" }
  },
  "entrypoints": {
    "default": "streams/nous.eikonl"
  },
  "files": [
    { "path": "streams/nous.eikonl", "role": "stream", "mediaType": "application/vnd.eikon.stream+jsonl", "size": 12345, "digest": "sha256:..." },
    { "path": "poster.txt", "role": "poster", "mediaType": "text/plain" },
    { "path": "preview.mp4", "role": "preview", "mediaType": "video/mp4" }
  ],
  "source": {
    "base": "source/base.png",
    "states": {
      "idle": { "file": "source/states/idle/loop.mp4", "role": "loop" },
      "thinking": { "file": "source/states/thinking/start.mp4", "role": "start" }
    }
  },
  "poster": "poster.txt",
  "preview": "preview.mp4",
  "signals": {
    "state.idle": { "clip": "idle", "fallback": "state.idle" },
    "state.listening": { "clip": "listening", "fallback": "state.idle" },
    "state.thinking": { "clip": "thinking", "fallback": "state.idle" },
    "state.speaking": { "clip": "speaking", "fallback": "state.thinking" },
    "state.working": { "clip": "working", "fallback": "state.thinking" },
    "state.error": { "clip": "error", "fallback": "state.idle" },
    "approval.waiting": { "clip": "thinking", "fallback": "state.thinking" }
  },
  "triggers": [
    { "signal": "approval.waiting", "when": "reserved.host-rule", "fallback": "state.thinking" }
  ],
  "extensions": {
    "used": ["eikon.signals.v1", "eikon.triggers.v1"],
    "required": []
  },
  "legacy": {
    "sourceFormat": ".eikon",
    "migration": "converted",
    "notes": ["author/license moved from v1 header to display/catalog metadata"]
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
| `version` | no | Package content version. Registry policy may require it later. |
| `display` | no | Human-facing title, author, glyph, description, and tags. |
| `compatibility.eikon` | yes | Eikon contract range, for example `>=2 <3`. |
| `compatibility.hosts` | no | Optional host ranges. Host incompatibility must not affect generic stream rendering. |
| `entrypoints.default` | yes | Relative path to the default launch stream. |
| `files` | no | Relative file descriptors with optional media type, size, digest, and role. |
| `source` | no | Editable source media. It is not required for playback. |
| `poster` | no | Relative poster asset for cheap grid/catalog display. |
| `preview` | no | Relative selected-preview asset. |
| `signals` | no | Package-level runtime signal mappings with fallbacks. |
| `triggers` | no | Reserved optional trigger-rule extension data. |
| `extensions` | no | Optional and required extension declarations. |
| `legacy` | no | Compatibility/migration notes for packages derived from v1 `.eikon`. |

All file paths are package-relative. Package readers and registry tooling must reject parent escapes, absolute paths, private/file URLs in remote contexts, and unsafe metadata before rendering or installing.

## Catalog entry shape

A catalog entry is not a package manifest. It is cheap discovery data that points at package/detail assets:

```json
{
  "kind": "eikon.catalog.entry",
  "schemaVersion": "1.0",
  "id": "liftaris/nous",
  "sourceKey": "github:liftaris/eikon:eikons/nous",
  "name": "nous",
  "title": "Nous",
  "author": "kaio",
  "description": "Monochrome sidebar avatar",
  "glyph": "⬡",
  "tags": ["monochrome"],
  "poster": "https://eikon.liftaris.dev/eikons/nous/poster.txt",
  "preview": "https://eikon.liftaris.dev/eikons/nous/preview.mp4",
  "packageUrl": "https://eikon.liftaris.dev/eikons/nous/manifest.json",
  "detailUrl": "https://eikon.liftaris.dev/eikons/nous",
  "installUrl": "https://eikon.liftaris.dev/eikons/nous/manifest.json",
  "compatibility": { "eikon": ">=2 <3", "hosts": { "herm": ">=0.0.0" }, "available": true },
  "trust": { "reviewed": true, "reviewer": "registry", "source": "github.com/liftaris/eikon", "digest": "sha256:..." }
}
```

Catalog clients may search by `name`, `title`, `author`, and `tags`. Installed-state matching should prefer `id` and `sourceKey`; name-only matching is a legacy fallback.

## Platform metadata

Platform metadata is mutable service or policy state. Examples include canonical detail URL, source URL, license/provenance display, review records, likes, downloads, moderation, and account/auth data. It may appear beside catalog entries in a registry service, but it is not needed for package playback and must not be embedded as required rendering data.

## Signal mappings and triggers

The six canonical lifecycle signals are:

- `state.idle`
- `state.listening`
- `state.thinking`
- `state.speaking`
- `state.working`
- `state.error`

Packages may declare custom namespaced signals such as `approval.waiting` or `tool.running`. Every custom signal must have a fallback to a canonical signal, canonical clip, or another resolvable package mapping.

`triggers` reserves future host rules for when signals happen. Launch packages may include trigger declarations only as optional extension data. No Hermes plugin bridge, semantic classifier, or arbitrary host-code transport is required by the release contract.

## Extension behavior

- Unknown optional extensions listed in `extensions.used` are ignored and resolved through fallback behavior.
- Unknown required extensions listed in `extensions.required` fail cleanly before rendering/installing.
- Required trigger support is not part of launch.

Reserved launch extension names:

- `eikon.signals.v1`
- `eikon.triggers.v1`

## Legacy manifest migration

The previous manifest shape described editable source media only:

```json
{
  "name": "ares",
  "version": 1,
  "eikon_requires": ">=1",
  "source": "base.png",
  "states": { "idle": { "file": "states/idle/loop.mp4" } }
}
```

Compatibility code may still read that shape to install or migrate existing assets. Launch migration should produce an `eikon.package` manifest and report moved/dropped metadata:

- `eikon_requires` becomes `compatibility.eikon`.
- source and state media move under `source` and file descriptors.
- packed `.eikon` data converts to a launch stream entrypoint or remains behind a `legacy.migration: "adapt"` note.
- author, license, provenance, source URL, and trust data move to display/catalog/platform fields as appropriate.

## Browser-safe boundary

Browser-safe exports may expose contract types, catalog normalization/search, package read validation, and preview helpers. They must not import host-only install, publish, GitHub, filesystem, SSH, OpenTUI, or Herm-specific code.

## Non-goals

- This manifest does not define browser-native install/use/publish/auth.
- This manifest does not require plugin code inside packages.
- This manifest does not make a Hermes plugin bridge part of launch.
- This manifest does not treat the superseded 2026-05-30 marketplace/sharing documents as active authority.
