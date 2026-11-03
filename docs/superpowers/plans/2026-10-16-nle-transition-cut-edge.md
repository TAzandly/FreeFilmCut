# NLE Cut-Edge Transitions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cut-point transitions on adjacent video/image clips: Jianying-style hatch UI, handle-first + freeze sampling, dual-texture pack bind (`uTransitionFrom` / `uTransitionTo`), duration via panel + symmetric edge drag with pack Timeline scaled to D.

**Architecture:** Persist `TransitionEdge` on each `VideoTrack` (not a timeline element). Pure helpers own adjacency, duration clamp, and media-handle source times. Commands mutate tracks; drag-drop hits cut seams; compositor emits a `cutTransition` frame item that dual-samples A/B into RTs and binds convention uniforms on the transition pack.

**Tech Stack:** TypeScript / React (freefilmcut `apps/web`), bun:test, Three.js compositor, existing VFX pack pipeline.

**Spec:** `docs/superpowers/specs/2026-10-16-nle-transition-cut-edge-design.md`

**Repo note:** Application code commits live in `freefilmcut/`. Design/plan markdown lives under `FreeFilmCut/docs/` (may be outside that git root — still save/update there).

---

## File map

| File | Responsibility |
|------|----------------|
| `freefilmcut/apps/web/src/timeline/types.ts` | `TransitionEdge`; `transitions` on `VideoTrack` |
| `freefilmcut/apps/web/src/timeline/transitions/types.ts` | Re-exports / narrow helpers types if needed |
| `freefilmcut/apps/web/src/timeline/transitions/adjacency.ts` | Find tight cuts; validate place target |
| `freefilmcut/apps/web/src/timeline/transitions/duration.ts` | Default D, clamp D_min / D_max |
| `freefilmcut/apps/web/src/timeline/transitions/media-handles.ts` | From/To source times + freeze |
| `freefilmcut/apps/web/src/timeline/transitions/prune.ts` | Drop invalid edges after move/delete/insert |
| `freefilmcut/apps/web/src/timeline/transitions/window.ts` | cut, `[start,end)`, progress `u` |
| `freefilmcut/apps/web/src/timeline/transitions/__tests__/*.ts` | Unit tests for pure helpers |
| `freefilmcut/apps/web/src/timeline/transitions/index.ts` | Public exports |
| `freefilmcut/apps/web/src/commands/timeline/transition/*.ts` | Upsert / remove / setDuration commands |
| `freefilmcut/apps/web/src/core/managers/timeline-manager.ts` | `upsertTransition` / `removeTransition` / `setTransitionDuration` |
| `freefilmcut/apps/web/src/timeline/controllers/drag-drop-controller.ts` | Transition pack → cut drop |
| `freefilmcut/apps/web/src/vfxpack/pack-placement.ts` | Drag hint for transition |
| `freefilmcut/apps/web/src/vfxpack/transition-input.ts` | From/To uniform name sets + scan/bind |
| `freefilmcut/apps/web/src/timeline/components/transition-overlay.tsx` | Hatch + ⋈ + symmetric resize |
| `freefilmcut/apps/web/src/timeline/components/index.tsx` | Mount overlay |
| Properties panel (existing selection UI) | Duration number when transition selected |
| `freefilmcut/apps/web/src/services/renderer/compositor/types.ts` | `cutTransition` frame item |
| `freefilmcut/apps/web/src/services/renderer/compositor/frame-descriptor.ts` | Emit transition items; suppress raw A/B in window |
| `freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts` | Dual RT + bind + render pack |
| `freefilmcut/apps/web/src/services/renderer/resolve.ts` | Optional: sample video/image outside visible clip for handles |

---

### Task 1: Types + VideoTrack.transitions

**Files:**
- Modify: `freefilmcut/apps/web/src/timeline/types.ts`
- Create: `freefilmcut/apps/web/src/timeline/transitions/index.ts` (barrel, empty exports OK until Task 2)

- [ ] **Step 1: Add `TransitionEdge` and track field**

In `types.ts`, after `Bookmark` (or near track types), add:

