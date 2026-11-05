# Timeline Clip Quick Actions Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add timeline toolbar quick actions — freeze (3s still after clip), reverse toggle, mirror, rotate 90° — with selection-based button visibility.

**Architecture:** Pure source-time helper for reverse; `reversed` flag on video/audio elements; mirror/rotate via existing `transform.scaleX` / `transform.rotate` params; freeze as BatchCommand (image asset + ripple shift + insert). Wire through `ACTIONS` + `use-editor-actions` like split/duplicate. Toolbar shows buttons only when selection supports them.

**Tech Stack:** Next.js / React editor (`freefilmcut/apps/web`), bun:test, existing Command / BatchCommand / videoCache.

**Spec:** `docs/superpowers/specs/2026-11-05-timeline-clip-quick-actions-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `src/retime/source-time.ts` (create) | `getMappedSourceTime` / inverse with `reversed` |
| `src/retime/__tests__/source-time.test.ts` (create) | Unit tests for mapping |
| `src/retime/index.ts` | Re-export helper |
| `src/timeline/types.ts` | `reversed?: boolean` on `VideoElement` + audio base |
| `src/services/renderer/nodes/visual-node.ts` | `reversed?: boolean` on `VisualNodeParams` |
| `src/services/renderer/scene-builder.ts` | Pass `reversed` into `VideoNode` |
| `src/services/renderer/resolve.ts` | Use mapped source time for video frames |
| `src/core/managers/audio-manager.ts` | Use mapped source time; reverse buffer path when needed |
| `src/timeline/clip-quick-actions.ts` (create) | Selection gates, mirror/rotate patches, freeze helpers |
| `src/timeline/__tests__/clip-quick-actions.test.ts` (create) | Gate + patch unit tests |
| `src/commands/timeline/element/freeze-frame.ts` (create) | Freeze BatchCommand orchestration (or dedicated command) |
| `src/actions/definitions.ts` | Register 4 actions |
| `src/actions/use-editor-actions.ts` | Handlers |
| `src/core/managers/timeline-manager.ts` | Thin wrappers: `mirrorElements`, `rotateElements90`, `toggleReverse`, `freezeFrame` |
| `src/timeline/components/timeline-toolbar.tsx` | Conditional buttons + icons |

---

### Task 1: Source-time mapping helper (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/retime/source-time.ts`
- Create: `freefilmcut/apps/web/src/retime/__tests__/source-time.test.ts`
- Modify: `freefilmcut/apps/web/src/retime/index.ts`

- [ ] **Step 1: Write the failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import { getMappedSourceTime, getMappedClipTimeFromSource } from "@/retime/source-time";

describe("getMappedSourceTime", () => {
	test("forward equals trimStart + retime delta", () => {
		expect(
			getMappedSourceTime({
				clipTime: 5,
				clipDuration: 10,
				trimStart: 100,
				retime: { rate: 2 },
				reversed: false,
			}),
		).toBe(110); // 100 + 5*2
	});

	test("reversed maps clip start to source end of span", () => {
		// span at rate 1 over duration 10 = 10
		expect(
			getMappedSourceTime({
				clipTime: 0,
				clipDuration: 10,
				trimStart: 100,
				reversed: true,
			}),
		).toBe(110); // trimStart + span
	});

	test("reversed maps clip end to trimStart", () => {
		expect(
			getMappedSourceTime({
				clipTime: 10,
				clipDuration: 10,
				trimStart: 100,
				reversed: true,
			}),
		).toBe(100);
	});

	test("reversed mid-point with 2x retime", () => {
		// span = 10*2 = 20; clipTime 5 → forwardDelta 10 → source = 100+20-10 = 110
		expect(
			getMappedSourceTime({
				clipTime: 5,
				clipDuration: 10,
				trimStart: 100,
				retime: { rate: 2 },
				reversed: true,
			}),
		).toBe(110);
	});
});
```

- [ ] **Step 2: Run tests — expect FAIL**

Run: `cd freefilmcut/apps/web && bun test src/retime/__tests__/source-time.test.ts`

Expected: fail (module / exports missing)

- [ ] **Step 3: Implement helper**

```typescript
// freefilmcut/apps/web/src/retime/source-time.ts
import type { RetimeConfig } from "@/timeline";
import {
	getClipTimeAtSourceTime,
	getSourceTimeAtClipTime,
} from "@/retime/resolve";

