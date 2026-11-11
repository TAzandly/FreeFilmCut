# Face Beauty / Reshape Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a clip-property「美颜」tab (smooth / whiten / eye / faceSlim / noseSlim) for video/image, with browser MediaPipe landmarks, YOLO-Face fallback, Selfie Multiclass skin mask, and a Three.js GPU beauty pass.

**Architecture:** Store settings in `element.params` under `beauty.*` (same pattern as color correction). A `FaceBodyAnalysis` module runs detection/landmarks/skin in a Worker with frame cache. The compositor resolves beauty into the visual frame descriptor and applies warp → smooth → whiten after the media blit.

**Tech Stack:** TypeScript (Next web app), Three.js compositor, MediaPipe Tasks Vision, ONNX Runtime Web (YOLO-Face + Selfie Multiclass), bun test.

**Spec:** `docs/superpowers/specs/2026-11-11-face-beauty-reshape-design.md`

---

## File map

| File | Role |
|------|------|
| `freefilmcut/apps/web/src/beauty/types.ts` | `ClipBeautyParams`, defaults |
| `freefilmcut/apps/web/src/beauty/settings.ts` | read / normalize / resolve / active check from `ParamValues` |
| `freefilmcut/apps/web/src/beauty/param-defs.ts` | Element param definitions for sliders |
| `freefilmcut/apps/web/src/beauty/index.ts` | Public exports |
| `freefilmcut/apps/web/src/beauty/__tests__/settings.test.ts` | Unit tests for normalize/resolve |
| `freefilmcut/apps/web/src/beauty/analysis/types.ts` | Landmarks, boxes, skin mask handle types |
| `freefilmcut/apps/web/src/beauty/analysis/face-body-analysis.ts` | Orchestrator: MediaPipe → YOLO fallback → skin |
| `freefilmcut/apps/web/src/beauty/analysis/mediapipe-face.ts` | Face Landmarker wrapper |
| `freefilmcut/apps/web/src/beauty/analysis/yolo-face.ts` | YOLO-Face ONNX detect |
| `freefilmcut/apps/web/src/beauty/analysis/selfie-skin.ts` | Selfie Multiclass → skin mask |
| `freefilmcut/apps/web/src/beauty/analysis/landmark-fallback-mask.ts` | Convex-hull face ROI when skin fails |
| `freefilmcut/apps/web/src/beauty/analysis/cache.ts` | `(clipId, quantizedTime)` cache |
| `freefilmcut/apps/web/src/beauty/gpu/beauty-pass.ts` | Three.js materials + applyBeautyPass |
| `freefilmcut/apps/web/src/beauty/gpu/shaders.ts` | GLSL: warp, smooth, whiten |
| `freefilmcut/apps/web/src/components/editor/panels/properties/beauty-section.tsx` | UI sliders |
| `freefilmcut/apps/web/src/components/editor/panels/properties/registry.tsx` | Add「美颜」tab for video/image |
| `freefilmcut/apps/web/src/components/editor/panels/properties/media-properties-view.tsx` | `page="beauty"` |
| `freefilmcut/apps/web/src/services/renderer/resolve.ts` | Attach resolved beauty |
| `freefilmcut/apps/web/src/services/renderer/nodes/visual-node.ts` | Types |
| `freefilmcut/apps/web/src/services/renderer/compositor/types.ts` | Frame item beauty fields |
| `freefilmcut/apps/web/src/services/renderer/compositor/frame-descriptor.ts` | Plumb beauty |
| `freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts` | Call beauty pass |
| `freefilmcut/apps/web/public/models/beauty/` | YOLO-Face + selfie multiclass ONNX (git-lfs or download script) |
| `freefilmcut/apps/web/package.json` | Add `@mediapipe/tasks-vision`, `onnxruntime-web` |

**Reuse:** Follow `src/color-correction/*` + `applyColorCorrectionToMaterial` plumbing; do **not** put beauty into `element.effects[]`.

**Out of scope this plan:** body slim, AR glasses/fox stickers, CapCut `.model` loading, BiSeNet upgrade.

---

### Task 1: Beauty params + tests (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/beauty/types.ts`
- Create: `freefilmcut/apps/web/src/beauty/settings.ts`
- Create: `freefilmcut/apps/web/src/beauty/param-defs.ts`
- Create: `freefilmcut/apps/web/src/beauty/index.ts`
- Create: `freefilmcut/apps/web/src/beauty/__tests__/settings.test.ts`

- [ ] **Step 1: Write failing tests**

