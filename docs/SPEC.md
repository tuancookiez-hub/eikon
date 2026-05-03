# .eikon File Format Specification

**Version:** 1
**Status:** Draft
**Media Type:** `application/x-eikon`
**Extension:** `.eikon`

## Overview

`.eikon` is a text-based file format for stateful ASCII animation. It encodes
named animation states (e.g. idle, thinking, speaking) each containing a
sequence of ASCII art frames with per-state and per-frame metadata.

Unlike terminal recordings (`.cast`), `.eikon` files are authored content with
first-class support for behavioral states, looping, and frame-level control.

## Format

NDJSON (newline-delimited JSON). Each line is a self-contained JSON object.
UTF-8 encoded. Lines are separated by `\n` (LF).

## Structure

```
line 1:      header
line 2..N:   state declarations and frame data (interleaved)
```

A state declaration is always followed by its frames in order.
States appear in the recommended display order.

## Header (line 1)

```json
{"eikon":1,"name":"nous-girl","width":50,"height":24,"author":"kaio","license":"MIT","created":"2026-04-14T23:02:15Z"}
```

| Field      | Type   | Required | Description                          |
|------------|--------|----------|--------------------------------------|
| `eikon`    | int    | yes      | Format version. Currently `1`.       |
| `name`     | string | yes      | Avatar/animation name.               |
| `width`    | int    | yes      | Frame width in columns.              |
| `height`   | int    | yes      | Frame height in rows.                |
| `author`   | string | no       | Creator name or handle.              |
| `license`  | string | no       | License identifier (SPDX).           |
| `created`  | string | no       | ISO 8601 creation timestamp.         |
| `url`      | string | no       | Source URL or registry link.          |
| `description` | string | no   | Human-readable description.          |

## State Declaration

```json
{"state":"idle","fps":8,"color":"#7aa2f7","frame_count":48,"loop":true}
```

| Field         | Type   | Required | Description                                |
|---------------|--------|----------|--------------------------------------------|
| `state`       | string | yes      | State name. Unique within the file.        |
| `fps`         | number | yes      | Playback frame rate for this state.        |
| `color`       | string | no       | Default display color (hex).               |
| `frame_count` | int    | yes      | Number of frame lines that follow.         |
| `loop_from`   | int    | no       | First frame of the loop segment. See below.|
| `loop`        | bool   | no       | Deprecated alias: `false` ⇔ `loop_from: frame_count`. |

### `loop_from`

Splits the state's frames into an **intro** (`0 .. loop_from-1`) played once,
and a **loop** (`loop_from .. frame_count-1`) repeated indefinitely.

| Value                 | Behavior                                        |
|-----------------------|-------------------------------------------------|
| absent or `0`         | Loop the whole sequence (no intro).             |
| `0 < N < frame_count` | Play intro `0..N-1` once, then loop `N..end`.   |
| `N == frame_count`    | Play once, hold the last frame. No loop.        |

This maps directly to the common `start.mp4` + `loop.mp4` authoring pattern:
concatenate both clips' frames into one state and set `loop_from` to the
intro's frame count.

## Frame

```json
{"f":0,"data":"line1\nline2\nline3\n..."}
```

| Field     | Type   | Required | Description                                      |
|-----------|--------|----------|--------------------------------------------------|
| `f`       | int    | yes      | Frame index (0-based, sequential).               |
| `data`    | string | yes      | Frame content. Lines joined by `\n`.             |
| `pause`   | number | no       | Pause after this frame, in seconds.              |
| `color`   | string | no       | Override color for this frame only.              |

### Frame Ordering

Frames MUST appear in order (`f`: 0, 1, 2, ...) immediately after their
parent state declaration. `frame_count` in the state MUST match the number
of frame lines that follow.

## Example

```jsonl
{"eikon":1,"name":"nous-girl","width":50,"height":24,"author":"kaio"}
{"state":"idle","fps":8,"color":"#7aa2f7","frame_count":3,"loop":true}
{"f":0,"data":"     .---.\n    ( o.o )\n     |   |\n     '---'"}
{"f":1,"data":"     .---.\n    ( o.o )\n     | - |\n     '---'"}
{"f":2,"data":"     .---.\n    ( o.o )\n     |   |\n     '---'","pause":0.5}
{"state":"error","fps":12,"color":"#f7768e","frame_count":2,"loop":true}
{"f":0,"data":"     .---.\n    ( x.x )\n     |   |\n     '---'"}
{"f":1,"data":"     .---.\n    ( X.X )\n     | ! |\n     '---'"}
```

## Playback Rules

1. **Loop:** After the last frame, playback returns to `loop_from` (default
   `0`). If `loop_from == frame_count`, playback holds the last frame.
2. **Pause:** When a frame has `pause`, the player holds that frame for the
   specified duration (in seconds) before advancing. This is additive to the
   normal frame timing from `fps`.
3. **State switching:** The consumer controls which state is active. Switching
   states restarts playback from frame 0 of the new state — the intro always
   plays on state entry.
4. **Color precedence:** Frame `color` > State `color` > consumer default.

## Reserved State Names

These state names have conventional meaning for agent avatars:

| State       | Meaning                        |
|-------------|--------------------------------|
| `idle`      | Default/resting state          |
| `listening` | Receiving user input           |
| `thinking`  | Processing/reasoning           |
| `speaking`  | Generating output              |
| `working`   | Executing tools/actions        |
| `error`     | Error or failure state         |

Other state names are allowed. Consumers SHOULD fall back to `idle` for
unknown states.

## Design Notes

- **Why NDJSON:** Human-inspectable, line-oriented tooling (grep, head, wc),
  streamable, git-diffable at the line level.
- **Why frames are separate lines:** Per-frame extensibility (pause, color
  overrides, future fields) without touching the state schema.
- **Why text over binary:** ASCII art is text. The format should be native
  to its content. Compression is left to the transport layer (gzip).
- **Newlines in frame data:** The `data` field uses literal `\n` (JSON
  escaped) to encode line breaks within a frame. Each frame is exactly
  `height` lines.
