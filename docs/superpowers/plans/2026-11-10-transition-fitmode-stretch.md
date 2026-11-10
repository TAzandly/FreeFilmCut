# Transition fitMode stretch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transition `.vfxpack` can opt into `fitMode: "stretch"` so design-aspect cameras map onto the NLE canvas by stretching; default remains crop.

**Architecture:** Manifest field + normalize helpers; NLE `renderOnePack` / `updatePackCameraAspects` keep authored aspect for stretch transitions; Asset Editor Project → VFX Pack UI + exporter write the field.

**Tech Stack:** TypeScript (freefilmcut web), Three.js editor JS, vitest.

**Spec:** `docs/superpowers/specs/2026-11-10-transition-fitmode-stretch-design.md`

---

## File map

| File | Role |
|------|------|
| `freefilmcut/apps/web/src/vfxpack/transition-fit-mode.ts` | `normalizeTransitionFitMode`, `authoredAspectFromResolution` |
| `freefilmcut/apps/web/src/vfxpack/__tests__/transition-fit-mode.test.ts` | Unit tests |
| `freefilmcut/apps/web/src/vfxpack/types.ts` | `fitMode?` on `VfxManifest` |
| `freefilmcut/apps/web/src/vfxpack/index.ts` | Re-export helpers |
| `freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts` | Apply stretch vs crop for transitions |
| `three.js/editor/js/Sidebar.Project.VfxPack.js` | Fit mode select (transition only) |
| `three.js/editor/js/Strings.js` | EN/ZH labels |
| `three.js/editor/js/VfxPackExporter.js` | Write `manifest.fitMode` for transitions |

---

### Task 1: Normalize helpers + tests (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/vfxpack/transition-fit-mode.ts`
- Create: `freefilmcut/apps/web/src/vfxpack/__tests__/transition-fit-mode.test.ts`
- Modify: `freefilmcut/apps/web/src/vfxpack/types.ts` (add `fitMode?: "crop" | "stretch"`)
- Modify: `freefilmcut/apps/web/src/vfxpack/index.ts` (export)

- [ ] **Step 1:** Write failing tests for normalize + authored aspect
- [ ] **Step 2:** Implement helpers until green
- [ ] **Step 3:** Add `fitMode` to `VfxManifest`; export from index

---

### Task 2: NLE compositor

**Files:**
- Modify: `three-compositor.ts` — `lookupPackMeta`, `renderOnePack` camera aspect, `updatePackCameraAspects`

- [ ] **Step 1:** Extend `lookupPackMeta` with `fitMode` + resolution from pack.manifest
- [ ] **Step 2:** For transition + stretch, set `camera.aspect = authoredAspect`; else project W/H
- [ ] **Step 3:** Same rule in `updatePackCameraAspects` so resize does not force crop on stretch packs

---

### Task 3: Asset editor UI + export

**Files:**
- Modify: `Sidebar.Project.VfxPack.js`, `Strings.js`, `VfxPackExporter.js`

- [ ] **Step 1:** Fit mode select; config key `project/vfxpack/fitMode`; visible only when type is transition
- [ ] **Step 2:** Strings EN + ZH
- [ ] **Step 3:** On export, if `packType === 'transition'`, set `manifest.fitMode` to normalized crop|stretch

---

### Task 4: Verify

- [ ] Run `transition-fit-mode` tests
- [ ] Update spec status to confirmed/implemented note if needed
