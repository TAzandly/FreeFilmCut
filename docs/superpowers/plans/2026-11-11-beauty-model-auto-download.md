# Beauty Model Auto-Download Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** When `/models/beauty/*` is missing on deploy, auto-download pinned upstream models into Cache API on first beauty enable, with inline Beauty-panel progress.

**Architecture:** Shared `ensureBeautyModels()` probes local paths, then Cache API, then upstream fetch. Main thread drives UI progress; workers run the same ensure against the shared Cache (each realm creates its own `blob:` URLs). Analysis waits on ensure before warmup.

**Tech Stack:** Cache API, fetch + ReadableStream progress, existing `configureMediapipeFace` / `configureDlmvSkin` / `configureSelfieSkin`, Beauty section React UI.

**Spec:** `docs/superpowers/specs/2026-11-11-beauty-model-auto-download-design.md`

---

## File map

| File | Responsibility |
|---|---|
| `src/beauty/analysis/model-catalog.ts` | Local paths, remote URLs, byte sizes, cache name |
| `src/beauty/analysis/ensure-models.ts` | Probe / download / cache / configure / status subscribe |
| `src/beauty/analysis/__tests__/ensure-models.test.ts` | Pure + mocked fetch/cache tests |
| `src/beauty/analysis/ort-runtime.ts` | `modelFileExists` treats `blob:` as present |
| `src/beauty/analysis/worker-client.ts` | Await ensure before worker warmup / main analyze |
| `src/beauty/analysis/analysis.worker.ts` | Await ensure on warmup |
| `src/beauty/index.ts` | Re-export ensure + status types |
| `src/components/editor/panels/properties/beauty-section.tsx` | Trigger ensure on enable; inline status |

---

### Task 1: Catalog + ensure core (TDD)

**Files:**
- Create: `freefilmcut/apps/web/src/beauty/analysis/model-catalog.ts`
- Create: `freefilmcut/apps/web/src/beauty/analysis/ensure-models.ts`
- Create: `freefilmcut/apps/web/src/beauty/analysis/__tests__/ensure-models.test.ts`
- Modify: `freefilmcut/apps/web/src/beauty/analysis/ort-runtime.ts` (`modelFileExists`)

- [ ] **Step 1:** Add catalog constants matching README remotes + approximate sizes.
- [ ] **Step 2:** Write tests for: local hit skips fetch; cache hit skips fetch; remote fetch stores cache and reports progress; landmarker failure → error status; DLMV fail → try selfie.
- [ ] **Step 3:** Implement `ensureBeautyModels` with single-flight promise, `subscribeBeautyModelStatus`, configure hooks injected for tests.
- [ ] **Step 4:** `modelFileExists`: return `true` for `blob:` / `data:` URLs.
- [ ] **Step 5:** Run `bun test src/beauty/analysis/__tests__/ensure-models.test.ts`.

### Task 2: Wire analysis paths

**Files:**
- Modify: `worker-client.ts`, `analysis.worker.ts`, `index.ts`

- [ ] **Step 1:** Before `facesLane.available()` / main-thread analyze and on worker warmup, `await ensureBeautyModels()`.
- [ ] **Step 2:** Export ensure API from `@/beauty`.

### Task 3: Beauty panel UI

**Files:**
- Modify: `beauty-section.tsx`

- [ ] **Step 1:** On enable `true`, call `ensureBeautyModels()`.
- [ ] **Step 2:** Subscribe to status; show downloading % / ready / error+Retry under header.
- [ ] **Step 3:** Manual check locally (optional): clear Cache, remove models, enable beauty.

### Task 4: Spec status + verify

- [ ] Mark design status confirmed/implemented.
- [ ] Run `bun test src/beauty`.