```ts
import { describe, expect, test } from "bun:test";
import {
	DEFAULT_BEAUTY_PARAMS,
	isBeautyActive,
	normalizeBeautyParams,
	readBeautyFromParams,
	resolveBeautyFromParams,
} from "@/beauty/settings";

describe("beauty settings", () => {
	test("normalize clamps to 0..1 and fills defaults", () => {
		expect(normalizeBeautyParams({ smooth: 2, eye: -1 })).toEqual({
			...DEFAULT_BEAUTY_PARAMS,
			smooth: 1,
			eye: 0,
		});
	});

	test("isBeautyActive false when all zero", () => {
		expect(isBeautyActive({ beauty: DEFAULT_BEAUTY_PARAMS })).toBe(false);
	});

	test("isBeautyActive true when any channel > 0", () => {
		expect(
			isBeautyActive({
				params: { "beauty.smooth": 0.2 },
			} as never),
		).toBe(true);
	});

	test("readBeautyFromParams reads dotted keys", () => {
		const b = readBeautyFromParams({
			params: {
				"beauty.smooth": 0.5,
				"beauty.whiten": 0.1,
				"beauty.eye": 0,
				"beauty.faceSlim": 0.3,
				"beauty.noseSlim": 0,
			},
		});
		expect(b.smooth).toBe(0.5);
		expect(b.faceSlim).toBe(0.3);
	});

	test("resolveBeautyFromParams returns null when inactive", () => {
		expect(resolveBeautyFromParams({ params: {} })).toBeNull();
	});
});
```

Fix the `isBeautyActive` test API in implementation so tests take `{ params: ParamValues }` consistently (adjust Step 1 tests to one shape before implementing).

- [ ] **Step 2: Run tests — expect FAIL**

```bash
cd freefilmcut && bun test apps/web/src/beauty/__tests__/settings.test.ts
```

Expected: module not found / FAIL

- [ ] **Step 3: Implement settings**

`types.ts`:

```ts
export type ClipBeautyParams = {
	smooth: number;
	whiten: number;
	eye: number;
	faceSlim: number;
	noseSlim: number;
};

export const DEFAULT_BEAUTY_PARAMS: ClipBeautyParams = {
	smooth: 0,
	whiten: 0,
	eye: 0,
	faceSlim: 0,
	noseSlim: 0,
};

export const BEAUTY_PARAM_KEYS = {
	smooth: "beauty.smooth",
	whiten: "beauty.whiten",
	eye: "beauty.eye",
	faceSlim: "beauty.faceSlim",
	noseSlim: "beauty.noseSlim",
} as const;
```

`settings.ts`:
- `clamp01`
- `normalizeBeautyParams(partial)`
- `readBeautyFromParams({ params })`
- `isBeautyActive({ params })` → any channel > `1e-4`
- `resolveBeautyFromParams({ params })` → `ClipBeautyParams | null` (null if inactive)

`param-defs.ts`: five number sliders 0..1 step 0.01, `keyframable: true` (match color-correction style).

`index.ts`: re-export.

- [ ] **Step 4: Run tests — expect PASS**

```bash
cd freefilmcut && bun test apps/web/src/beauty/__tests__/settings.test.ts
```

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/beauty
git commit -m "Add beauty param settings and unit tests."
```

---

### Task 2: Properties UI —「美颜」tab

**Files:**
- Create: `freefilmcut/apps/web/src/components/editor/panels/properties/beauty-section.tsx`
- Modify: `registry.tsx` — `getVideoConfig` / `getImageConfig` add tab `id: "beauty"`, label `美颜` / `Beauty`
- Modify: `media-properties-view.tsx` — support `page="beauty"` rendering `BeautySection`

- [ ] **Step 1: BeautySection UI**

Mirror `ColorCorrectionSection` patterns:
- Read via `readBeautyFromParams`
- On slider change: `editor.timeline.updateElement` / existing preview param path used by media properties (same as other media sliders — use `useElementPreview` if adjustment page does)
- Five labeled sliders bound to `BEAUTY_PARAM_KEYS`

- [ ] **Step 2: Register tab** after `adjustment` for video and image configs:

```ts
{
  id: "beauty",
  label: "Beauty",
  icon: <HugeiconsIcon icon={FaceIdIcon /* or MagicWand05Icon */} size={16} />,
  content: ({ trackId }) => (
    <MediaPropertiesView element={element} trackId={trackId} page="beauty" />
  ),
},
```

- [ ] **Step 3: Wire `page === "beauty"`** in `media-properties-view.tsx` to render `<BeautySection … />`.

- [ ] **Step 4: Manual check** — select image/video clip, open Beauty tab, move sliders, confirm params persist on element after blur/commit.

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/components/editor/panels/properties
git commit -m "Add Beauty properties tab for video and image clips."
```

---

### Task 3: Analysis types, cache, landmark fallback mask

