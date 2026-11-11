# Beauty model auto-download (deploy without local models)

Date: 2026-11-11  
Status: **Confirmed — implemented (pending deploy verify)**  
Scope: First-time beauty model fetch when `/models/beauty/*` is missing (e.g. Vercel deploy), plus inline status in the Beauty panel.

---

## 1. Problem

Beauty analysis models are gitignored (`*.onnx`, `*.task`). Local / self-hosted installs place them under `public/models/beauty/`. Public deploys (e.g. `free-film-cut.vercel.app`) therefore 404:

- `face_landmarker.task`
- `dlmv.onnx`
- `selfie_multiclass_256x256.onnx`

Enabling beauty then fails silently or degrades with no user-facing explanation.

Out of scope for this change: Databuddy `basket.databuddy.cc` 403 (third-party analytics).

---

## 2. Goals

1. On **first beauty enable**, if local model files are missing, **automatically download** from the same upstream URLs already documented in `public/models/beauty/README.md`.
2. Persist downloads in the browser **Cache API** so reloads do not re-fetch the full ~60MB set.
3. Show **inline progress / ready / error** under the Beauty section switch (no global toast).
4. Keep the existing local-dev path: if `/models/beauty/<file>` exists, use it and skip remote download.

---

## 3. Non-goals

- Hosting models on our own CDN / committing binaries to git.
- Downloading models before beauty is enabled.
- Replacing DLMV / MediaPipe / ORT runtime wiring.
- Fixing Databuddy analytics 403.

---

## 4. Approach (chosen: A)

Probe same-origin `/models/beauty/*` first. On miss, fetch upstream → store in `caches.open("beauty-models-v1")` → point MediaPipe / ORT at a usable URL (cache `Response` URL via `blob:` from cached body, or configure model URLs to the resolved blob).

Rejected:

- **B** — always hit upstream, no cache (re-downloads every session).
- **C** — OPFS file store (heavier; little gain over Cache API here).

---

## 5. Model catalog

| Local path | Role | Upstream (pinned) | Required? |
|---|---|---|---|
| `/models/beauty/face_landmarker.task` | MediaPipe Face Landmarker | `https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task` | Yes (warp) |
| `/models/beauty/dlmv.onnx` | Primary skin (smooth/whiten) | `https://github.com/samhaswon/skin_segmentation/releases/download/v0.0.2/dlmv.onnx` | Preferred |
| `/models/beauty/selfie_multiclass_256x256.onnx` | Skin fallback | HuggingFace `FreeHugsForRobots/ps-skin-seg` commit `f3a72025451688fb893083991fdfd4562814a4dd` | Only if DLMV missing / fails |

Download order: landmarker → DLMV → (selfie only if DLMV unavailable after probe/download).

Do **not** auto-download `yolo-face.onnx` (pipeline unused).

---

## 6. Runtime flow

```
Beauty switch ON
  → ensureBeautyModels({ onProgress })
      for each needed model:
        if modelFileExists(localPath) → use localPath
        else if Cache hit for catalog key → blob URL from cache
        else fetch(upstream, { progress }) → cache.put → blob URL
      configureMediapipeFace({ modelUrl })
      configureDlmvSkin({ modelUrl })  // and/or selfie
  → analysis / preview continues as today
```

- Single-flight: concurrent enable / analysis calls share one `ensure` promise.
- Worker: resolve / configure model URLs **before** preload in the worker (main thread runs ensure, then passes absolute/blob URLs into worker config message, **or** worker runs the same ensure against Cache API — prefer **main-thread ensure + configure message** so UI progress stays on the UI thread).
- CORS: upstream hosts already used by public demos; if a host blocks browser CORS, surface panel error + Retry (no silent hang).

### Progress accounting

- Byte-weighted across files being fetched this session.
- Local hits and cache hits count as complete for that file (no network %).
- UI string examples:
  - `Downloading beauty models… 42%`
  - `Beauty models ready` (auto-clear after ~3s)
  - `Failed to download beauty models` + Retry control

---

## 7. UI

- Location: Beauty properties section (`beauty-section.tsx`), **below** the header switch / title row (or directly under the switch when expanded).
- Visible when status ≠ idle (downloading / ready flash / error).
- No sonner toast for this flow.
- English copy (match current Beauty panel labels).

---

## 8. Files (expected)

| Area | Change |
|---|---|
| `beauty/analysis/model-catalog.ts` (new) | Local paths + upstream URLs + sizes (for %) |
| `beauty/analysis/ensure-models.ts` (new) | Probe / cache / download / configure |
| `beauty/analysis/worker-client.ts` (+ protocol) | Apply resolved model URLs before preload |
| `beauty-section.tsx` | Call ensure on enable; inline status |
| Unit tests | Catalog resolve, cache hit skip fetch, progress weights |

---

## 9. Acceptance

1. Deploy **without** `public/models/beauty/*` binaries: enable Beauty → panel shows download progress → models become usable for warp + smooth/whiten.
2. Second enable / reload on same origin: no large re-download (Cache API hit); panel does not stay stuck on “Downloading…”.
3. Local machine with models on disk: no remote fetch; Beauty works as today.
4. Forced network failure: panel shows failure + Retry; app does not crash.
5. YOLO remains unused / not downloaded.

---

## 10. Risks

- **CORS / GitHub release redirects**: may need `redirect: follow` and Accept headers; fallback order DLMV → selfie helps if one host fails.
- **Quota**: Cache API eviction under storage pressure → next enable re-downloads (acceptable).
- **GPL-3.0 DLMV**: already documented; auto-download does not change license posture.
