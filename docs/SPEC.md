# Eikon Launch Contract

**Version:** 1.0 launch contract
**Stream media type:** `application/vnd.eikon.stream+jsonl`
**Launch stream extension:** `.eikon`
**Migration input:** pre-launch implicit `.eikon` records

## Contract split

The Eikon contract consists of four separate shapes:

1. **Stream/document**: a line-oriented `.eikon` runtime artifact. It is enough to play an eikon without registry, package, network, or platform state.
2. **Package manifest**: an `eikon.package` install/edit/source contract with entrypoints, content-addressed file descriptors, compatibility, source media, poster assets, optional edit metadata, and optional extension declarations.
3. **Registry/catalog entry**: cheap, normalized, browser-safe discovery metadata with stable identity/source keys and URLs to package manifests, runtime streams, poster assets, and optional bundle exports.
4. **Platform metadata**: mutable service data such as download counts, likes, moderation, and account data.

Local rendering must not depend on package, catalog, or platform metadata. Catalog and platform fields may help users find, trust, or install an eikon, but they do not mutate stream bytes.

Retired pre-launch concepts stay out of the public launch shapes: no `.eikonl` runtime, no `.eikonpkg` package format, no runtime `source_url`, no package-owned runtime signal mappings, and no first-class `license`, `provenance`, `review`, or `reviewer` metadata fields. Those names may appear only in migration, rejection, or stripping behavior.

## Stream/document shape

A launch stream decodes to UTF-8 NDJSON. Every line is a typed record with a `type` field. The first line MUST be a `header` record. Unknown fields are ignored unless required by an unsupported required extension. A renderer MUST NOT perform network requests while parsing or rendering a `.eikon` stream.

The `.eikon` extension names the runtime artifact, not a required storage encoding. Stored bytes may be plain identity NDJSON or gzip-compressed NDJSON. When a package file descriptor is present, its `encoding` field is authoritative: `identity` bytes must not be gzip and `gzip` bytes must carry a gzip header. Standalone `.eikon` files without a descriptor may be sniffed by gzip magic bytes for local compatibility.

Digest-addressed runtime blobs bind stored bytes. `size` and `digest` describe the exact bytes fetched or installed; `decodedSize` and `decodedDigest` describe the UTF-8 NDJSON after explicit runtime decompression. Registries must serve gzip runtime blobs as raw artifact bytes, without HTTP `Content-Encoding: gzip`, because fetch clients can transparently decode that header before stored-byte digest checks run.

Minimal stream:

```jsonl
{"type":"header","eikon":1,"id":"liftaris/nous","version":"1.0.0","title":"Nous","author":{"name":"kaio"},"description":"Monochrome sidebar avatar","size":{"cols":48,"rows":24},"defaultSignal":"state.idle","signals":{"state.idle":{"clip":"idle"}},"extensions":{"used":[],"required":[]}}
{"type":"clip","name":"idle","fps":16,"frameCount":1,"loopFrom":0}
{"type":"frame","clip":"idle","index":0,"rows":["                                                "]}
```

### `header`

```ts
type HeaderRecord = {
  type: "header"
  eikon: 1
  id?: string
  version?: string
  title?: string
  author?: { name?: string }
  description?: string
  size: {
    cols: number
    rows: number
  }
  defaultSignal: string
  signals: Record<string, SignalMapping>
  extensions?: ExtensionSet
}

type SignalMapping = {
  clip: string
  fallback?: string
}
```

- `eikon` is the stream contract version. Launch uses `1`.
- `size.cols` and `size.rows` define every frame's grid dimensions.
- `id` and `version` are advisory identity hints only. Consumers may resolve them only through configured trusted registries.
- `title`, `author`, and `description` are advisory display text. Consumers must sanitize/escape them and must not let them affect playback or install identity.
- `defaultSignal` is the fallback signal, normally `state.idle`.
- `signals` maps canonical and namespaced custom runtime signals to clips. This mapping lives in the `.eikon` header so standalone streams render without a package manifest.
- The header MUST NOT contain origin URLs, edit-package URLs, source URLs, generator metadata, package digests, poster assets, license/provenance fields, platform metadata, or arbitrary download targets.

### `clip`

```ts
type ClipRecord = {
  type: "clip"
  name: string
  fps: number
  frameCount?: number
  loopFrom?: number
  color?: string
  extensions?: ExtensionSet
}
```

A clip is a named playback target. The six canonical lifecycle signals map to clips through the header `signals` object, but clip names themselves may be artistic or package-specific.

`loopFrom` preserves the current playback model:

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

`rows` must contain exactly `size.rows` strings, each renderable to `size.cols` columns. Frames for a clip are ordered by `index`. Streaming readers may render as frames arrive after seeing the header and current clip descriptor.