**Files:**
- Create: `freefilmcut/apps/web/src/beauty/analysis/types.ts`
- Create: `freefilmcut/apps/web/src/beauty/analysis/cache.ts`
- Create: `freefilmcut/apps/web/src/beauty/analysis/landmark-fallback-mask.ts`
- Create: `freefilmcut/apps/web/src/beauty/analysis/__tests__/landmark-fallback-mask.test.ts`
- Create: `freefilmcut/apps/web/src/beauty/analysis/__tests__/cache.test.ts`

- [ ] **Step 1: Types**

```ts
export type FaceBox = { x: number; y: number; w: number; h: number }; // normalized 0..1
export type FaceLandmarks = {
	/** 478 MediaPipe points, normalized image coords */
	points: Float32Array; // length 478*2 (x,y) or 478*3
	box: FaceBox;
};
export type BeautyAnalysisFrame = {
	clipId: string;
	mediaTimeTicks: number;
	faces: FaceLandmarks[];
	/** R8 skin mask size */
	skinWidth: number;
	skinHeight: number;
	skinMask: Uint8Array; // 0..255
	source: "mediapipe" | "yolo+mediapipe" | "landmarks-only-mask";
};
```

- [ ] **Step 2: Cache** — Map key `` `${clipId}:${quantizedTicks}` ``, max entries ~64, LRU eviction; `invalidateClip(clipId)`.

- [ ] **Step 3: Fallback mask** — from face oval / cheek contour landmark indices, fill raster mask; punch out eye/lip indices. Unit-test: mask has some >0 pixels for a synthetic face oval.

- [ ] **Step 4: Commit**

```bash
git add freefilmcut/apps/web/src/beauty/analysis
git commit -m "Add beauty analysis types, cache, and landmark fallback mask."
```

---

### Task 4: MediaPipe Face Landmarker + YOLO-Face + Selfie skin

**Files:**
- Modify: `freefilmcut/apps/web/package.json` — deps `@mediapipe/tasks-vision`, `onnxruntime-web`
- Create: `mediapipe-face.ts`, `yolo-face.ts`, `selfie-skin.ts`, `face-body-analysis.ts`
- Create: `public/models/beauty/README.md` documenting model URLs + checksums
- Script or README step to place:
  - YOLO-Face ONNX (choose a small face-detect ONNX, e.g. YOLOV8n-face export; pin version in README)
  - `selfie_multiclass_256x256.onnx` (MediaPipe Selfie Multiclass, Apache-2.0 conversion)

- [ ] **Step 1: Install deps**

```bash
cd freefilmcut/apps/web && bun add @mediapipe/tasks-vision onnxruntime-web
```

- [ ] **Step 2: `mediapipe-face.ts`**
- Lazy-load `FaceLandmarker` with `FilesetResolver.forVisionTasks` from CDN or `/models/mediapipe/`
- `detect(image: ImageBitmap | HTMLCanvasElement): FaceLandmarks[]`
- Configure `numFaces: 4`, `outputFaceBlendshapes: false`, `runningMode: "IMAGE"` for scrub; VIDEO mode optional later

- [ ] **Step 3: `yolo-face.ts`**
- ORT Web session on `/models/beauty/yolo-face.onnx`
- `detect(image): FaceBox[]`
- NMS + score threshold documented as constants

- [ ] **Step 4: `selfie-skin.ts`**
- ORT session on selfie multiclass 256
- Argmax / skin class index per MediaPipe multiclass label map → R8 mask
- Resize mask to analysis size (e.g. 256 or frame downscale)

- [ ] **Step 5: `face-body-analysis.ts` orchestrator**

```ts
export async function analyzeBeautyFrame(args: {
  clipId: string;
  mediaTimeTicks: number;
  image: ImageBitmap;
}): Promise<BeautyAnalysisFrame> {
  // 1. cache hit → return
  // 2. mp = mediapipe.detect(image)
  // 3. if empty: boxes = yolo.detect; for each box crop+pad → mediapipe on crop → map points to full image
  // 4. skin = selfieSkin.infer(image); if fail → landmarkFallbackMask(faces)
  // 5. optional intersect skin with union of face boxes expanded 1.3x
  // 6. store cache; return
}
```

- [ ] **Step 6: Smoke test in Node/bun where possible** (cache + fallback). Full MediaPipe may be browser-only — gate browser-only modules with `typeof window` and keep orchestrator injectable for tests.

- [ ] **Step 7: Commit**

```bash
git add freefilmcut/apps/web/package.json freefilmcut/apps/web/bun.lock freefilmcut/apps/web/src/beauty freefilmcut/apps/web/public/models/beauty
git commit -m "Add FaceBodyAnalysis with MediaPipe, YOLO-Face, and Selfie skin."
```

---

