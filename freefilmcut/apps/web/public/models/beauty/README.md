# Beauty analysis models

These model files are **NOT committed** to the repository (see `.gitignore`).
A developer must download them and place them in this directory. They are
served statically at `/models/beauty/<filename>`.

| File | Used by | Required? | If missing |
| --- | --- | --- | --- |
| `face_landmarker.task` | `mediapipe-face.ts` | **Yes** | Face detection fails (warning logged); frame has no faces and is not cached |
| `yolo-face.onnx` | `yolo-face.ts` | Optional | Detector fallback skipped, warns once, `detect` returns `[]` |
| `selfie_multiclass_256x256.onnx` | `selfie-skin.ts` | Optional | Skin mask falls back to the landmark polygon mask (`source: "landmarks-only-mask"`) |

## 1. `face_landmarker.task` (MediaPipe Face Landmarker, float16)

- License: Apache-2.0 (Google)
- Download (pinned model version `1`):
  <https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task>
- Docs: <https://ai.google.dev/edge/mediapipe/solutions/vision/face_landmarker>

The MediaPipe WASM runtime is loaded from jsDelivr pinned to the installed
`@mediapipe/tasks-vision` version (`MEDIAPIPE_WASM_CDN_BASE`). To self-host,
copy `node_modules/@mediapipe/tasks-vision/wasm/*` to
`public/models/beauty/mediapipe-wasm/` and call
`configureMediapipeFace({ wasmBaseUrl: "/models/beauty/mediapipe-wasm" })`.

## 2. `yolo-face.onnx` (YOLO-Face detector)

Used only when MediaPipe finds no faces (profile / small / occluded faces).
The detector input is `1x3x640x640` RGB `[0,1]` (letterboxed). Output is decoded
as `[1, 4+1(+extras), N]` (YOLOv8 / YOLO11 style) or `[1, N, 5+extras]`
(YOLOv5-face style) with `cx, cy, w, h, score` in the first five channels.

Recommended (single class "face", dynamic-shape ONNX, ~80 MB), pinned to commit
`9bf9b191dda00653b40085b3fb7649bd6225e786`:

```bash
curl -L -o yolo-face.onnx \
  https://huggingface.co/astaileyyoung/yolov11m-face-onnx/resolve/9bf9b191dda00653b40085b3fb7649bd6225e786/yolov11m-face-dynamic.onnx
```

```powershell
Invoke-WebRequest -OutFile yolo-face.onnx `
  https://huggingface.co/astaileyyoung/yolov11m-face-onnx/resolve/9bf9b191dda00653b40085b3fb7649bd6225e786/yolov11m-face-dynamic.onnx
```

- Repo: <https://huggingface.co/astaileyyoung/yolov11m-face-onnx> (card says MIT)
- **License caveat:** the weights derive from Ultralytics YOLO11, whose upstream
  license is AGPL-3.0. Review this before shipping the model with a distributed
  product. Any YOLOv8/YOLO11/YOLOv5-face ONNX with the output layout above can be
  substituted (e.g. export your own with `yolo export format=onnx imgsz=640`).

## 3. `selfie_multiclass_256x256.onnx` (MediaPipe Selfie Multiclass)

Classes: `0` background, `1` hair, `2` body-skin, `3` face-skin, `4` clothes,
`5` others. Skin = classes 2 and 3. Input is `256x256` RGB `[0,1]` (NHWC or
NCHW auto-detected from model metadata); output NHWC `[1,256,256,6]` or NCHW
`[1,6,256,256]` is accepted.

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

`onnxruntime-web` fetches its `.wasm` runtime from jsDelivr pinned to the
installed version (`ORT_WASM_CDN_BASE` in `ort-runtime.ts`). To self-host, copy
`node_modules/onnxruntime-web/dist/*.wasm` and `*.mjs` somewhere under
`public/` and call `configureOrtWasmPaths("/path/")` before first use.

## Not used

CapCut / Jianying `.model` files are intentionally **not** loaded.
