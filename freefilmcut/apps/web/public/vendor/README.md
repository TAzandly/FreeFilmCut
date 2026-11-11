# Beauty vendor runtimes

`onnxruntime-web` and `@mediapipe/tasks-vision` JS/WASM files are **not
committed**. They are copied here from `node_modules` by:

```bash
bun run sync:beauty-vendor
```

`dev` and `build` run that script automatically.

Served at:

| Path | Source |
| --- | --- |
| `/vendor/onnxruntime-web/ort.wasm.min.mjs` | `onnxruntime-web/dist` |
| `/vendor/onnxruntime-web/ort-wasm-simd-threaded.*` | same |
| `/vendor/mediapipe-tasks-vision/vision_bundle.mjs` | `@mediapipe/tasks-vision` |
| `/vendor/mediapipe-tasks-vision/wasm/*` | same |

Loaded only when beauty face analysis first runs (still outside the Turbopack
graph). Analysis **models** are separate — see `public/models/beauty/README.md`.