```ts
export interface TransitionEdge {
	id: string;
	trackId: string;
	fromElementId: string;
	toElementId: string;
	packId: string;
	duration: MediaTime;
}
```

Extend `VideoTrack`:

```ts
export interface VideoTrack extends BaseTrack {
	type: "video";
	elements: (VideoElement | ImageElement)[];
	muted: boolean;
	hidden: boolean;
	/** Cut-point transitions between adjacent elements on this track. */
	transitions?: TransitionEdge[];
}
```

- [ ] **Step 2: Ensure empty tracks initialize without breaking**

Any `buildEmptyTrack` / scene factory that creates `type: "video"` may omit `transitions` (optional). Grep `type: \"video\"` in `timeline/placement` and leave optional unless a strict clone spreads required fields.

- [ ] **Step 3: Commit**

```bash
cd freefilmcut
git add apps/web/src/timeline/types.ts apps/web/src/timeline/transitions/index.ts
git commit -m "feat(timeline): add TransitionEdge type on VideoTrack"
```

---

### Task 2: Pure helpers — adjacency, window, duration clamp

**Files:**
- Create: `freefilmcut/apps/web/src/timeline/transitions/adjacency.ts`
- Create: `freefilmcut/apps/web/src/timeline/transitions/window.ts`
- Create: `freefilmcut/apps/web/src/timeline/transitions/duration.ts`
- Create: `freefilmcut/apps/web/src/timeline/transitions/__tests__/adjacency.test.ts`
- Create: `freefilmcut/apps/web/src/timeline/transitions/__tests__/duration.test.ts`
- Modify: `freefilmcut/apps/web/src/timeline/transitions/index.ts`

- [ ] **Step 1: Write failing adjacency tests**

```ts
import { describe, expect, test } from "bun:test";
import { mediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import {
	areElementsAdjacent,
	findAdjacentPairAtTime,
} from "@/timeline/transitions/adjacency";

function el(id: string, start: number, duration: number) {
	return {
		id,
		name: id,
		type: "image" as const,
		mediaId: "m",
		startTime: mediaTime({ ticks: start }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		hidden: false,
		params: {},
	};
}

describe("areElementsAdjacent", () => {
	test("true when A.end === B.start", () => {
		const a = el("a", 0, 100);
		const b = el("b", 100, 100);
		expect(areElementsAdjacent({ from: a, to: b })).toBe(true);
	});

	test("false when gap", () => {
		const a = el("a", 0, 100);
		const b = el("b", 101, 100);
		expect(areElementsAdjacent({ from: a, to: b })).toBe(false);
	});
});

describe("findAdjacentPairAtTime", () => {
	test("finds cut under playhead-ish time", () => {
		const elements = [el("a", 0, 100), el("b", 100, 100)];
		const pair = findAdjacentPairAtTime({
			elements,
			time: mediaTime({ ticks: 100 }),
			tolerance: mediaTime({ ticks: 5 }),
		});
		expect(pair?.from.id).toBe("a");
		expect(pair?.to.id).toBe("b");
	});
});
```

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd freefilmcut/apps/web
bun test src/timeline/transitions/__tests__/adjacency.test.ts
```

Expected: module / export not found.

- [ ] **Step 3: Implement adjacency + window**

`adjacency.ts`:

```ts
import type { ImageElement, TimelineElement, VideoElement } from "@/timeline/types";
import type { MediaTime } from "@/wasm";
import { addMediaTime } from "@/wasm";

export type VisualMediaElement = VideoElement | ImageElement;

export function elementEnd({
	element,
}: {
	element: Pick<TimelineElement, "startTime" | "duration">;
}): MediaTime {
	return addMediaTime({ a: element.startTime, b: element.duration });
}

export function areElementsAdjacent({
	from,
	to,
}: {
	from: Pick<TimelineElement, "startTime" | "duration">;
	to: Pick<TimelineElement, "startTime">;
}): boolean {
	return elementEnd({ element: from }) === to.startTime;
}

