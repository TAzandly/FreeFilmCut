# Face FX vfxpack Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship `face-fx` packs (3D face anchors, eye rays, 2D funhouse warp) authorable in the Asset Editor with MediaPlayer preview, exportable as `.vfxpack`, and playable on the NLE effect track (`scope: below`).

**Architecture:** New pack type `face-fx` with a `manifest.faceFx` layer list. Shared MediaPipe Face Landmarker drives layers. Editor previews via MediaPlayer → landmarks → layers. NLE composites `accumBelow` through the same layer runner. No particle system in phase 1.

**Tech Stack:** Three.js editor, `.vfxpack` zip, MediaPipe Face Landmarker, NLE Three compositor + beauty analysis worker reuse, bun tests.

**Spec:** `docs/superpowers/specs/2026-11-12-face-fx-vfxpack-design.md`

---

## File map

| File | Responsibility |
|------|----------------|
| `freefilmcut/apps/web/src/vfxpack/types.ts` | Add `face-fx` to PrimaryVfxPackType; optional `faceFx` on manifest |
| `freefilmcut/apps/web/src/vfxpack/pack-placement.ts` | Labels, order, placement = effect track |
| `freefilmcut/apps/web/src/vfxpack/face-fx.ts` | Normalize/validate `faceFx` schema (pure) |
| `freefilmcut/apps/web/src/vfxpack/__tests__/face-fx.test.ts` | Schema + placement tests |
| `freefilmcut/apps/web/src/vfxpack/load-pack.ts` | `defaultScopeForType` → `below` for face-fx |
| `three.js/editor/js/VfxPackExporter.js` | `PACK_TYPES` includes `face-fx`; embed `faceFx` |
| `three.js/editor/js/Sidebar.Project.VfxPack.js` | Type dropdown (via PACK_TYPES) |
| `three.js/editor/js/Strings.js` | EN/ZH labels for Face FX |
| Later: `face-fx-runtime.ts`, editor preview controller, compositor hook, sample pack |

---

### Task 1: Pack type contract (NLE + schema)

**Files:**
- Modify: `freefilmcut/apps/web/src/vfxpack/types.ts`
- Modify: `freefilmcut/apps/web/src/vfxpack/pack-placement.ts`
- Modify: `freefilmcut/apps/web/src/vfxpack/load-pack.ts`
- Create: `freefilmcut/apps/web/src/vfxpack/face-fx.ts`
- Create: `freefilmcut/apps/web/src/vfxpack/__tests__/face-fx.test.ts`
- Modify: `freefilmcut/apps/web/src/vfxpack/index.ts` (exports)

- [x] **Step 1:** Add failing tests for `normalizeVfxPackType("face-fx")`, placement dragHint, `normalizeFaceFx` layers.
- [x] **Step 2:** Implement type + placement + `normalizeFaceFx` + defaultScope.
- [x] **Step 3:** `bun test src/vfxpack/__tests__/face-fx.test.ts` → pass.

### Task 2: Editor pack type + export stub

**Files:**
- Modify: `three.js/editor/js/VfxPackExporter.js` (`PACK_TYPES`)
- Modify: `three.js/editor/js/Strings.js` (en + zh)
- Modify exporter to copy `editor.config` / scene `userData.faceFx` into manifest when present (empty layers OK)

- [x] **Step 1:** Add `face-fx` to `PACK_TYPES`.
- [x] **Step 2:** Add string keys `sidebar/project/vfxpack/type/face-fx`.
- [x] **Step 3:** On export, if pack type is face-fx, write `scope: "below"` and `faceFx` from config/userData (default empty layers + driver flags).

### Task 3: Shared face driver (landmarks + optional matrix)

**Files:** under `freefilmcut/apps/web/src/beauty/analysis/` and/or `src/vfxpack/face-fx-driver.ts`

- [x] Reuse Face Landmarker; option to enable transformation matrices for face-fx.
- [x] Unit-test bind target → landmark index helpers.

### Task 4: warp2d runtime + NLE below pass

- [x] Implement first presets (`bulge`, `pinch`, `stretchY`, `wave`) UV math (`face-fx-warp2d.ts`).
- [x] Wire GPU pass + compositor for `face-fx` packs like filter below input.

### Task 5: anchor3d + eyeRay

- [x] Procedural ears (anchor3d) + eyeRay beam on NLE GPU path; real GLB bind when `asset` set.
- [x] Editor MediaPlayer preview controller (View → Face FX).

### Task 6: Sample packs + docs

- [x] Sample packs under `public/vfxpacks/face-fx/` + editor presets README.
- [x] Mark design status implementing → runtime MVP; update plan.

---

## Execution note

Implement Task 1–2 immediately in this session; continue Task 3+ in follow-up commits. No particles in phase 1.