export function getMappedSourceTime({
	clipTime,
	clipDuration,
	trimStart,
	retime,
	reversed = false,
}: {
	clipTime: number;
	clipDuration: number;
	trimStart: number;
	retime?: RetimeConfig;
	reversed?: boolean;
}): number {
	const forwardDelta = getSourceTimeAtClipTime({
		clipTime,
		retime,
		clipDuration,
	});
	if (!reversed) {
		return trimStart + forwardDelta;
	}
	const span = getSourceTimeAtClipTime({
		clipTime: clipDuration,
		retime,
		clipDuration,
	});
	return trimStart + span - forwardDelta;
}

export function getMappedClipTimeFromSource({
	sourceTime,
	clipDuration,
	trimStart,
	retime,
	reversed = false,
}: {
	sourceTime: number;
	clipDuration: number;
	trimStart: number;
	retime?: RetimeConfig;
	reversed?: boolean;
}): number {
	const delta = sourceTime - trimStart;
	if (!reversed) {
		return getClipTimeAtSourceTime({
			sourceTime: delta,
			retime,
			clipDuration,
		});
	}
	const span = getSourceTimeAtClipTime({
		clipTime: clipDuration,
		retime,
		clipDuration,
	});
	return getClipTimeAtSourceTime({
		sourceTime: span - delta,
		retime,
		clipDuration,
	});
}
```

Re-export from `src/retime/index.ts`:
```typescript
export * from "./source-time";
```

- [ ] **Step 4: Run tests — expect PASS**

Run: `cd freefilmcut/apps/web && bun test src/retime/__tests__/source-time.test.ts`

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/retime/source-time.ts freefilmcut/apps/web/src/retime/__tests__/source-time.test.ts freefilmcut/apps/web/src/retime/index.ts
git commit -m "Add reversed source-time mapping helper for clip reverse."
```

---

### Task 2: `reversed` on element + render/audio wiring

**Files:**
- Modify: `freefilmcut/apps/web/src/timeline/types.ts` (`VideoElement`, `BaseAudioElement`)
- Modify: `freefilmcut/apps/web/src/services/renderer/nodes/visual-node.ts`
- Modify: `freefilmcut/apps/web/src/services/renderer/scene-builder.ts` (VideoNode construction ~239)
- Modify: `freefilmcut/apps/web/src/services/renderer/resolve.ts` (`resolveVideoNode` ~350)
- Modify: `freefilmcut/apps/web/src/core/managers/audio-manager.ts` (source start + timestamp→timeline ~338–360)

- [ ] **Step 1: Extend types**

On `VideoElement` add:
```typescript
/** When true, play trimmed source from end→start (orthogonal to retime). */
reversed?: boolean;
```

On `BaseAudioElement` add the same optional `reversed?: boolean` (for separated source-audio).

- [ ] **Step 2: Pass through scene builder**

In `VisualNodeParams` add `reversed?: boolean`.

When constructing `VideoNode`, pass `reversed: element.reversed === true`.

- [ ] **Step 3: Resolve video frames with mapping**

Replace in `resolveVideoNode`:
```typescript
const sourceTimeTicks = getMappedSourceTime({
	clipTime,
	clipDuration: node.params.duration,
	trimStart: node.params.trimStart,
	retime: node.params.retime,
	reversed: node.params.reversed === true,
});
```
(Apply the same substitution anywhere else in `resolve.ts` that uses `trimStart + getSourceTimeAtClipTime` for video — currently ~350 and ~628.)

