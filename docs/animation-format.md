# FreeFilmCut `.anim` Format (MVP + Slice D)

Pack-embedded object animation, separate from OpenCut timeline keyframes (`exposedParams`).
Editor authors `.anim`; OpenCut samples by **clip local time** when playing a vfxpack.

## Files

- Extension: `.anim` (JSON)
- Project folder: `assets/animations/*.anim`
- Pack path: `pack/animations/*.anim`

## Schema (`freecapcut.anim/2`, reads `/1`)

`/2` only adds an optional per-key `ease` (see table); a `/1` file is a valid `/2` file.

```json
{
  "format": "freecapcut.anim/2",
  "name": "CubeMove",
  "fps": 30,
  "duration": 1.0,
  "loop": "clamp",
  "targets": [
    {
      "objectUuid": "mesh-or-camera-uuid",
      "tracks": [
        { "path": "position.x", "interp": "linear", "keys": [{ "t": 0, "v": 0, "ease": "easeOut" }, { "t": 1, "v": 2 }] },
        { "path": "textAnim.c_charIn_1.progress", "interp": "linear", "keys": [{ "t": 0, "v": 0 }, { "t": 0.8, "v": 1 }] },
        { "path": "material.<matUuid>.uniforms.intensity", "interp": "linear", "keys": [{ "t": 0, "v": 0 }, { "t": 1, "v": 1 }] },
        { "path": "material.<matUuid>.uniforms.tint.r", "interp": "linear", "keys": [{ "t": 0, "v": 1 }, { "t": 1, "v": 0 }] },
        { "path": "postProcess.<effectId>.strength", "interp": "linear", "keys": [{ "t": 0, "v": 0.5 }, { "t": 1, "v": 2 }] }
      ]
    }
  ]
}
```

| Field / path | Notes |
|------|------|
| `fps` | Editor reference: 24 / 25 / 30 |
| `duration` | Seconds; respects `loop` |
| `loop` | `clamp` (default) or `loop` |
| Transform | `position/rotation/scale` `.x/.y/.z` (euler radians) |
| Material | `material.<materialUuid>.uniforms.<name>` float/bool; components `.x/.y/.z/.w` or color `.r/.g/.b` |
| Post-process | `postProcess.<effectId>.<param>` on camera stack (`effectId` = entry.id) |
| Text animation | `textAnim.<compId>.progress` / `.enabled` / `.<param>` / `.<param>.0\|1` / `.selector.start\|end\|amount\|delay` on a UI Text (see `three.js/editor/js/ui/TEXTANIM.md`) |
| `interp` | `linear` (default) or `step` (bools use step when keyed from UI) |
| key `ease` | Optional, shapes the segment from this key to the next: `linear` (omitted) / `easeIn` / `easeOut` / `easeInOut` / `back` / `elastic` / `bounce` / `step`. Ignored when the track `interp` is `step`. |

## Priority vs OpenCut timeline keyframes

1. Sample **pack `.anim`** at clip local time (transforms, material uniforms, PP params on pack stack).
2. Then apply timeline **exposedParams keyframes** (may override overlapping exposed floats).

**Rule: clip exposed keyframes override pack `.anim` for the same exposed param.**

## Clip local time

`tLocal = timelineTime - clip.start` → `mapAnimTime(tLocal, duration, loop)`.

OpenCut compositor: `applyAnimToRoot(root, clip, tLocal, { materialsByUuid, postProcess })` then `applyExposedMaterialParams`.

## Editor UI

1. View → 动画: FPS, play/scrub.
2. Select mesh → **添加关键帧** (transform) / **材质关键帧** (exposed uniforms if any, else all numeric uniforms; skips uInput/belowInput/iChannel0).
3. Select camera with PP stack → **PP关键帧** (enabled effects' numeric/bool params).
4. Save `.anim` → export VfxPack embeds referenced clips.

## Limits (current)

- Material tracks require ShaderMaterial/RawShaderMaterial `uniforms` (not MeshStandardMaterial color/metalness as dedicated paths).
- Color/vector uniforms are keyed per-component (interpolated independently).
- PP tracks mutate `postProcessStack` / pack `postProcess` params; Editor Viewport syncs via `syncComposerParams` on the next frame.
- Bool params stored as 0/1; UI uses `step` interp.

## Blender / GLB / FBX import

- Imported `THREE.AnimationClip`s (including **skeletal / bone** tracks) can be **previewed** in the Editor animation panel via `AnimationMixer` (green **导入动画** row).
- **转为 FreeFilmCut 动画** converts position / scale / quaternion→euler tracks onto FreeFilmCut `.anim` targets keyed by object/`Bone` **uuid**. Morph targets are skipped.
- Preview uses the mixer (full skeletal). Convert + vfxpack uses FreeFilmCut transform tracks; pack scene-builder includes `kind: bone` nodes so OpenCut can apply bone UUIDs.
- While Blender preview is active, FreeFilmCut sampling is paused to avoid fighting transforms.