export function findAdjacentPairAtTime({
	elements,
	time,
	tolerance,
}: {
	elements: VisualMediaElement[];
	time: MediaTime;
	tolerance: MediaTime;
}): { from: VisualMediaElement; to: VisualMediaElement } | null {
	const sorted = [...elements].sort((a, b) => a.startTime - b.startTime);
	for (let i = 0; i < sorted.length - 1; i++) {
		const from = sorted[i];
		const to = sorted[i + 1];
		if (!areElementsAdjacent({ from, to })) continue;
		const cut = elementEnd({ element: from });
		if (Math.abs(cut - time) <= tolerance) {
			return { from, to };
		}
	}
	return null;
}
```

`window.ts`:

```ts
import type { MediaTime } from "@/wasm";
import { addMediaTime, mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { elementEnd } from "./adjacency";
import type { TimelineElement } from "@/timeline/types";

export function transitionCutTime({
	from,
}: {
	from: Pick<TimelineElement, "startTime" | "duration">;
}): MediaTime {
	return elementEnd({ element: from });
}

export function transitionWindow({
	cut,
	duration,
}: {
	cut: MediaTime;
	duration: MediaTime;
}): { start: MediaTime; end: MediaTime } {
	const halfSec = mediaTimeToSeconds({ time: duration }) / 2;
	const half = mediaTimeFromSeconds({ seconds: halfSec });
	return {
		start: mediaTimeFromSeconds({
			seconds: mediaTimeToSeconds({ time: cut }) - halfSec,
		}),
		end: addMediaTime({ a: cut, b: half }),
	};
}

/** u in [0,1] for pack Timeline scale. */
export function transitionProgress({
	time,
	cut,
	duration,
}: {
	time: MediaTime;
	cut: MediaTime;
	duration: MediaTime;
}): number {
	const d = mediaTimeToSeconds({ time: duration });
	if (d <= 0) return 0;
	const t = mediaTimeToSeconds({ time });
	const c = mediaTimeToSeconds({ time: cut });
	const u = (t - (c - d / 2)) / d;
	return Math.min(1, Math.max(0, u));
}
```

- [ ] **Step 4: Duration helpers + tests**

`duration.ts`:

```ts
import type { FrameRate } from "opencut-wasm";
import type { MediaTime } from "@/wasm";
import {
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	roundFrameTime,
} from "@/wasm";

export const DEFAULT_TRANSITION_DURATION_SECONDS = 1;

export function defaultTransitionDuration({
	fps,
}: {
	fps: FrameRate;
}): MediaTime {
	return roundFrameTime({
		time: mediaTimeFromSeconds({
			seconds: DEFAULT_TRANSITION_DURATION_SECONDS,
		}),
		fps,
	});
}

export function clampTransitionDuration({
	duration,
	fromDuration,
	toDuration,
	fps,
}: {
	duration: MediaTime;
	fromDuration: MediaTime;
	toDuration: MediaTime;
	fps: FrameRate;
}): MediaTime {
	const min = roundFrameTime({
		time: mediaTimeFromSeconds({ seconds: 2 / 30 }),
		fps,
	});
	const maxByClips = mediaTimeFromSeconds({
		seconds:
			2 *
			Math.min(
				mediaTimeToSeconds({ time: fromDuration }),
				mediaTimeToSeconds({ time: toDuration }),
			),
	});
	const maxCap = mediaTimeFromSeconds({ seconds: 5 });
	const max =
		maxByClips < maxCap ? maxByClips : maxCap;
	let d = duration;
	if (d < min) d = min;
	if (d > max) d = max;
	return roundFrameTime({ time: d, fps });
}
```

Test: default ~1s; clamp below min rises; clamp above max falls.

- [ ] **Step 5: Run tests — expect PASS**

```bash
cd freefilmcut/apps/web
bun test src/timeline/transitions/__tests__/
```

- [ ] **Step 6: Export from barrel + commit**

```bash
cd freefilmcut
git add apps/web/src/timeline/transitions
git commit -m "feat(timeline): transition adjacency, window, duration helpers"
```

---

### Task 3: Media handles + freeze source time

**Files:**
- Create: `freefilmcut/apps/web/src/timeline/transitions/media-handles.ts`
- Create: `freefilmcut/apps/web/src/timeline/transitions/__tests__/media-handles.test.ts`

- [ ] **Step 1: Failing tests**

Cases:

1. From at `cut - D/2`: source uses clip-local `duration - D/2` (still inside A) → not frozen.
2. From at `cut + D/4` with handle remaining ≥ that → true frames past Out.
3. From past available handle → freeze at last available source second.
4. To before In into handle / freeze symmetric.

Use ticks: `TICKS_PER_SECOND` from `@/wasm`. Image: `sourceDuration` omitted → treat handle as infinite (never freeze for length reasons) OR freeze-equivalent OK — **prefer infinite handle for image** when `sourceDuration` undefined.

- [ ] **Step 2: Implement**

API:

```ts
export function resolveTransitionSourceTimeSeconds({
	role, // "from" | "to"
	element, // startTime, duration, trimStart, trimEnd, sourceDuration?, retime?
	timelineTime,
	cut,
}: { ... }): { sourceTimeSec: number; froze: boolean }
```

Logic sketch:

- `clipTime = timelineTime - element.startTime` (can be outside `[0, duration]`).
- Desired source ticks = `trimStart + getSourceTimeAtClipTime({ clipTime, retime })` when retime exists; else `trimStart + clipTime` for 1x.
- Available span: if `sourceDuration` set → `[trimStart, sourceDuration - trimEnd)`; else for image → no upper clamp (or very large).
- If desired > max → clamp to `max - epsilon`, `froze: true`.
- If desired < min → clamp to min, `froze: true`.
- Return seconds via `mediaTimeToSeconds`.

Reuse `getSourceTimeAtClipTime` from existing timeline/audio helpers (same as `resolve.ts`).

- [ ] **Step 3: Tests PASS + commit**

```bash
cd freefilmcut
git add apps/web/src/timeline/transitions
git commit -m "feat(timeline): transition media handle / freeze sampling"
```

---

### Task 4: Prune invalid edges

**Files:**
- Create: `freefilmcut/apps/web/src/timeline/transitions/prune.ts`
- Create: `freefilmcut/apps/web/src/timeline/transitions/__tests__/prune.test.ts`

- [ ] **Step 1: Implement `pruneTrackTransitions({ track })`**

Keep edge only if:

- `from` and `to` both exist on `track.elements`
- `areElementsAdjacent({ from, to })`
- both are video|image

Return new `transitions` array (immutable).

- [ ] **Step 2: `pruneSceneTracksTransitions({ tracks })`**

Map `main` + each overlay video track.

- [ ] **Step 3: Tests + commit**

```bash
cd freefilmcut
git add apps/web/src/timeline/transitions
git commit -m "feat(timeline): prune orphan transition edges"
```

---

### Task 5: Commands + TimelineManager API

**Files:**
- Create: `freefilmcut/apps/web/src/commands/timeline/transition/upsert-transition.ts`
- Create: `freefilmcut/apps/web/src/commands/timeline/transition/remove-transition.ts`
- Create: `freefilmcut/apps/web/src/commands/timeline/transition/set-transition-duration.ts`
- Create: `freefilmcut/apps/web/src/commands/timeline/transition/index.ts`
- Modify: `freefilmcut/apps/web/src/commands/timeline/index.ts` — `export * from "./transition"`
- Modify: `freefilmcut/apps/web/src/core/managers/timeline-manager.ts`
- Modify: move/delete/insert commands to call prune after track updates (or wrap in TimelineManager methods)

- [ ] **Step 1: `UpsertTransitionCommand`**

Constructor args: `{ trackId, fromElementId, toElementId, packId, duration? }`.

`execute`:

1. Snapshot `SceneTracks`.
2. Find video track; verify adjacency.
3. Remove any existing edge with same `from`+`to` (or same cut).
4. Push new edge with `id = crypto.randomUUID()`, `duration = duration ?? defaultTransitionDuration(fps)`.
5. `editor.timeline.updateTracks(...)`.

`undo`: restore snapshot.

- [ ] **Step 2: `RemoveTransitionCommand` / `SetTransitionDurationCommand`**

SetDuration: find edge by `id`, replace with `clampTransitionDuration(...)`.

- [ ] **Step 3: TimelineManager**

```ts
upsertTransition(...) { execute UpsertTransitionCommand }
removeTransition({ transitionId }) { ... }
setTransitionDuration({ transitionId, duration }) { ... }
```

- [ ] **Step 4: Wire prune**

After `MoveElementCommand` / `DeleteElementsCommand` / `InsertElementCommand` success paths that call `updateTracks`, also:

```ts
tracks = pruneSceneTracksTransitions({ tracks: updatedTracks });
```

Prefer a single helper used inside `TimelineManager.updateTracks` so all mutations prune:

```ts
updateTracks(newTracks: SceneTracks): void {
  const pruned = pruneSceneTracksTransitions({ tracks: newTracks });
  ...
}
```

- [ ] **Step 5: Commit**

```bash
cd freefilmcut
git add apps/web/src/commands/timeline/transition apps/web/src/commands/timeline/index.ts apps/web/src/core/managers/timeline-manager.ts
git commit -m "feat(timeline): transition upsert/remove/duration commands"
```

---

### Task 6: Drag-drop onto cut + placement hint

**Files:**
- Modify: `freefilmcut/apps/web/src/vfxpack/pack-placement.ts`
- Modify: `freefilmcut/apps/web/src/timeline/controllers/drag-drop-controller.ts`
- Modify: `freefilmcut/apps/web/src/timeline/hooks/use-timeline-drag-drop.ts` (pass `upsertTransition` if needed)

- [ ] **Step 1: Update transition placement hint**

```ts
case "transition":
  return {
    type: normalized,
    label,
    targetElementTypes: [],
    insertTrackType: null, // or keep unused
    dragHint: "Drag onto the cut between two adjacent clips",
  };
```

- [ ] **Step 2: Detect transition drag**

When drag source is a transition pack (`normalizeVfxPackType === "transition"`), on dragOver:

- Convert pointer X → MediaTime (existing pixel helpers).
- Hit-test video tracks under Y (main + overlay video).
- `findAdjacentPairAtTime` with tolerance ~8–12px in ticks at current zoom.
- Store `dropTarget: { kind: "cut", trackId, fromId, toId }` (extend local drop state; do not misuse element drop).

Visual: highlight vertical seam (Task 7 can consume same state).

- [ ] **Step 3: onDrop**

```ts
editor.timeline.upsertTransition({
  trackId,
  fromElementId,
  toElementId,
  packId,
});
```

Do **not** `insertElement` / `addClipEffect` for transitions.

- [ ] **Step 4: Manual verify** — drag transition to cut creates edge in scene JSON / React state.

- [ ] **Step 5: Commit**

```bash
cd freefilmcut
git add apps/web/src/vfxpack/pack-placement.ts apps/web/src/timeline/controllers/drag-drop-controller.ts apps/web/src/timeline/hooks/use-timeline-drag-drop.ts
git commit -m "feat(timeline): drop transition packs on adjacent cuts"
```

---

### Task 7: Hatch overlay UI + symmetric resize + selection

**Files:**
- Create: `freefilmcut/apps/web/src/timeline/components/transition-overlay.tsx`
- Modify: timeline track row component(s) under `freefilmcut/apps/web/src/timeline/components/`
- Selection store: extend editor selection to support `{ type: "transition", transitionId, trackId }` **or** a small `timeline.ui.selectedTransitionId` on TimelineManager — prefer matching existing selection patterns (grep `selectedElements`).

- [ ] **Step 1: Render overlay**

For each edge on the track:

- `cut = from.end`
- `left = timeToPixels(cut - D/2)`, `width = timeToPixels(D)`
- Absolute div: diagonal hatch CSS, center ⋈ glyph, pointer-events on edges.

- [ ] **Step 2: Click selects transition**

Clears element selection; sets transition selection.

- [ ] **Step 3: Symmetric edge drag**

On pointer down on left or right edge:

- Record `startD`, `startX`.
- On move: `deltaTime = pixelsToTime(deltaX)` — dragging **either** edge changes D by `2 * |delta|` toward expand/contract so cut stays center:
  - Common approach: `newD = startD + 2 * signedDeltaFromNearestEdge`
  - Clamp via `clampTransitionDuration`
  - Live preview: call `setTransitionDuration` on pointer up only; during drag use local React state overlay width, commit on up (or throttle command — prefer commit on up for undo cleanliness).

- [ ] **Step 4: Delete key removes selected transition**

Hook existing keybinding path if present; else handle in overlay `onKeyDown`.

- [ ] **Step 5: Commit**

```bash
cd freefilmcut
git add apps/web/src/timeline/components
git commit -m "feat(timeline): Jianying-style transition hatch and symmetric resize"
```

---

### Task 8: Properties panel duration

**Files:**
- Grep properties panel for element selection; add branch for transition selection
- Likely under `freefilmcut/apps/web/src/components/editor/panels/properties/`

- [ ] **Step 1: When transition selected, show**

- Pack name / id (read-only)
- Duration number (seconds), on change → `setTransitionDuration` with fps rounding

- [ ] **Step 2: Commit**

```bash
cd freefilmcut
git add apps/web/src/components/editor/panels/properties
git commit -m "feat(timeline): transition duration in properties panel"
```

---

### Task 9: Transition input uniform convention

**Files:**
- Create: `freefilmcut/apps/web/src/vfxpack/transition-input.ts`
- Create: `freefilmcut/apps/web/src/vfxpack/__tests__/transition-input.test.ts`
- Modify: `freefilmcut/apps/web/src/vfxpack/index.ts` — export names

- [ ] **Step 1: Mirror below-input pattern**

```ts
export const TRANSITION_FROM_UNIFORM_NAMES = [
  "uTransitionFrom",
  "uFrom",
  "transitionFrom",
] as const;

export const TRANSITION_TO_UNIFORM_NAMES = [
  "uTransitionTo",
  "uTo",
  "transitionTo",
] as const;

export const TRANSITION_FROM_PREFERRED = "uTransitionFrom";
export const TRANSITION_TO_PREFERRED = "uTransitionTo";

export function listTransitionFromUniforms(uniforms: Record<string, unknown>): string[];
export function listTransitionToUniforms(uniforms: Record<string, unknown>): string[];
export function bindTransitionInputTextures({
  root,
  materialsByUuid,
  fromTexture,
  toTexture,
}: { ... }): void;
```

`bindTransitionInputTextures`: traverse materials like `bindBelowInputTexture`; set matching sampler uniforms; `uniformsNeedUpdate = true`.

- [ ] **Step 2: Unit test name detection**

- [ ] **Step 3: Commit**

```bash
cd freefilmcut
git add apps/web/src/vfxpack/transition-input.ts apps/web/src/vfxpack/__tests__/transition-input.test.ts apps/web/src/vfxpack/index.ts
git commit -m "feat(vfxpack): uTransitionFrom/To uniform binding convention"
```

---

### Task 10: Frame descriptor `cutTransition` + resolve dual sample

**Files:**
- Modify: `freefilmcut/apps/web/src/services/renderer/compositor/types.ts`
- Modify: `freefilmcut/apps/web/src/services/renderer/compositor/frame-descriptor.ts`
- Modify: `freefilmcut/apps/web/src/services/renderer/resolve.ts` (allow out-of-clip sample OR dedicated helper used by frame builder)
- Modify: scene-builder / renderer path so active scene transitions are visible to frame builder (pass transitions + time into collect, or resolve on RootNode)

- [ ] **Step 1: Extend `FrameItemDescriptor`**

```ts
| {
    type: "cutTransition";
    packId: string;
    /** Pack Timeline sample time in seconds = u * T (caller supplies). */
    clipLocalTime: number;
    fromTextureId: string;
    toTextureId: string;
  }
```

- [ ] **Step 2: When collecting layers for a video track at time t**

If `t` is inside any transition window on that track:

1. Resolve From canvas via handle source time (Task 3) + `videoCache.getFrameAt` / image decode.
2. Resolve To similarly.
3. Push two external textures + one `cutTransition` item.
4. **Skip** emitting normal layer items for `from` and `to` elements while inside the window (avoid double-draw under transition).

Outside window: existing behavior.

Pack Timeline length `T`: read from built pack timeline/anim duration when available; if missing, use `T = D` seconds so `u * T` still advances 0..D. Prefer: `getVfxPackElementDuration` / built scene timelines max duration (already used for pack clips).

`clipLocalTime = transitionProgress(...) * T`.

- [ ] **Step 3: Manual / unit smoke** where possible — if frame builder is hard to unit test, add a small pure function `planTransitionItemsForTrack({ track, time })` tested with fake elements.

- [ ] **Step 4: Commit**

```bash
cd freefilmcut
git add apps/web/src/services/renderer
git commit -m "feat(renderer): emit cutTransition frame items with dual samples"
```

---

### Task 11: Compositor render cutTransition

**Files:**
- Modify: `freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts`

- [ ] **Step 1: In `render(frame)` loop**

On `item.type === "cutTransition"`:

1. Ensure pack built (`ensurePackBuilt(packId)`).
2. Upload/bind `fromTextureId` / `toTextureId` from texture map into two `WebGLRenderTarget`s or `CanvasTexture`s sized to frame (reuse/allocate `transitionFromRT` / `transitionToRT` on compositor).
3. `bindTransitionInputTextures({ root, materialsByUuid, fromTexture, toTexture })`.
4. `renderOnePack` with `clipLocalTime: item.clipLocalTime`, `clearFirst` as today, **without** treating it as below-input only — transition pack replaces the cut region full-frame (MVP: full canvas like sceneEffect).
5. Mark `framePackIds`, increment `layersBelow`.

Do not free-run pack videos that fight dual inputs unless pack also has timeline video tracks (MVP dissolve has none).

- [ ] **Step 2: Verify scrub + play** show dissolve across cut.

- [ ] **Step 3: Commit**

```bash
cd freefilmcut
git add apps/web/src/services/renderer/compositor/three-compositor.ts
git commit -m "feat(compositor): render cut transitions with dual input textures"
```

---

### Task 12: Author dissolve verification pack checklist

**Files:**
- Create: `docs/superpowers/specs/2026-10-16-nle-transition-dissolve-authoring.md` (short checklist under FreeFilmCut docs)
- Optional fixture under `freefilmcut/apps/web/public/vfx-samples/` only if project already ships sample packs that way — otherwise editor-authored pack is enough.

- [ ] **Step 1: Document authoring**

1. New scene + fullscreen quad ShaderMaterial.
2. GLSL uniforms: `sampler2D uTransitionFrom`, `sampler2D uTransitionTo`, `float uMix` (or drive mix from Timeline).
3. Fragment: `mix(texture2D(uTransitionFrom,uv), texture2D(uTransitionTo,uv), uMix)`.
4. Timeline 1s animating `uMix` 0→1 (or material uniform track).
5. Export `.vfxpack` with `type: "transition"`.
6. Import in NLE Transitions tab; drop on cut; set D=0.5 → animation completes in 0.5s.

- [ ] **Step 2: Commit docs if inside a git-tracked tree; otherwise leave under FreeFilmCut/docs**

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| TransitionEdge cut attachment | 1, 5 |
| Adjacent-only place / replace | 2, 5, 6 |
| Handles then freeze | 3, 10 |
| Centered D/2 window | 2, 7, 10 |
| Panel + symmetric drag D | 7, 8 |
| Timeline scale u*T | 10, 11 |
| Flexible From/To uniforms | 9, 11 |
| Jianying hatch UI | 7 |
| Prune on break | 4, 5 |
| MVP non-goals (audio, asymmetric, ripple) | omitted |

## Placeholder scan

No TBD / “handle later” steps remaining in tasks above.

## Type consistency

- `TransitionEdge.packId` used in upsert, frame item, compositor.
- `duration: MediaTime` clamped in setDuration + drag.
- Frame item `cutTransition` + `clipLocalTime` seconds for pack sample.

---

## Execution handoff

Plan complete and saved to `docs/superpowers/plans/2026-10-16-nle-transition-cut-edge.md`.

**Two execution options:**

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks  
2. **Inline Execution** — execute tasks in this session with checkpoints  

Which approach?