- [ ] **Step 4: Audio manager**

Wherever clip source start / timestamp↔timeline uses `getSourceTimeAtClipTime` / `getClipTimeAtSourceTime` for video/audio clips, switch to `getMappedSourceTime` / `getMappedClipTimeFromSource` and pass `reversed: clip.reversed === true`.

**Reverse audio note:** `AudioBufferSourceNode.playbackRate` cannot be negative. If the existing sink iterator only advances source time forward, a forward iterator + reverse timeline mapping will schedule into the past. For `reversed === true`, use this approach:

1. Keep computing the correct `sourceStartTime` via `getMappedSourceTime` at the playhead.
2. Prefer a path that reads buffers by seeking to mapped source times as timeline advances (same spirit as video `getFrameAt`), **or** decode the trimmed span into an `AudioBuffer`, reverse channel samples once, cache by `mediaId+trimStart+trimEnd+retime`, then play that buffer forward with normal scheduling (`reversed` treated as already baked into the buffer — set a local `playReversedBuffer` flag so mapping stays identity for that buffer).

Pick one and document in a short comment at the call site. Prefer reverse-buffer cache if the sink API cannot seek arbitrarily per chunk.

- [ ] **Step 5: Smoke-check types compile**

Run: `cd freefilmcut/apps/web && bunx tsc --noEmit -p tsconfig.json 2>&1 | head -40`  
(or project’s usual typecheck). Fix any `reversed` fallout.

- [ ] **Step 6: Commit**

```bash
git add freefilmcut/apps/web/src/timeline/types.ts freefilmcut/apps/web/src/services/renderer/nodes/visual-node.ts freefilmcut/apps/web/src/services/renderer/scene-builder.ts freefilmcut/apps/web/src/services/renderer/resolve.ts freefilmcut/apps/web/src/core/managers/audio-manager.ts
git commit -m "Wire reversed flag through video resolve and audio sampling."
```

---

### Task 3: Selection gates + mirror/rotate patches (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/timeline/clip-quick-actions.ts`
- Create: `freefilmcut/apps/web/src/timeline/__tests__/clip-quick-actions.test.ts`

- [ ] **Step 1: Write failing tests**

```typescript
import { describe, expect, test } from "bun:test";
import {
	canShowFreeze,
	canShowReverse,
	canShowMirrorOrRotate,
	buildMirrorPatches,
	buildRotate90Patches,
	normalizeDegrees,
} from "@/timeline/clip-quick-actions";

const video = { type: "video" as const, params: { "transform.scaleX": 1, "transform.rotate": 0 } };
const image = { type: "image" as const, params: { "transform.scaleX": 1, "transform.rotate": 90 } };
const text = { type: "text" as const, params: {} };

describe("visibility gates", () => {
	test("freeze/reverse only for single video", () => {
		expect(canShowFreeze({ elements: [video] })).toBe(true);
		expect(canShowFreeze({ elements: [video, video] })).toBe(false);
		expect(canShowFreeze({ elements: [image] })).toBe(false);
		expect(canShowReverse({ elements: [video] })).toBe(true);
		expect(canShowReverse({ elements: [image] })).toBe(false);
	});

	test("mirror/rotate when any video|image|sticker selected", () => {
		expect(canShowMirrorOrRotate({ elements: [image] })).toBe(true);
		expect(canShowMirrorOrRotate({ elements: [text] })).toBe(false);
		expect(canShowMirrorOrRotate({ elements: [text, image] })).toBe(true);
	});
});

describe("patches", () => {
	test("mirror flips scaleX per element", () => {
		const patches = buildMirrorPatches({
			items: [
				{ trackId: "t", elementId: "a", element: { ...video, params: { "transform.scaleX": 1 } } },
				{ trackId: "t", elementId: "b", element: { ...image, params: { "transform.scaleX": -1 } } },
				{ trackId: "t", elementId: "c", element: text },
			],
		});
		expect(patches).toEqual([
			{ trackId: "t", elementId: "a", patch: { params: { "transform.scaleX": -1 } } },
			{ trackId: "t", elementId: "b", patch: { params: { "transform.scaleX": 1 } } },
		]);
	});

	test("rotate adds 90 and wraps", () => {
		expect(normalizeDegrees({ degrees: 360 })).toBe(0);
		expect(normalizeDegrees({ degrees: 450 })).toBe(90);
		const patches = buildRotate90Patches({
			items: [
				{ trackId: "t", elementId: "a", element: { ...image, params: { "transform.rotate": 270 } } },
			],
		});
		expect(patches[0]?.patch).toEqual({ params: { "transform.rotate": 0 } });
	});
});
```

