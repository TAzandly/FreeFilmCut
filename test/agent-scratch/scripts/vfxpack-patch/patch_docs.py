from pathlib import Path

DOC_EDITOR = Path(r"D:\GrokbotWork\FreeFilmCut\docs\vfxpack-editor.md")
DOC_NLE = Path(r"D:\GrokbotWork\FreeFilmCut\docs\vfxpack-nle-import.md")
DOC_ARCH = Path(r"D:\GrokbotWork\FreeFilmCut\docs\architecture.md")

editor = DOC_EDITOR.read_text(encoding="utf-8")
section = """

---

## Scene render settings export (v1.2)

Exporting `.vfxpack` now includes Project/Scene render-related settings and all custom shaders:

| Source | Written to | Fields |
|--------|------------|--------|
| Scene → Background | `scene.json.background` | `Color` / `Texture` / `Equirectangular` / `None`, plus blurriness / intensity / rotation; textures under `textures/` |
| Scene → Environment | `scene.json.environment` | Equirect env map path + intensity |
| Scene → Fog | `scene.json.fog` | `Fog` / `FogExp2` + color / near / far / density |
| Project → Renderer | `scene.json.render` and `manifest.render` | antialias, shadows, shadowType, **toneMapping**, toneMappingExposure, rendererType, cameraType |
| Material → ShaderMaterial | `shaders/mat_*.vert.glsl` + `.frag.glsl` | Every custom vertex/fragment in the scene; listed in `scene.json.assets.shaders`; placeholder only if none |

### What is Tone Mapping?

3D lighting / environment maps often produce **HDR** colors (values beyond 0–1). **Tone mapping** compresses that into displayable LDR and sets the filmic look:

- **No**: raw values (easy to blow out)
- **Linear**: linear scale
- **Reinhard / Cineon**: classic film curves
- **ACESFilmic / AgX / Neutral**: common cinematic operators (Editor often defaults to Neutral)

**Exposure** is a brightness multiplier before mapping. The NLE applies `render.toneMapping` / `toneMappingExposure` while drawing that pack, then restores the global renderer.

### Schema

`manifest.schema` = `vfxpack/1.2`, `scene.json.schema` = `vfxpack-scene/1.1`.
"""
if "vfxpack/1.2" not in editor:
    DOC_EDITOR.write_text(editor.rstrip() + section, encoding="utf-8")
    print("patched editor doc")
else:
    print("editor doc already has 1.2")

nle = DOC_NLE.read_text(encoding="utf-8")
nle_section = """

## Scene render settings (import)

When the NLE loads a `.vfxpack`:

- **background / environment / fog** → applied in `scene-builder.ts`
- **render.toneMapping / toneMappingExposure** → applied temporarily on WebGLRenderer while drawing that pack
- **custom shaders** → GLSL loaded from `shaders/*.glsl` (object URL or `files` map)

Older packs (color-only background, no `render`) still load with engine defaults.
"""
if "toneMapping" not in nle:
    DOC_NLE.write_text(nle.rstrip() + nle_section, encoding="utf-8")
    print("patched nle doc")
else:
    print("nle doc already patched")

arch = DOC_ARCH.read_text(encoding="utf-8")
if "toneMapping" not in arch:
    DOC_ARCH.write_text(
        arch.rstrip()
        + """

## VfxPack render settings

`.vfxpack` ≥ 1.2 carries Scene background / environment / fog and Project tone mapping; the NLE Three compositor applies them per pack. Custom ShaderMaterial GLSL is fully embedded under `shaders/`.
""",
        encoding="utf-8",
    )
    print("patched architecture")
else:
    print("architecture already mentions toneMapping")

print("docs done")