### Task 5: Resolve + frame descriptor plumbing

**Files:**
- Modify: `visual-node.ts`, `resolve.ts`, `compositor/types.ts`, `frame-descriptor.ts`

- [ ] **Step 1:** Add `beauty: ClipBeautyParams | null` (or `ResolvedBeauty`) on resolved visual side / compositor item, parallel to `colorCorrection`.

- [ ] **Step 2:** In `resolve.ts` when building visual from image/video:

```ts
const beauty = resolveBeautyFromParams({ params: element.params });
// attach to resolved node
```

- [ ] **Step 3:** Plumb through `frame-descriptor.ts` onto blit items so compositor sees `item.beauty`.

- [ ] **Step 4: Commit**

```bash
git add freefilmcut/apps/web/src/services/renderer
git commit -m "Plumb resolved beauty params into the frame descriptor."
```

---

### Task 6: GPU beauty pass

**Files:**
- Create: `freefilmcut/apps/web/src/beauty/gpu/shaders.ts`
- Create: `freefilmcut/apps/web/src/beauty/gpu/beauty-pass.ts`
- Modify: `three-compositor.ts` — after media color-grade/correction for that item, if `item.beauty` active, run beauty pass

- [ ] **Step 1: Shaders (MVP)**
- **Warp:** fullscreen; uniforms: `uEye`, `uFaceSlim`, `uNoseSlim`, landmark texture or uniform arrays (cap faces=1 first if needed, then multi). Displace UV toward/away from eye centers / cheek / nose indices (document landmark index constants in `beauty/landmarks-indices.ts`).
- **Smooth:** bilateral-ish or dual-filter blur mixed by `uSkinMask * uSmooth`.
- **Whiten:** `mix(color, liftLuma(color), uSkinMask * uWhiten)`.

Order: warp → smooth → whiten into temp RTs (ping-pong).

- [ ] **Step 2: `applyBeautyPass({ renderer, input, beauty, analysis })`**
- Upload skin mask as `THREE.DataTexture` (Nearest/Linear)
- If analysis missing but beauty active: skip warp channels that need points; still allow smooth/whiten only if fallback mask available, else no-op

- [ ] **Step 3: Hook compositor** near `applyColorCorrectionToMaterial` / media draw path so beauty runs on the clip’s color buffer before timeline composite.

- [ ] **Step 4: Wire analysis request**
- From preview/compositor when `beauty` active: sample current media frame → `analyzeBeautyFrame` (debounce / cache). Do not block first frames forever — show unprocessed until ready.

- [ ] **Step 5: Commit**

```bash
git add freefilmcut/apps/web/src/beauty/gpu freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts
git commit -m "Add GPU beauty pass for warp, smooth, and whiten."
```

---

### Task 7: Integration verification

- [ ] **Step 1:** `bun test` for beauty unit tests
- [ ] **Step 2:** Manual — image with clear face: each slider visible effect; all zero = identity
- [ ] **Step 3:** Manual — hard case where MediaPipe alone fails if available; YOLO path logs `source: "yolo+mediapipe"`
- [ ] **Step 4:** Save project, reload, beauty params restored
- [ ] **Step 5:** Export short clip; beauty present (or document known export gap if preview-only until hook confirmed — **must** hook export path in Task 6; if blocked, fix before closing)
- [ ] **Step 6:** Update spec status line to `已确认；实现中/已实现` as appropriate
- [ ] **Step 7: Final commit** if spec status updated

---

## Spec coverage checklist

| Spec item | Task |
|-----------|------|
| Beauty tab on video/image | Task 2 |
| Five sliders 0..1 | Task 1–2 |
| params persistence | Task 1–2 (params keys) |
| MediaPipe landmarks | Task 4 |
| YOLO-Face fallback | Task 4 |
| Selfie Multiclass skin | Task 4 |
| Landmark ROI fallback | Task 3 |
| Worker/cache architecture | Task 3–4 (cache; Worker optional same-thread first if Worker blockers — prefer Worker in Task 4 orchestrator) |
| GPU warp → smooth → whiten | Task 6 |
| Skip pass when all zero | Task 1 + 6 |
| No CapCut `.model` | Task 4 README |
| Multi-face same intensity | Task 4–6 (apply all faces) |

## Notes for implementers

1. Prefer **same-thread async** first if Worker + OffscreenCanvas + ORT complicates Next; keep API async so Worker swap is later.
2. Model binaries: do not commit huge files without git-lfs; README + download script acceptable.
3. Landmark index constants: use MediaPipe Face Landmarker topology docs; put named indices in `beauty/landmark-indices.ts`.
4. Future AR stickers / person occlusion should import `FaceBodyAnalysis`, not duplicate detectors.