Adjust fixture shapes to match real `TimelineElement` minimally as needed for typecheck (cast with `as TimelineElement` if required).

- [ ] **Step 2: Run — expect FAIL**

Run: `cd freefilmcut/apps/web && bun test src/timeline/__tests__/clip-quick-actions.test.ts`

- [ ] **Step 3: Implement**

```typescript
// freefilmcut/apps/web/src/timeline/clip-quick-actions.ts
import type { TimelineElement } from "@/timeline";

const MIRROR_ROTATE_TYPES = new Set(["video", "image", "sticker"]);

export function canShowFreeze({
	elements,
}: {
	elements: Array<{ type: string }>;
}): boolean {
	return elements.length === 1 && elements[0]?.type === "video";
}

export function canShowReverse({
	elements,
}: {
	elements: Array<{ type: string }>;
}): boolean {
	return canShowFreeze({ elements });
}

export function canShowMirrorOrRotate({
	elements,
}: {
	elements: Array<{ type: string }>;
}): boolean {
	return elements.some((el) => MIRROR_ROTATE_TYPES.has(el.type));
}

export function normalizeDegrees({ degrees }: { degrees: number }): number {
	const wrapped = ((degrees % 360) + 360) % 360;
	return wrapped === 0 ? 0 : wrapped;
}

function readNumberParam({
	params,
	key,
	fallback,
}: {
	params: Record<string, unknown>;
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

export function buildMirrorPatches({
	items,
}: {
	items: Array<{
		trackId: string;
		elementId: string;
		element: TimelineElement;
	}>;
}): Array<{
	trackId: string;
	elementId: string;
	patch: { params: { "transform.scaleX": number } };
}> {
	return items.flatMap(({ trackId, elementId, element }) => {
		if (!MIRROR_ROTATE_TYPES.has(element.type)) return [];
		const scaleX = readNumberParam({
			params: element.params,
			key: "transform.scaleX",
			fallback: 1,
		});
		return [
			{
				trackId,
				elementId,
				patch: { params: { "transform.scaleX": scaleX * -1 } },
			},
		];
	});
}

export function buildRotate90Patches({
	items,
}: {
	items: Array<{
		trackId: string;
		elementId: string;
		element: TimelineElement;
	}>;
}): Array<{
	trackId: string;
	elementId: string;
	patch: { params: { "transform.rotate": number } };
}> {
	return items.flatMap(({ trackId, elementId, element }) => {
		if (!MIRROR_ROTATE_TYPES.has(element.type)) return [];
		const rotate = readNumberParam({
			params: element.params,
			key: "transform.rotate",
			fallback: 0,
		});
		return [
			{
				trackId,
				elementId,
				patch: {
					params: {
						"transform.rotate": normalizeDegrees({ degrees: rotate + 90 }),
					},
				},
			},
		];
	});
}
```

