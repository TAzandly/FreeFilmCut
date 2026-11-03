# 可关键帧参数（Exposed Params）约定

在　资源编辑器　里勾选「剪辑端」的参数，会写入 `.vfxpack` 的 `exposedParams`，并在 OpenCut 剪辑端属性面板中显示，支持数值调节与关键帧。

## Rules / 规则

| Checkbox | Meaning |
|----------|---------|
| Checked (剪辑端) | Export to `manifest.exposedParams`; show in OpenCut; live override + keyframes |
| Unchecked | Editor-only; baked at export value; hidden in OpenCut |

Applies to:

1. Camera **post-process** numeric/boolean params (Bloom / Film / Invert / ...)
2. **ShaderMaterial** editable uniforms (float / bool / color-like)

## Schema

```json
"exposedParams": [
  {
    "id": "pp.<effectId>.intensity",
    "scope": "postProcess",
    "effectId": "a1b2c3...",
    "effectType": "invert",
    "key": "intensity",
    "label": "融合强度",
    "type": "float",
    "min": 0,
    "max": 1,
    "step": 0.01,
    "default": 1
  },
  {
    "id": "mat.<materialUuid>.uStrength",
    "scope": "material",
    "materialUuid": "...",
    "uniform": "uStrength",
    "label": "uStrength",
    "type": "float",
    "default": 1
  }
]
```

- `id`: OpenCut `element.params[id]` / animation path
- Persist: `camera.userData.postProcessStack.effects[].exposed` and `material.userData.exposedUniforms`
- Also mirrored into `manifest.params` for the property list

## Editor steps

1. Select **PerspectiveCamera** -> Post Process -> check **剪辑端** next to a param
2. Select Mesh -> Material -> Shader Uniforms -> check **剪辑端**
3. File -> Export -> VfxPack (`schema` vfxpack/1.3)

## OpenCut steps

1. Assets -> Effects -> Import VfxPack
2. Drop onto effect track (or attach filter/effect to a clip)
3. Select clip -> Properties -> Effects: exposed params appear; scrub playhead and toggle keyframe diamond

## Runtime

`three-compositor` when drawing the pack:

1. Apply camera `postProcess` stack (bloom / film / invert / fxaa)
2. Override exposed post-process params + material uniforms from clip `params`
3. Unexposed params keep exported defaults

Cache bust: `?v=fcc-exposed-1`
