# uInput = full canvas composite of tracks BELOW the pack

## Contract

When a .vfxpack (filter/effect, `scope: below`) declares:

```glsl
uniform sampler2D uInput;
```

the NLE binds **the full project-canvas framebuffer** (e.g. 1080x1920) containing
**every track strictly below this pack**, already blended (letterbox/opacity/order).

- Tracks **above** the pack are **not** included.
- Opaque letterboxed video over a portrait jpg must appear in `uInput` as that
  same composite (jpg visible in the letterbox bars), not as the raw video texture alone.
- Mesh UV `texture2D(uInput, vUv)` maps that full canvas onto the mesh.

## Implementation (Three compositor)

1. Draw media layers bottom→top into `accumRT`.
2. After each media layer, `copyTextureToTexture(accum → belowSourceRT)`.
3. When a below-input pack is reached, snapshot `belowSourceRT` and bind to `uInput`.
4. Render pack (backdrop = same below composite + pack scene) back into `accum`.
5. Continue with tracks above.

DevTools logs: `[FreeFilmCut compose]` item order, `[FreeFilmCut uInput]` top/mid/bot samples.

## Editor preview stand-in

The Three.js **Editor** cannot see the NLE below-composite. Use **Material → Shader Uniforms → uInput preview (Editor only)** to pick a local image for authoring/bloom. Stored in material.userData.editorPreviewInputs; stripped from production below binding on .vfxpack export. OpenCut runtime is unchanged.

## Snapshot implementation note (OpenCut)

`snapshotBelowSource` copies the current `accumRT` framebuffer into a
`FramebufferTexture` via `renderer.copyFramebufferToTexture` (not a custom
blit from `accumRT.texture`). That texture is bound to `uInput` / aliases each
frame. Post-process (`EffectComposer`) re-binds the same texture immediately
before `composer.render()` so Bloom/OutputPass cannot leave a white/null placeholder.

## CommonShader / `map` vs `uInput`

Editor default ShaderMaterial historically sampled `map`. OpenCut still binds the
below composite to `uInput` (and aliases). For packs that sample `map` with
`useMap === false`, the compositor **also** assigns the below texture to `map`
so those assets show the video without a re-export.

New Editor defaults sample `uInput` first (optional `map` multiply). Re-export
packs after Editor refresh (`?v=fcc-pp-uinput-1`) for the corrected GLSL.

## Related: global screen uniforms

See [global-screen-params.md](./global-screen-params.md) for `uResolution` / `uScreenParams`.
