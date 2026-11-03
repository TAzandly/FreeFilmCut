# FreeFilmCut Shader uniforms — flexible Material sidebar

## What you get

For **ShaderMaterial** / **RawShaderMaterial**, the Material panel shows a **Shader Uniforms** section that auto-builds controls for **any** custom uniform declared in **Program → Info** (and present on `material.uniforms`):

| Uniform value / name | Control |
|----------------------|---------|
| `THREE.Color` or name like `color`, `color2`, `baseColor`, `tint` | Color picker |
| `THREE.Texture` / `null` with name like `map`, `map2`, `diffuseMap`, `tex` | Map checkbox + texture slot |
| `number` (e.g. `uTime`, `strength`) | Number field |
| `boolean` (e.g. `useMap`) | Checkbox |
| `Vector2` / `Vector3` / `Vector4` (non-color names) | Component number fields |

Built-in rows still handle **`color`**, **`map`**, **`opacity`** (bridged). Everything else (`color2`, `map2`, …) appears under **Shader Uniforms**.

## Naming convention

Declare the same names in GLSL **and** in Info `uniforms`:

```glsl
uniform vec3 color;      // built-in Color row
uniform vec3 color2;     // Shader Uniforms → color picker
uniform vec3 color3;     // same
uniform sampler2D map;   // built-in Map row
uniform sampler2D map2;  // Shader Uniforms → map slot
uniform float uTime;     // number
uniform bool useMap;     // checkbox
```

```json
{
  "defines": {},
  "uniforms": {
    "map": { "value": null },
    "map2": { "value": null },
    "color": { "value": [1, 0, 0] },
    "color2": { "value": [0, 0, 1] },
    "color3": { "value": [0, 1, 0] },
    "opacity": { "value": 1 },
    "uTime": { "value": 0 },
    "useMap": { "value": false }
  }
}
```

Color values in Info: prefer **`[r,g,b]` in 0–1**. Hex ints still coerce for `*color*` names.

### Name heuristics

- **Color**: name is `color`, starts/ends with `color`, or contains `tint` / `albedo`
- **Map**: name is `map`, starts/ends with `map`, or contains `tex` / `texture` / `sampler` / common PBR map tokens

If a `null` uniform should be a texture slot, use a map-like name (`map2`, `noiseTex`, …).

## Workflow

1. Select mesh → Material type **ShaderMaterial**
2. **Program → Frag / Vert**: declare uniforms
3. **Program → Info**: add matching `uniforms` entries → save
4. Sidebar **Shader Uniforms** lists `color2`, `map2`, … — edit without reopening Info
5. Export VfxPack as usual (shaders + uniform values go with the material)

## Source

| File | Role |
|------|------|
| `editor/js/Sidebar.Material.ShaderUniforms.js` | Dynamic UI |
| `editor/js/commands/SetMaterialUniformCommand.js` | Undoable uniform edits |
| `editor/js/FreeCapCutShaders.js` | Coercion + name heuristics + bridge for `color`/`map`/`opacity` |
| `editor/js/Sidebar.Material.js` | Mounts the Shader Uniforms panel |

New default ShaderMaterials still ship with `color` + `color2` (red→blue) so you see both the built-in Color row and a `color2` picker immediately.


## Below-track input (`uInput`)

For **filter / effect** packs with `scope: below`, declare a sampler that the NLE fills with the composite of everything under this timeline item:

```glsl
uniform sampler2D uInput;      // preferred
// uniform sampler2D belowInput;
// uniform sampler2D iChannel0;
```

```json
"uInput": { "value": null }
```

The Material panel shows a blue hint when any of these names are present. Do not assign an editor Map to `uInput` for timeline use — the NLE overwrites it each frame. Use a separate `map` / `map2` for authored textures.




### Editor-only local preview (FreeFilmCut)

In the **Material → Shader Uniforms** panel, when `uInput` / `belowInput` / `iChannel0` is declared, an **「uInput 预览（仅 Editor）」 / uInput preview (Editor only)** box appears:

1. Click **选择图片… / Pick image…** and choose a local jpg/png/webp.
2. The texture is assigned to `material.uniforms.uInput` (and any alias present) so bloom / shaders can sample bright areas while authoring.
3. **Clear** removes the preview.
4. Persisted on `material.userData.editorPreviewInputs.uInput` as `{ fileName, dataUrl, editorOnly: true }` for Editor autosave restore.

**Export safety:** `VfxPackExporter` never packs this preview as the production below source. Below-input uniforms are exported as `{ type: 't', value: null, binding: 'accumBelow' }`. OpenCut three-compositor still binds the real below-track composite each frame and overwrites these uniforms.