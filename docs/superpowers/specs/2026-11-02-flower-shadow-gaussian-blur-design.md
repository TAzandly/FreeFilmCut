# Flower shadow Gaussian blur falloff

## Goal

Flower **outer / inner shadow** soft edges should look closer to CapCut/Jianying: a smooth 0→1 exterior falloff, not Troika’s short `smoothstep(±blur)` band (solid core then hard cut).

## Approach

Replace Troika outline-blur edge alpha when `uTroikaBlurRadius > 0`:

```text
edgeOffset = uTroikaEdgeOffset + uFccStrokeExpand   // width dilate
d          = max(0, fragDistance - edgeOffset)      // outside the solid width
alpha      = 1 - smoothstep(0, blurRadius, d)       // 1 at width edge → 0 at width+diffuse
```

Opaque through **width**; soft 1→0 only across **diffuse**.  
(Troika’s default centers `smoothstep(±blur)` on the edge, so half the fade eats the solid core and the halo looks too transparent.)  
`blurRadius == 0` → original Troika AA `troikaGetEdgeAlpha`.

## Scope

- Editor: `three.js/editor/js/ui/UIText.js` Troika fragment (and outlineBounds) hooks  
- NLE: `freefilmcut/apps/web/src/vfxpack/scene-builder.ts` same hooks  
- Applies to any Troika mesh with `outlineBlur > 0` (flower shadows + legacy shadow)  
- No FlowerStyle schema / CapCut import unit changes; no RT post blur; no extra UI param (`k = 2.2` fixed for now)

## Bounds

Vertex `outlineBounds` pad uses `uTroikaBlurRadius + uFccStrokeExpand` (falloff ends at width+blur).

## Verification

1. Red outer-glow flower on white/black — soft long falloff, no hard ring  
2. Editor and timeline match  
3. `diffuse = 0` / strokes / face unchanged  
4. Larger `diffuse` → wider soft halo, same curve shape
