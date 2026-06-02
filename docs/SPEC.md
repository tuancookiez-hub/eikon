# Eikon Launch Contract

**Version:** 2.0 launch contract
**Status:** Draft for launch implementation
**Stream media type:** `application/vnd.eikon.stream+jsonl`
**Launch stream extension:** `.eikonl`
**Legacy extension:** `.eikon` v1 compatibility input

This document defines the release contract that browser gallery, registry tooling, Herm marketplace, and future hosts consume. Legacy `.eikon` v1 remains readable through an explicit compatibility/migration path; its implicit NDJSON quirks do not define the launch format.

## Contract split

Eikon launch uses four separate shapes:

1. **Stream/document**: line-oriented rendering data. It is enough to play an eikon without registry or platform state.
2. **Package manifest**: package-local entrypoints, files, compatibility, source media, poster/preview assets, signal mappings, fallback rules, and optional extension declarations.
3. **Registry/catalog entry**: cheap, normalized, browser-safe discovery metadata with stable identity/source keys and URLs to package/detail assets.
4. **Platform metadata**: mutable or policy data such as review state, provenance text, license display, download counts, likes, moderation, and account data.

Local rendering must not depend on catalog or platform metadata. Catalog and platform fields may help users find, trust, or install an eikon, but they do not mutate artifact bytes.

## Stream/document shape

A launch stream is UTF-8 NDJSON. Every line is a typed record with a `type` field. Unknown fields are ignored unless required by an unsupported required extension.

Minimal stream:

```jsonl
{"type":"header","asset":{"version":"2.0","minVersion":"2.0","width":48,"height":24,"mediaType":"application/vnd.eikon.stream+jsonl"},"name":"nous","glyph":"⬡"}
{"type":"clip","name":"idle","fps":16,"frameCount":1,"loopFrom":0}
{"type":"frame","clip":"idle","index":0,"rows":["                                                "]}
```

### `header`

```ts
type HeaderRecord = {
  type: "header"
  asset: {
    version: string
    minVersion?: string
    width: number
    height: number
    mediaType?: "application/vnd.eikon.stream+jsonl"
  }
  name?: string
  glyph?: string
  extensions?: {
    used?: string[]
    required?: string[]
  }
}
```

- `asset.version` is the stream contract version. Launch uses `2.0`.
- `asset.width` and `asset.height` define every frame's grid dimensions.
- `name` and `glyph` are render-adjacent hints only. Author, license, provenance, review, install, and source URLs belong in package/catalog/platform shapes.

### `clip`

```ts
type ClipRecord = {
  type: "clip"
  name: string
  fps: number
  frameCount?: number
  loopFrom?: number
  fallback?: string
  color?: string
  extensions?: ExtensionSet
}
```

A clip is a named playback target. The six canonical lifecycle clips are reserved baseline names, but packages may define additional clips when they provide package-level signal mappings and fallbacks.

`loopFrom` preserves the v1 playback model:

- absent or `0`: loop the whole sequence.
- `0 < N < frameCount`: play intro frames once, then loop from `N`.
- `N == frameCount`: play once and hold the final frame.

### `frame`

```ts
type FrameRecord = {
  type: "frame"
  clip: string
  index: number
  rows: string[]
  pause?: number
  color?: string
  extensions?: ExtensionSet
}
```

`rows` must contain exactly `asset.height` strings, each renderable to `asset.width` columns. Frames for a clip are ordered by `index`. Streaming readers may render as frames arrive after seeing the header and current clip descriptor.

## Canonical lifecycle states

These six names are canonical and must remain the baseline lifecycle for Herm and basic players:

| State | Meaning |
|---|---|
| `idle` | Default/resting state |
| `listening` | Receiving user input |
| `thinking` | Processing/reasoning |
| `speaking` | Generating output |
| `working` | Executing tools/actions |
| `error` | Error or failure state |

Players that only understand the baseline lifecycle resolve `state.<name>` signals to these clips and fall back to `state.idle` when no more specific fallback exists. New package behavior must not extend this global enum ad hoc; use package-level signal mappings instead.

## Signals and fallbacks

Package manifests map runtime signals to clips, states, decorators, or other signals. Canonical lifecycle signals use the `state.*` namespace:

```json
{
  "signals": {
    "state.working": { "clip": "working", "fallback": "state.thinking" },
    "approval.waiting": { "clip": "thinking", "fallback": "state.thinking" }
  }
}
```

Rules:

- A basic launch player must support the six `state.*` signals.
- Custom signals must be namespaced, for example `approval.waiting` or `tool.running`.
- Every custom signal mapping must declare a fallback to a canonical signal, canonical clip, or another resolvable mapping.
- Unsupported optional mappings degrade through fallback.
- Unsupported required extension behavior fails before rendering.

## Extension and version behavior

Extensions are declared as `extensions.used` and `extensions.required` on stream or package shapes.

- Same-major optional unknown extensions are ignored and playback proceeds through fallback behavior.
- Same-major required unknown extensions fail cleanly with a structured compatibility error.
- Higher major stream versions fail unless the consumer explicitly declares compatibility.
- Lower/legacy versions are not silently reinterpreted as launch streams. They enter through the legacy adapter or migration tooling.

Reserved extension namespaces for launch:

- `eikon.signals.v1`: package-level signal mappings and fallback semantics.
- `eikon.triggers.v1`: optional trigger-rule declarations. This reserves schema space only; no Hermes plugin bridge is required for launch.

## Conformance classes

- **Stream decoder/player:** validates header, typed records, version/extension behavior, frame dimensions, clip order, loop behavior, and baseline lifecycle fallback.
- **Package reader:** validates package manifest shape, entrypoints, files, compatibility, source/poster/preview descriptors, signal mappings, and optional triggers.
- **Catalog client:** loads cheap entries only, treats package/detail/install URLs as data, and avoids host-only imports.
- **Registry generator:** verifies package descriptors, URL/path safety, digest/size policy, poster/preview constraints, metadata escaping, and compatibility before publication.
- **Editor/migrator:** can read legacy `.eikon` v1, report moved/dropped metadata, and produce launch stream/package output or an explicit failure.

## Legacy migration expectations

Legacy `.eikon` v1 used implicit line roles: header lines had `eikon:1`, state lines had `state`, frame lines had `f`. That shape is now a compatibility input, not the long-term launch contract.

Migration/adaptation must:

- Convert header/state/frame records into typed `header`/`clip`/`frame` records.
- Preserve the six canonical lifecycle states when present and provide explicit fallback behavior for missing states.
- Move author, license, source URL, provenance, trust, and discovery metadata into package/catalog/platform shapes where appropriate.
- Report metadata that was moved, dropped, or could not be represented.
- Keep current bundled/public assets readable until they are converted.

## Browser-safe boundary

Browser-safe consumers may import contract shapes, stream/package/catalog validators, catalog loading/search, and preview helpers that do not touch host APIs. Browser code must not import install, publish, GitHub, filesystem, SSH, OpenTUI, or Herm-specific modules.

## Non-goals

- No arbitrary plugin code is required inside an Eikon artifact to render it.
- No Hermes plugin bridge is part of the release contract; triggers are only reserved optional extension data.
- No browser-native install, use, publish, account, or auth workflow is implied by the stream/package contract.
- No platform statistics or moderation data are required for local rendering.
- No superseded 2026-05-30 marketplace/sharing CE document is active authority for this contract.