- [ ] **Step 4: Run — expect PASS**

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/timeline/clip-quick-actions.ts freefilmcut/apps/web/src/timeline/__tests__/clip-quick-actions.test.ts
git commit -m "Add clip quick-action visibility gates and transform patches."
```

---

### Task 4: Actions + timeline-manager wrappers for mirror / rotate / reverse

**Files:**
- Modify: `freefilmcut/apps/web/src/actions/definitions.ts`
- Modify: `freefilmcut/apps/web/src/actions/use-editor-actions.ts`
- Modify: `freefilmcut/apps/web/src/core/managers/timeline-manager.ts`

- [ ] **Step 1: Register actions** (no default shortcuts in v1)

In `ACTIONS`:
```typescript
"freeze-frame": {
	description: "Freeze last frame as 3s still after clip",
	category: "editing",
},
"toggle-reverse": {
	description: "Toggle reverse playback on selected video",
	category: "editing",
},
mirror: {
	description: "Mirror selected clips horizontally",
	category: "editing",
},
"rotate-90": {
	description: "Rotate selected clips 90 degrees",
	category: "editing",
},
```

- [ ] **Step 2: Timeline manager methods**

```typescript
mirrorElements({
	elements,
}: {
	elements: { trackId: string; elementId: string }[];
}): void {
	const items = this.getElementsWithTracks({ elements });
	const updates = buildMirrorPatches({
		items: items.map(({ track, element }) => ({
			trackId: track.id,
			elementId: element.id,
			element,
		})),
	});
	this.updateElements({ updates });
}

rotateElements90({ elements }: { elements: { trackId: string; elementId: string }[] }): void {
	const items = this.getElementsWithTracks({ elements });
	const updates = buildRotate90Patches({
		items: items.map(({ track, element }) => ({
			trackId: track.id,
			elementId: element.id,
			element,
		})),
	});
	this.updateElements({ updates });
}

toggleReverse({
	trackId,
	elementId,
}: {
	trackId: string;
	elementId: string;
}): void {
	const element = this.getElementByRef({ trackId, elementId });
	if (!element || element.type !== "video") return;
	const next = !(element.reversed === true);
	const updates: Array<{
		trackId: string;
		elementId: string;
		patch: Partial<TimelineElement>;
	}> = [{ trackId, elementId, patch: { reversed: next } }];

	// Separated source-audio: flip matching audio clips (same mediaId + startTime + duration).
	const scene = this.editor.scenes.getActiveScene();
	for (const track of scene.tracks.audio) {
		for (const audio of track.elements) {
			if (
				audio.type === "audio" &&
				"mediaId" in audio &&
				audio.mediaId === element.mediaId &&
				audio.startTime === element.startTime &&
				audio.duration === element.duration
			) {
				updates.push({
					trackId: track.id,
					elementId: audio.id,
					patch: { reversed: next },
				});
			}
		}
	}
	this.updateElements({ updates });
}
```

(Import `buildMirrorPatches` / `buildRotate90Patches` from `@/timeline/clip-quick-actions`.)

- [ ] **Step 3: Handlers in `use-editor-actions.ts`**

```typescript
useActionHandler("mirror", () => {
	editor.timeline.mirrorElements({ elements: selectedElements });
}, undefined);

useActionHandler("rotate-90", () => {
	editor.timeline.rotateElements90({ elements: selectedElements });
}, undefined);

