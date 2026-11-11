# Beauty analysis models

These model files are **NOT committed** to the repository (see `.gitignore`).
A developer must download them and place them in this directory. They are
served statically at `/models/beauty/<filename>`.

| File | Used by | Required? | If missing |
| --- | --- | --- | --- |
| `face_landmarker.task` | `mediapipe-face.ts` | **Yes** (warp) | Face landmarks fail; warp skips, smooth/whiten can still use skin seg |
| `dlmv.onnx` | `dlmv-skin.ts` | **Preferred** (smooth/whiten) | Falls back to selfie multiclass, then landmark/box mask |
| `selfie_multiclass_256x256.onnx` | `selfie-skin.ts` | Optional fallback | Used only when DLMV is missing |
| `yolo-face.onnx` | — | **Unused** | Kept on disk only; the beauty pipeline no longer runs YOLO |

## 1. `face_landmarker.task` (MediaPipe Face Landmarker, float16)

- License: Apache-2.0 (Google)
- Download (pinned model version `1`):
  <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>
- Docs: <https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker>

The MediaPipe JS/WASM runtime is self-hosted under `/vendor/mediapipe-tasks-vision/`
(synced by `bun run sync:beauty-vendor`). Override with
`configureMediapipeFace({ esmUrl, wasmBaseUrl })` if needed. CDN constants
(`MEDIAPIPE_ESM_CDN_URL`) remain as a manual fallback only.

## 2. `dlmv.onnx` (DeepLabV3 + MobileNetV3 skin segmentation)

Primary model for **smooth / whiten**. Segments all skin (face + body); the
mask is **not** clipped to face landmarks. Input `1x3x256x256` RGB `[0,1]`
NCHW; output `1x1x256x256` soft skin probability (min-max normalized in code).

- Upstream: [samhaswon/skin_segmentation](https://github.com/samhaswon/skin_segmentation) `dlmv`
  (**GPL-3.0** — review before shipping in a closed product)
- Download (release `v0.0.2`, ~43 MB):

```bash
curl -L -o dlmv.onnx \
  https://github.com/samhaswon/skin_segmentation/releases/download/v0.0.2/dlmv.onnx
```

```powershell
Invoke-WebRequest -OutFile dlmv.onnx `
  https://github.com/samhaswon/skin_segmentation/releases/download/v0.0.2/dlmv.onnx
```

## 3. `selfie_multiclass_256x256.onnx` (MediaPipe Selfie Multiclass)

Fallback when `dlmv.onnx` is missing. Classes: `0` background, `1` hair,
`2` body-skin, `3` face-skin, `4` clothes, `5` others. Current fallback uses
**face-skin (3) only**. Input is `256x256` RGB `[0,1]` (NHWC or NCHW
auto-detected); output NHWC `[1,256,256,6]` or NCHW `[1,6,256,256]` is accepted.

- Original model: MediaPipe Selfie Multiclass Segmentation (Google),
  **Apache-2.0** — <https://github.com/google-ai-edge/mediapipe>
- ONNX conversion (Apache-2.0), pinned to commit
  `f3a72025451688fb893083991fdfd4562814a4dd` (~16 MB):

```bash
curl -L -o selfie_multiclass_256x256.onnx \
  https://huggingface.co/FreeHugsForRobots/ps-skin-seg/resolve/f3a72025451688fb893083991fdfd4562814a4dd/selfie_multiclass_256x256.onnx
```

```powershell
Invoke-WebRequest -OutFile selfie_multiclass_256x256.onnx `
  https://huggingface.co/FreeHugsForRobots/ps-skin-seg/resolve/f3a72025451688fb893083991fdfd4562814a4dd/selfie_multiclass_256x256.onnx
```

- Repo: <https://huggingface.co/FreeHugsForRobots/ps-skin-seg>
- Alternative ONNX conversion: <https://huggingface.co/senty-au/selfie_multiclass_256x256-ONNX> (`onnx/model.onnx`, Apache-2.0)
- Self-convert from the original `.tflite` with
  [tf2onnx](https://github.com/onnx/tensorflow-onnx):
  `python -m tf2onnx.convert --tflite selfie_multiclass_256x256.tflite --output selfie_multiclass_256x256.onnx`

## ONNX Runtime Web

`onnxruntime-web` is self-hosted under `/vendor/onnxruntime-web/` (synced by
`bun run sync:beauty-vendor`). Override with
`configureOrtRuntime({ esmUrl, wasmPaths })` if needed. CDN constants
(`ORT_ESM_CDN_URL`) remain as a manual fallback only.

## Not used

CapCut / Jianying `.model` files are intentionally **not** loaded.