### `extension`

```ts
type ExtensionRecord = {
  type: "extension"
  extension: string
  payload: unknown
}
```

The generic `extension` record is reserved for future optional or required capabilities such as decorators, layers, backgrounds, and richer composition. Launch streams map signals to clips only. Future decorators/layers/backgrounds must enter through extension declarations and fallback behavior, not by adding required core behavior silently.

## Canonical lifecycle signals

These six names are canonical baseline lifecycle signals:

| Signal | Meaning |
|---|---|
| `state.idle` | Default/resting state |
| `state.listening` | Receiving user input |
| `state.thinking` | Processing/reasoning |
| `state.speaking` | Generating output |
| `state.working` | Executing tools/actions |
| `state.error` | Error or failure state |

Players that only understand the baseline lifecycle resolve these `state.*` signals through the stream header and fall back to `defaultSignal` when no more specific fallback exists. New behavior must not extend this global enum ad hoc; use namespaced custom signals instead.

## Signals and fallbacks

The `.eikon` header maps runtime signals to clips. Canonical lifecycle signals use the `state.*` namespace:

```json
{
  "defaultSignal": "state.idle",
  "signals": {
    "state.idle": { "clip": "idle" },
    "state.working": { "clip": "working", "fallback": "state.thinking" },
    "approval.waiting": { "clip": "thinking" }
  }
}
```

Rules:

- A basic launch player must support the six canonical `state.*` signals.
- Custom signals must be namespaced, for example `approval.waiting`, `tool.running`, `emotion.curious`, `notification.unread`, `voice.recording`, or `custom.<namespace>.*`.
- A custom signal may declare an explicit fallback to a canonical signal or another resolvable mapping.
- If a custom signal omits `fallback`, fallback defaults to `defaultSignal`.
- Unsupported optional mappings degrade through fallback.
- Launch mappings target clips only. Decorators, layers, backgrounds, and richer composition are future extension behavior.
- Unsupported required extension behavior fails before rendering.

## Extension and version behavior

Extensions are declared as `extensions.used` and `extensions.required` on stream or package shapes.

- Same-major optional unknown extensions are ignored and playback proceeds through fallback behavior.
- Same-major required unknown extensions fail cleanly with a structured compatibility error.
- Higher major stream versions fail unless the consumer explicitly declares compatibility.
- Old pre-launch records are not silently reinterpreted as launch streams. They enter through migration tooling.

Reserved extension namespaces for launch planning:

- `eikon.triggers.v1`: optional trigger-rule declarations. No host bridge behavior is defined by this contract.
- `eikon.decorators.v1`: future optional decorator/composition data.
- `eikon.layers.v1`: future optional or required layer/composition data.

## Conformance classes

- **Stream decoder/player:** validates header, typed records, version/extension behavior, frame dimensions, clip order, loop behavior, header-owned signal mappings, and baseline lifecycle fallback. It renders without network or package metadata.
- **Package reader:** validates package manifest shape, entrypoints, content-addressed file descriptors, compatibility, source/poster descriptors, optional edit metadata, and optional trigger declarations.
- **Catalog client:** loads cheap entries only, treats package/detail/runtime URLs as registry data, and avoids host-only imports.
- **Registry generator:** verifies package descriptors, URL/path safety, digest/size policy, poster constraints, metadata escaping, compatibility, and trusted-registry publication policy before publication.
- **Editor/migrator:** can read old pre-launch `.eikon` input, report moved/dropped metadata, write launch `.eikon`/package output with backup, or produce an explicit failure.

## Pre-launch migration expectations

Old pre-launch `.eikon` drafts used implicit line roles: header lines had `eikon:1`, state lines had `state`, frame lines had `f`. That shape is now a migration input, not the launch contract.

Migration/adaptation must:

- Detect old draft records by content/header shape, not by extension alone.
- Convert header/state/frame records into typed `header`/`clip`/`frame` records.
- Preserve the six canonical lifecycle signals when present and provide explicit/defaultSignal fallback behavior for missing states.
- Move author, source/edit URLs, digest/source-key data, and discovery metadata into package/catalog/platform shapes where appropriate; drop unsupported license/provenance fields instead of relocating them.
- Report metadata that was moved, dropped, or could not be represented.
- Write launch `.eikon` output and keep a backup of the original draft input.

## Browser-safe boundary

Browser-safe consumers may import contract shapes, stream/package/catalog validators, catalog loading/search, and runtime preview helpers that do not touch host APIs. Browser code must not import install, publish, GitHub, filesystem, SSH, OpenTUI, or Herm-specific modules.