useActionHandler("toggle-reverse", () => {
	if (selectedElements.length !== 1) return;
	const ref = selectedElements[0];
	const el = editor.timeline.getElementByRef(ref);
	if (!el || el.type !== "video") return;
	editor.timeline.toggleReverse(ref);
}, undefined);
```

Leave `freeze-frame` handler stub that no-ops until Task 5, or skip binding until Task 5.

- [ ] **Step 4: Commit**

```bash
git add freefilmcut/apps/web/src/actions/definitions.ts freefilmcut/apps/web/src/actions/use-editor-actions.ts freefilmcut/apps/web/src/core/managers/timeline-manager.ts
git commit -m "Register mirror, rotate-90, and toggle-reverse editor actions."
```

---

### Task 5: Freeze frame command

**Files:**
- Create: `freefilmcut/apps/web/src/commands/timeline/element/freeze-frame.ts`
- Modify: `freefilmcut/apps/web/src/commands/timeline/element/index.ts`
- Modify: `freefilmcut/apps/web/src/core/managers/timeline-manager.ts`
- Modify: `freefilmcut/apps/web/src/actions/use-editor-actions.ts`
- Possibly: `freefilmcut/apps/web/src/timeline/clip-quick-actions.ts` (shared `FREEZE_DURATION_SECONDS = 3`)

- [ ] **Step 1: Implement `FreezeFrameCommand`**

Behavior in `execute()`:

1. Resolve video element + media asset (`file` required).
2. Compute last-frame source seconds:
   ```typescript
   const frameDurationSec = 1 / Math.max(1, projectFps);
   const localEnd = Math.max(0, mediaTimeToSeconds({ time: element.duration }) - frameDurationSec);
   const sourceSec = mediaTimeToSeconds({
     time: roundMediaTime({
       time: getMappedSourceTime({
         clipTime: mediaTimeFromSeconds({ seconds: localEnd }), // or tick-math consistently
         clipDuration: element.duration,
         trimStart: element.trimStart,
         retime: element.retime,
         reversed: element.reversed === true,
       }),
     }),
   });
   ```
   Keep all tick math in MediaTime units consistently — prefer converting only at `getFrameAt({ time: seconds })`.
3. `await videoCache.getFrameAt({ mediaId, file, time: sourceSec })`. On failure → `toast.error` and abort (command should not partial-apply; if async prework is needed, do extract **before** constructing/executing the mutating command — see Step 2).
4. `canvas.toBlob` → `File` named `freeze-<uuid>.png`.
5. Build image `MediaAsset` omit-id (type image, width/height from canvas, url object URL, file).
6. Mutate via BatchCommand:
   - `AddMediaAssetCommand`
   - `UpdateElementsCommand` shifting every element on the same track with `startTime >= video.startTime + video.duration` by `+ mediaTimeFromSeconds({ seconds: 3 })`
   - `InsertElementCommand` with image element:
     - `startTime: video.startTime + video.duration`
     - `duration: mediaTimeFromSeconds({ seconds: 3 })`
     - `trimStart/trimEnd: ZERO`
     - copy transform-related params from video (`transform.scaleX/Y`, `offsetX/Y`, `rotate`, etc. — shallow-copy keys starting with `transform.`)
     - `placement: { mode: "explicit", trackId }`

Because frame extract is async, **do not** put await inside `Command.execute` if other commands are sync. Pattern:

```typescript
// timeline-manager.freezeFrame
async freezeFrame({ trackId, elementId }: {...}): Promise<void> {
  const prepared = await prepareFreezeFrameAssets({...}); // extract + File + asset fields
  if (!prepared) return;
  const command = new BatchCommand([
    new AddMediaAssetCommand({ projectId, asset: prepared.asset }),
    new UpdateElementsCommand({ updates: prepared.rippleUpdates }),
    new InsertElementCommand({ element: prepared.imageElement, placement: {...} }),
  ]);
  // Ensure InsertElement uses prepared.assetId from AddMediaAssetCommand.getAssetId()
  this.editor.command.execute({ command });
}
```

`AddMediaAssetCommand` already exposes asset id via field/getter — check `getAssetId()` or add one if missing (read `add-media-asset.ts` and use existing API).

Ripple **always** (ignore timeline-store ripple toggle).

- [ ] **Step 2: Wire action**

```typescript
useActionHandler("freeze-frame", () => {
  if (selectedElements.length !== 1) return;
  void editor.timeline.freezeFrame(selectedElements[0]);
}, undefined);
```

- [ ] **Step 3: Manual unit test for ripple update builder (optional pure helper)**

Extract `buildFreezeRippleUpdates({ track, afterTime, delta })` into `clip-quick-actions.ts` and test that only elements with `startTime >= afterTime` shift.

- [ ] **Step 4: Commit**

```bash
git add freefilmcut/apps/web/src/commands/timeline/element/freeze-frame.ts freefilmcut/apps/web/src/commands/timeline/element/index.ts freefilmcut/apps/web/src/core/managers/timeline-manager.ts freefilmcut/apps/web/src/actions/use-editor-actions.ts freefilmcut/apps/web/src/timeline/clip-quick-actions.ts
git commit -m "Implement freeze-frame: still image insert with forced ripple."
```

---

### Task 6: Toolbar visibility + icons

**Files:**
- Modify: `freefilmcut/apps/web/src/timeline/components/timeline-toolbar.tsx`

- [ ] **Step 1: Compute selection flags in `ToolbarLeftSection`**

Using `selectedElements` + `getElementsWithTracks`:
```typescript
const selectedTimelineElements = editor.timeline
  .getElementsWithTracks({ elements: selectedElements })
  .map(({ element }) => element);

