# Timeline settings, video audio, and project persistence

Date: 2026-10-16  
Status: approved (approach 1)  
Scope: FreeFilmCut three.js editor Timeline (`FccTimelineEditor` / `FccTimelineIO` / project save)

## Goals

1. **Duration & FPS editable** in both Timeline editor toolbar and object sidebar; shared data.
2. **Duration may be shorter than content** — playback clamps to `[0, duration]`; clips past the end are not sampled.
3. **Video audio during Timeline play** — multi video tracks stay synced to a Timeline master clock.
4. **Project save persists Timeline tracks** via `assets/timelines/*.json` (auto-flush); reload loads by `projectPath`.

## Non-goals

- Embedding full track JSON in `userData.fccTimeline`.
- Video-element–driven master clock (rejected for multi-track sync).
- NLE / VFX pack format changes beyond existing `assets/timelines` / exporter paths.
- Scrub-time audio (scrub seeks only; silent is OK).

## Decisions (locked)

| Topic | Choice |
|-------|--------|
| UI placement | **C** — Timeline toolbar + sidebar, same asset/UD |
| Duration vs content | **C** — may be shorter than last clip end |
| Persistence | **A** — auto-save sidecar on project save; load via `projectPath` |
| Playback | **Approach 1** — Timeline master clock; each video track `play`/`seek` independently |

## 1. Duration / FPS

### Data

- Source of truth while editing: `object.__fccTimelineAsset` (`duration`, `fps`, `loop`, `tracks`).
- Mirror on `object.userData.fccTimeline`: `duration`, `fps`, `loop`, `projectPath`, `active`.
- Sidebar and Timeline toolbar both read/write the same fields; changing one refreshes the other when the panel is open.

### Toolbar UI

- Next to the time readout: **End (s)** number + **FPS** select (`24` / `25` / `30`, match sidebar).
- On change: update `asset` + `userData`; snap `playTime` into new duration; `updateUI` / relayout lanes; do **not** force-raise duration from clip extents.

### Sidebar

- Keep existing Duration / FPS / Loop / Active controls.
- `writeUD` also updates `__fccTimelineAsset` when present (and Timeline editor live asset if that object is open).

### Duration rules

- User-set `duration` is authoritative for play range and ruler.
- Adding clips / drag-resize / number edits must **not** call `Math.max(asset.duration, computeContentDuration(...))` to expand duration.
- `computeContentDuration` remains available for exporters / “fit to content” if added later; not auto-applied on edit.
- Playback / scrub: `t = clamp(t, 0, duration)` (existing loop modes unchanged).

## 2. Multi-track video audio

### Root cause

`seekVideoPlayer` only sets `currentTime`. HTML media needs `play()` for audible output; editor audio uses Web Audio (`resumeAndRouteVideos` / `__fccSound`).

### Behavior

| State | Video in active clip | Outside clip / muted track |
|-------|----------------------|----------------------------|
| Timeline **playing** | `play()`; route audio; correct `currentTime` only if drift ≳ 1 frame | `pause()` |
| **Pause** / **Stop** | `pause()` | `pause()` |
| **Scrub** | seek only (`pause` preferred) | `pause()` |

- Respect track `muted` and VideoPlayer `muted` / `volume` via existing gain path.
- Multiple video tracks: each bound VideoPlayer independently play/pause/seek against the same Timeline `t`.
- Drift threshold: keep / reuse ~`1/60` s (or `1/fps`) before rewriting `currentTime` so audio is not chopped every frame.

### API shape

Extend seek helper (or sibling) e.g. `seekVideoPlayer(obj, mediaT, { loop, playing })`:

- `playing === true` → ensure routed + `video.play()`.
- else → `video.pause()` after seek when needed.

`sampleTimeline` (or editor wrapper) passes `playing` from Timeline play state for video tracks only.

## 3. Project persistence

### Save (File → Save project)

Before / as part of writing `project.json`:

1. Traverse scene for `userData.fccTimeline`.
2. For each object with `__fccTimelineAsset` (or load-from-memory if editor holds it), call `saveTimelineAsset(editor, object, asset)`.
3. Ensures `assets/timelines/<slug>.timeline.json` exists and `userData.fccTimeline.projectPath` is set.

If no in-memory asset and `projectPath` already points at a file, leave file as-is (no wipe).

### Load

- Unchanged primary path: `openFor` → `loadTimelineAsset` reads `ud.projectPath` via project folder.
- Missing / invalid file → empty asset (current behavior).

### Timeline window Save button

- Remains; same `saveTimelineAsset` as project flush.

## 4. Files to touch (implementation hint)

- `three.js/editor/js/timeline/FccTimelineEditor.js` — toolbar duration/fps; video play/pause; stop auto-expand duration.
- `three.js/editor/js/Sidebar.Object.Timeline.js` — sync `__fccTimelineAsset` / open editor.
- `three.js/editor/js/timeline/FccTimelineCore.js` — optional `playing` flag into video sampling (or keep policy in editor seek helper only).
- `three.js/editor/js/Menubar.File.js` (or project-save helper) — flush all Timeline assets before `saveProjectJson`.
- Cache-bust `?v=` for touched editor modules in `index.html`.

## 5. Acceptance

- [ ] End time and FPS editable in Timeline window and sidebar; stay in sync.
- [ ] Setting end time shorter than last clip end stops play at end; later clips ignored.
- [ ] Timeline Play: video track(s) audible (multi-track OK); Pause/Stop silent; scrub no requirement for audio.
- [ ] Edit tracks → File Save → reopen project → open Timeline → tracks/clips restored from `assets/timelines/`.

## 6. Out of scope follow-ups

- “Fit duration to content” button.
- Scrub preview audio.
- Per-clip audio fade / ducking.
