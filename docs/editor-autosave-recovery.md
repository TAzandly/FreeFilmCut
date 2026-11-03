# FreeFilmCut Asset Editor — recovery (2026-10-13)

## What broke
1. **Autosave race**: `Storage.get` did not await async `fromJSON`. `cameraResetted` during load scheduled autosave while the scene was still empty, which could overwrite a good IndexedDB snapshot with an empty Scene.
2. **ShaderMaterial UI bridge**: FreeFilmCut set `material.color` / `material.map` on ShaderMaterial for sidebar controls. Those were also written into autosave JSON next to `uniforms`, which made reloads fragile.

Outliner showing only **Camera + Scene** (empty) is the editor default when autosave is empty or failed — not a missing camera widget.

## What we fixed
- `Storage.get` awaits async hydration (hydration time is real again).
- `editor.isLoadingState` blocks autosave while `fromJSON` runs.
- `fromJSON` try/catch: on failure, clears broken autosave and starts empty instead of looping.
- Autosave JSON **strips** ShaderMaterial top-level `color`/`map` (keeps uniforms).
- After load, sidebar color/map bridge is reattached from uniforms.

## Recovering your old cube scene
IndexedDB no longer had the mesh (already overwritten by the empty save). Re-create in the Editor, or use your exported pack:

`C:\Users\pc\Downloads\freecapcut.3d.vfxpack`

Hard-refresh the Asset Editor (`http://localhost:5174/editor/`), add a Cube + texture again, then **File → Export → VfxPack**.

## If it happens again
DevTools → Application → IndexedDB → `threejs-editor` → delete `states`, then reload.
