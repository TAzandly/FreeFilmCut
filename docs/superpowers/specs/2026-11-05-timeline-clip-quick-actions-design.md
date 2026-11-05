# Timeline clip quick actions (freeze / reverse / mirror / rotate)

## Goal

Add CapCut-style shortcut buttons above the timeline for common clip transforms. Buttons appear only when the current selection supports them (hide, do not disable).

## Approach

Extend the existing `TimelineToolbar` + `invokeAction` + `Command` stack (same pattern as split / duplicate). No effect-graph nodes; mirror and rotate mutate existing transform params; reverse is a new per-clip flag; freeze inserts a still image clip.

## Scope

### In scope (v1)

| Action | Selection gate (show button) | Behavior |
|--------|------------------------------|----------|
| Freeze | Exactly one `video` | Capture last visible frame → 3s image clip after source on same track with forced ripple |
| Reverse | Exactly one `video` | Toggle `reversed` on that clip only; audio follows; toggle again restores |
| Mirror | ≥1 selection containing `video` \| `image` \| `sticker` | For each matching element: `transform.scaleX *= -1` |
| Rotate 90° | Same as mirror | For each matching element: `transform.rotate = (rotate + 90) % 360` |

- Multi-select: mirror / rotate apply to all matching types in the selection; freeze / reverse stay single-video-only.
- Unsupported types in a mixed selection are skipped (e.g. text ignored by mirror).
- No selection / only unsupported types → none of the v1 action buttons render.
- Crop: **not shown** in v1 (separate future feature with its own canvas UI).

### Out of scope (v1)

- Crop UI / crop rect params
- Vertical flip
- Freeze extending linked/separated audio by 3s
- Reverse waveform UI flip
- Offline reverse-transcode files (use existing frame cache + seek)
- Freeze / reverse on multi-select

## Toolbar UX

- Location: left cluster of `TimelineToolbar` (near split / duplicate). Replace the existing disabled “Freeze frame (coming soon)” placeholder; add reverse / mirror / rotate.
- Icons: match CapCut-style references (freeze brackets, reverse circular play, mirror triangles, rotate arrows). Prefer Hugeicons / existing icon set closest match.
- Reverse button uses active styling when the selected video has `reversed === true`.
- Tooltips in English for now (i18n is a separate track).

## Freeze

### Pipeline (one undoable `BatchCommand`)

1. Resolve the **last visible frame** of the selected video on the timeline (end of its playable range). If `reversed`, that is the frame the viewer sees at clip end (near the trimmed source start under reverse mapping).
2. Extract via `videoCache.getFrameAt` → PNG/WebP blob.
3. `AddMediaAssetCommand` — new image asset in the project media library (does not mutate the source video).
4. Insert a **3.0s** `image` element on the **same track**, start = `video.startTime + video.duration`, copying the video’s transform params (position / scale / rotate / mirror) so the still matches the preceding picture.
5. Ripple: shift every later element on that track by +3s. **Always** ripple for freeze; ignore the toolbar “ripple editing” toggle so the still never overlaps following clips.

### Edge cases

- Frame extract failure → toast; timeline unchanged.
- Very short / heavily trimmed clips still freeze their timeline end frame.
- Separated source-audio tracks are **not** extended (picture-only freeze).

### Undo

Batch undoes asset add, image insert, and ripple shifts together.

## Reverse

### Data model

Add optional `reversed?: boolean` on `VideoElement` (default `false`). Do **not** encode reverse as negative `retime.rate` — existing retime clamps to positive rates and means speed change; reverse is orthogonal and may stack with retime.

### Toggle

`UpdateElementsCommand` flips `reversed` on the single selected video. Other clips that share the same `mediaId` are untouched.

### Source-time mapping (preview + export + audio)

Shared helper used by renderer resolve and audio sampling:

```text
forwardSource = trimStart + getSourceTimeAtClipTime(localTime, retime)
span          = trimmed source length
if reversed:
  source = 2 * trimStart + span - forwardSource
else:
  source = forwardSource
```

- Video: `resolve.ts` / `videoCache.getFrameAt` consume the mapped source time.
- Audio: embedded and separated source-audio that play under this video’s time window follow the **video clip’s** `reversed` flag (single source of truth — do not duplicate a separate audio `reversed` unless a later design needs it).
- Do not rely on negative HTMLMediaElement `playbackRate`; keep seek / cache frame path.

### Interactions

- Stacks with `retime`, mirror, and rotate.
- Freeze after reverse uses the reverse-aware “last visible frame”.

## Mirror and rotate

- Types: `video`, `image`, `sticker` only.
- Mirror: `params["transform.scaleX"] = (current ?? 1) * -1`. Compositor already treats negative scaleX as horizontal flip (`flipX`).
- Rotate: `params["transform.rotate"] = normalizeDegrees((current ?? 0) + 90)` into `[0, 360)`.
- Same keys as the media properties panel — toolbar is a shortcut only.
- Multi-select mirror: each element toggles independently (not “force all flipped”).
- Single `UpdateElementsCommand` for the batch.

## Actions and commands

| Action id | Command shape | Primary touch points |
|-----------|---------------|----------------------|
| `freeze-frame` | `BatchCommand` (asset + insert + ripple) | `videoCache`, media commands, timeline insert / shift |
| `toggle-reverse` | `UpdateElementsCommand` | `VideoElement.reversed`, resolve source time, audio sample path |
| `mirror` | `UpdateElementsCommand` | `transform.scaleX` |
| `rotate-90` | `UpdateElementsCommand` | `transform.rotate` |

Wire handlers through the existing actions registry / `use-editor-actions` pattern used by split and duplicate.

## Architecture

```text
TimelineToolbar (visibility from selection)
  → invokeAction(...)
    → Command / BatchCommand
      → media / timeline / params
        → resolve + compositor + audio read new semantics
```

## Verification

1. Image (or sticker) selected → freeze and reverse buttons absent; mirror / rotate present.
2. Single video → all four v1 buttons present; reverse toggles active state.
3. Multi-select videos → mirror / rotate shown; freeze / reverse hidden.
4. Freeze inserts 3s image after clip, later clips shift, undo restores.
5. Reverse: end of clip shows near source start of the trimmed range; second click restores; sibling segments of same media unchanged; sound plays reversed with picture.
6. Mirror / rotate update properties panel values; undo works; preview matches.

## Future: crop

Separate design: modal / dedicated crop surface, persist crop rect on the element, preview + export honor crop. Not part of this implementation plan.