const showFreeze = canShowFreeze({ elements: selectedTimelineElements });
const showReverse = canShowReverse({ elements: selectedTimelineElements });
const showMirrorRotate = canShowMirrorOrRotate({ elements: selectedTimelineElements });
const reverseActive =
  showReverse &&
  selectedTimelineElements[0]?.type === "video" &&
  selectedTimelineElements[0].reversed === true;
```

- [ ] **Step 2: Replace disabled Snow freeze button; add reverse / mirror / rotate**

Order after Duplicate, before Delete (match CapCut cluster): Freeze → Reverse → Mirror → Rotate → Delete.

- Conditionally render each button (`{showFreeze && (...)}` etc.).
- Freeze → `invokeAction("freeze-frame")`
- Reverse → `invokeAction("toggle-reverse")` with `isActive={reverseActive}`
- Mirror → `invokeAction("mirror")`
- Rotate → `invokeAction("rotate-90")`
- Do **not** render crop.

Icons: pick closest Hugeicons (e.g. keep `SnowIcon` or frame-like icon for freeze; circular arrow for reverse; flip for mirror; rotate for rotate). If an exact icon is missing, use the nearest and note in commit message.

- [ ] **Step 3: Commit**

```bash
git add freefilmcut/apps/web/src/timeline/components/timeline-toolbar.tsx
git commit -m "Show clip quick-action toolbar buttons only when supported."
```

---

### Task 7: Verification checklist

- [ ] **Step 1: Automated**

Run:
```bash
cd freefilmcut/apps/web && bun test src/retime/__tests__/source-time.test.ts src/timeline/__tests__/clip-quick-actions.test.ts
```
Expected: all PASS

- [ ] **Step 2: Manual editor smoke**

1. Select image → freeze/reverse hidden; mirror/rotate visible; mirror flips; rotate steps 90°; properties panel matches; undo works.
2. Select one video → all four visible; freeze inserts 3s image after clip and shifts later clips; undo restores.
3. Toggle reverse → end of clip shows near trim start; sound reversed; toggle again restores; sibling segment of same media unchanged.
4. Multi-select two videos → mirror/rotate shown; freeze/reverse hidden.
5. Select text only → no quick-action buttons.

- [ ] **Step 3: Final commit if any fixes**

```bash
git commit -m "Fix clip quick-action edge cases from smoke testing."
```

---

## Spec coverage self-check

| Spec requirement | Task |
|------------------|------|
| Hide unsupported buttons | Task 3 gates + Task 6 |
| Freeze last frame → 3s image + ripple | Task 5 |
| Reverse toggle per clip + audio | Task 1–2, 4 |
| Mirror scaleX *= -1 | Task 3–4 |
| Rotate += 90 | Task 3–4 |
| Crop not shown | Task 6 |
| Multi-select batch mirror/rotate only | Task 3–4 |
| Commands / actions pattern | Task 4–5 |
