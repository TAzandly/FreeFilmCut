# VfxPack — FreeFilmCut NLE

## Types (manifest.type)

Canonical values from the Asset Editor:

| type | Panel | Drag (MVP) |
|------|-------|------------|
| `sticker` | Effects (grouped) + Stickers tab | Timeline / effect track only |
| `transition` | Effects + Transitions tab | Timeline / effect track only |
| `effect` | Effects | Drop on a visual clip **or** timeline effect track |
| `filter` | Effects | Drop on a visual clip **or** timeline effect track |
| `art-text` | Effects (grouped) | Timeline / effect track only |

Legacy types are normalized on import: `scene`/`animation` → `effect`, `post-effect` → `filter`, `text-style` → `art-text`.

Default scope when missing: `filter`/`effect` → `below`, others → `stack`.

## Import

1. Open http://localhost:3000
2. **Assets → Effects → Import VfxPack** (or drop a `.vfxpack`). Also available under **Transitions**.
3. Packs appear under type section headers (Stickers / Transitions / Effects / Filters / Art text).

## Add to timeline

- **filter / effect**: drag onto a video/image/text/sticker/graphic clip to attach, or onto empty timeline for an effect-track clip. **+** always inserts an effect-track clip.
- **sticker / art-text / transition**: drag onto the timeline (effect track). Clip-gap transitions are not implemented yet.

`effectType` remains `vfxpack:<packId>`. Three compositor still renders the pack scene in track/clip order.

## Notes

- Remove from the library with **Remove** (does not delete existing timeline clips).
- Built-in OpenCut effects stay listed under Effects below the VfxPack groups.

## Scene render settings (import)

When the NLE loads a `.vfxpack`:

- **background / environment / fog** → applied in `scene-builder.ts`
- **render.toneMapping / toneMappingExposure** → applied temporarily on WebGLRenderer while drawing that pack
- **custom shaders** → GLSL loaded from `shaders/*.glsl` (object URL or `files` map)

Older packs (color-only background, no `render`) still load with engine defaults.


## Below-track input binding

For imported packs with `type` **filter** or **effect** and `scope` **below**:

1. Author shaders may declare `uniform sampler2D uInput` (also `belowInput`, `iChannel0`).
2. At preview time, `three-compositor` snapshots the already-drawn stack and binds that texture to those uniforms before drawing the pack.
3. The pack's output **replaces** the content below it on the stack; clips/tracks above still composite normally.

If the shader never declares those samplers, the pack still draws as an overlay scene (no below texture).

