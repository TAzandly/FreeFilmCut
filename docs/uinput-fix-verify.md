# uInput fix verify (2026-10-13)

## Why F12 showed no compose logs
1. Logs used `console.info` (often hidden when DevTools level filter hides Info/Verbose).
2. Log was one-shot: `if (belowDebugFrames < 1)` — if the first frame fired before the console was open, it never appeared again.
3. Dev server may have been on a stale Turbopack graph; `.next` was cleared and Next restarted.

## What we changed
- Diagnostics: `console.warn` every ~1s with build id `uinput-diag-v3`
  - `[FreeFilmCut three] render heartbeat`
  - `[FreeFilmCut compose]` item order bottom→top
  - `[FreeFilmCut uInput] bound` + top/mid/bot pixel samples
- Below sync: `blitTextureToTarget(accum → belowSourceRT)` (same path as preview present), not `copyTextureToTexture`.
- `uInput` bind hardened; other null samplers get white 1x1 (not the below tex).

## Server
- URL: http://localhost:3000
- Restarted with cleared `.next`; client chunk contains `uinput-diag-v3`.

## How to verify
1. Hard refresh the editor (Ctrl+Shift+R).
2. F12 → Console → ensure **Warnings** are enabled (Default levels).
3. Play on a frame with jpg below + video + inputtest pack.
4. Expect every ~1s: heartbeat + compose (`layers` order) + `uInput bound` with `layersBelowCount >= 2`.
5. Pixel sample: `top`/`bot` avg should look like jpg; `mid` like video.
6. Cube face should show the full 9:16 letterbox composite (jpg in bars), not raw video only.
