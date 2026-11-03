# Import CapCut / Jianying flower styles → FreeFilmCut art-text projects

## Goal

Batch-create FreeFilmCut **艺术字** editor projects from CapCut/Jianying Cache packs that ship declarative `effectStyle.json` (`fill` / `strokes` / `shadows` / `inner_shadows`). Skip AmazingFeature-only packs with no style JSON.

## Inputs

1. Cache root (e.g. `...\CapCut\User Data\Cache` or `...\JianyingPro\User Data\Cache`)
2. Output parent directory for projects
3. Optional: pack id filter, max count, overwrite flag

## Discovery

Scan recursively:

- `{cache}/effect/**/effectStyle.json`
- `{cache}/artistEffect/**/effectStyle.json`

**Skip** if file missing or JSON lacks a usable `fill` object (and no strokes/shadows).

Pack id = parent folder name two levels above the file (`effect/<id>/<hash>/effectStyle.json`).

## Mapping (align with editor FlowerStyle)

| CapCut | FreeFilmCut |
|--------|------------|
| `render_type` | `renderType` |
| float RGB / `gradient.color`+`percent`+`alpha` | hex / `colors`+`stops`+`alphas` via same rules as `FlowerStyle.js` |
| stroke `mode` 0/1 | `side` outer/inner |
| `shadow.strokes[]` | nested projection strokes |
| `inner_shadows` | `innerShadows` / stack `kind: "inner"` |
| texture `path` (basename) | copy → `assets/flower/<packId>/` + relative path in style |
| CapCut `background` | **unsupported (P1)** — report only |

**Defaults:** `fontSize = flowerBaseFontSize = 120`, canvas `resolution` **400×400**.

**Units** at that fontSize:

- stroke/nested `width` → `× 120` (`capcutStrokeWidthToFcc`)
- `diffuse` → `× 120` (`capcutDiffuseToFcc`)
- `distance` → `× (120/48)` (`capcutDistanceToFcc`; 48 = CapCut distance ref)

Emit `stack` (back→front): shadows → inners → outer strokes → face → inner strokes.

## Project scaffold

```
{out}/{SafeName}_{packId}/
  project.json
  assets/flower/<packId>/
  assets/{textures,fonts,shaders,videos,sequences,animations,meshes,audio,timelines}/
  exports/
  docs/import-report.json
```

`project.json`: minimal editor project — Scene → Canvas → Text with `fccUI.type==="text"` + `flowerStyle`; PerspectiveCamera; `project.vfxpack.type = "art-text"`; `backgroundType: Default`.

## Delivery

Project skill: `.cursor/skills/import-capcut-flower/`

- `SKILL.md` — agent workflow
- `scripts/import_effectstyle.py` — scan + convert + scaffold
- `reference.md` — field/unit notes

## Non-goals

- AmazingFeature lua/shader port
- CapCut text `background` bubble
- Opening the live editor UI to create projects
