# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")

# ---------- text-layer-rt.ts ----------
p = ROOT / "freefilmcut/apps/web/src/vfxpack/text-layer-rt.ts"
t = p.read_text(encoding="utf-8")
t = t.replace(
    'import { shouldReuseTextLayerRtSize } from "@/vfxpack/text-layer-aabb";\n',
    "",
)
t = t.replace(
    """export type TextLayerRTSpec = {
\t/** Keep true: flower inner shadow / face stencil need a stencil buffer. */
\tstencilBuffer?: boolean;
\tdepthBuffer?: boolean;
\t/**
\t * When true, keep an existing RT if it already covers (w,h) and is not much
\t * larger (hysteresis). Avoids per-frame realloc as AABB breathes with anim.
\t */
\tfit?: boolean;
};

const DEFAULT_SPEC: Required<TextLayerRTSpec> = {
\tstencilBuffer: true,
\tdepthBuffer: true,
};
""",
    """export type TextLayerRTSpec = {
\t/** Keep true: flower inner shadow / face stencil need a stencil buffer. */
\tstencilBuffer?: boolean;
\tdepthBuffer?: boolean;
};

const DEFAULT_SPEC: Required<TextLayerRTSpec> = {
\tstencilBuffer: true,
\tdepthBuffer: true,
};
""",
)
t = t.replace(
    """\tconst w = Math.max(1, Math.round(width));
\tconst h = Math.max(1, Math.round(height));
\tconst fit = !!spec.fit;
\tif (prev && prev.texture.type === THREE.HalfFloatType) {
\t\tif (!fit && prev.width === w && prev.height === h) return prev;
\t\tif (fit && shouldReuseTextLayerRtSize(prev.width, prev.height, w, h)) return prev;
\t}
\tprev?.dispose();
\treturn createTextLayerRenderTarget(w, h, spec);
}
""",
    """\tconst w = Math.max(1, Math.round(width));
\tconst h = Math.max(1, Math.round(height));
\tif (
\t\tprev &&
\t\tprev.texture.type === THREE.HalfFloatType &&
\t\tprev.width === w &&
\t\tprev.height === h
\t) {
\t\treturn prev;
\t}
\tprev?.dispose();
\treturn createTextLayerRenderTarget(w, h, spec);
}
""",
)
# Keep viewRect optional but document as unused by clip (full-frame)
t = t.replace(
    """\t/** Optional tight frustum in project pixels (bottom-left origin). */
\tviewRect?: { x: number; y: number; w: number; h: number } | null;
""",
    """\t/** Optional frustum crop in project pixels (bottom-left). Unused: clip uses full-frame RT. */
\tviewRect?: { x: number; y: number; w: number; h: number } | null;
""",
)
p.write_text(t, encoding="utf-8")
print("OK text-layer-rt.ts", "aabb" in t, "fit" in t)

# ---------- ui-overlay.ts ----------
u = ROOT / "freefilmcut/apps/web/src/vfxpack/ui-overlay.ts"
ut = u.read_text(encoding="utf-8")
ut = ut.replace(
    """\t/** Tight frustum in project pixels (bottom-left origin). Layout still uses full res. */
\tviewRect?: { x: number; y: number; w: number; h: number } | null;
""",
    """\t/** Optional frustum crop (bottom-left). Clip path uses full project frustum. */
\tviewRect?: { x: number; y: number; w: number; h: number } | null;
""",
)
u.write_text(ut, encoding="utf-8")
print("OK ui-overlay.ts")

# ---------- TextLayerRT.js ----------
e = ROOT / "three.js/editor/js/ui/TextLayerRT.js"
et = e.read_text(encoding="utf-8")
et = et.replace(
    "import { shouldReuseTextLayerRtSize } from './TextLayerAabb.js?v=fcc-ui-164';\n",
    "",
)
et = et.replace(
    """export function ensureTextLayerRenderTarget( width, height, opts ) {

\tconst w = Math.max( 1, Math.round( width ) );
\tconst h = Math.max( 1, Math.round( height ) );
\tconst fit = !!( opts && opts.fit );
\tif ( pooledTarget && pooledTarget.texture.type === THREE.HalfFloatType ) {

\t\tif ( ! fit && pooledTarget.width === w && pooledTarget.height === h ) return pooledTarget;
\t\tif ( fit && shouldReuseTextLayerRtSize( pooledTarget.width, pooledTarget.height, w, h ) ) return pooledTarget;

\t}
""",
    """export function ensureTextLayerRenderTarget( width, height, opts ) {

\tconst w = Math.max( 1, Math.round( width ) );
\tconst h = Math.max( 1, Math.round( height ) );
\tif ( pooledTarget && pooledTarget.texture.type === THREE.HalfFloatType ) {

\t\tif ( pooledTarget.width === w && pooledTarget.height === h ) return pooledTarget;

\t}
""",
)
et = et.replace(
    """\t// Editor overlay TextFx still full project RT (SS-camera PP is scene-wide).
\t// Tight AABB path is landed on OpenCut clip first; see TextLayerAabb.js.
""",
    """\t// Full project RT (tight AABB path reverted on clip; keep parity).
""",
)
e.write_text(et, encoding="utf-8")
print("OK TextLayerRT.js", "TextLayerAabb" in et, "fit" in et)

# Bump Viewport import cache
vp = ROOT / "three.js/editor/js/Viewport.js"
vt = vp.read_text(encoding="utf-8")
vt2 = vt.replace("TextLayerRT.js?v=fcc-ui-164", "TextLayerRT.js?v=fcc-ui-165")
if vt2 == vt:
    print("WARN: Viewport TextLayerRT cache bump not found")
else:
    vp.write_text(vt2, encoding="utf-8")
    print("OK Viewport.js cache bump fcc-ui-165")

# ---------- docs §12 ----------
d = ROOT / "docs/textanim-progress-2026-10.md"
dt = d.read_text(encoding="utf-8")
old12 = """## 12. Tight text-layer RT (AABB + bloom pad) — 2026-10-23

**Decision:** Do **not** use a fixed 400×200 (or any fixed) text RT. Size from **dynamic ink AABB + bloom-aware pad**, dirty-update on layout/style/bloom/radius/design-res/preview-scale — not every opacity tick.

**Pad formula (project / authored pixels):**
- Base AA pad ≈ 8px (even when bloom strength≈0).
- Plus Troika/bend fraction pad (~6% of ink max-side) inside measure.
- Plus flower stroke/shadow extra from style.
- **Bloom (UnrealBloomPass):** `radius` is a **0..1 mip-weight lerp**, not pixels. Pad uses mip-kernel reaches ≈ `[12, 40, 112, 288, 704]` project-px at 1:1 PP density, mixed by radius, scaled by strength (`sMul ≈ 0.75 + 1.25·s`), then `max(·, 64, 0.08·canvasMax, min(0.22·canvasMax, 0.45·inkMax·…))`, clamp ≤ `0.48·canvasMax`. Fixes hard RT seams when authored radius is tiny (e.g. sweep `0.01`) but wipe/HDR still grows a wide soft skirt.
- DeepGlow: `max(radius*64+32, 48·min(2, intensity+0.35), 0.06·canvasMax)`.
- Result clamped to canvas. Large halo naturally expands toward full-canvas (same cost as today).

**2026-10-23 pad fix:** previous `radius * 0.55 * inkMax` under-padded because UnrealBloom `radius` is not a pixel radius; halo hard-clipped at tight RT edges on clip. Formula now mip-reach based (shared with editor `TextLayerAabb.js`).

**Clip (OpenCut) — landed:**
- Helper: freefilmcut/apps/web/src/vfxpack/text-layer-aabb.ts
- \three-compositor.renderOneFlowerText: resolve padded rect → tight HalfFloat RT (\fit hysteresis) → overlay frustum or PP setViewOffset → \blitTextureToTarget({ destRect }).
- PP path keeps **1:1 authored density** on the tight FBO (bloom texel ≈ project px). Overlay path still undersamples by preview quality.
- Composer signature uses **actual RT size** after hysteresis so AABB breathing does not rebuild EffectComposer every frame.

**Editor:** pad helper mirrored in \three.js/editor/js/ui/TextLayerAabb.js + ensureTextLayerRenderTarget(..., {fit}). Overlay TextFx / SS-camera scene PP still full project RT for now (scene-wide composer). Clip path is the perf-critical one.

**Verify:**
1. Hard-refresh clip; scrub a small sweep text with Bloom — no hard halo seams at RT edge.
2. Change font size — RT grows/shrinks (check via __renderPerf / WebGL memory if needed); no per-frame realloc while only opacity/char pose stays inside pad.
3. Compare bloom size vs editor for the same pack radius (should stay close; large radius may still near-full canvas).
"""

# File may have mojibake for emdash etc — match by heading and replace until next ## or EOF
m = re.search(r"## 12\. Tight text-layer RT.*?(?=\n## |\Z)", dt, flags=re.DOTALL)
if not m:
    raise SystemExit("FAILED: docs §12 not found")
new12 = """## 12. Text-layer RT sizing — **reverted to project size** (2026-10-23)

**Decision (final):** Use **full project / engineering resolution** text RT (with existing preview `contentScale` / `flowerTextPreviewScale` on the overlay path). Do **not** use tight AABB + bloom-pad RTs, and do **not** use a fixed 400×200.

**Why revert:** Tight AABB caused more problems than it saved (Bloom hard seams vs pad under-estimate, viewport/scissor leaks affecting other clips, per-frame measure / RT resize cost, destRect / setViewOffset complexity). User asked to roll back to the stable full-frame path.

**Current contract:**
- Clip PP path: HalfFloat text RT = authored `resW×resH` (1:1 bloom density).
- Clip overlay path (no pack PP): full-frame RT undersampled by preview quality scale.
- Full-frame blit (no `destRect` tight blit, no `setViewOffset` crop).
- Editor TextFx / SS-camera: full project RT (unchanged).
- Helper files `text-layer-aabb.ts` / `TextLayerAabb.js` may remain on disk unused.

**Kept (unrelated fixes):** EffectComposer signature without per-frame Bloom params; viewport/scissor restore after text/PP; none + LinearSRGB OutputPass / LDR pre-bloom clamp; timecode DOM write.

**Verify:** hard-refresh clip; text + Bloom plays full-frame; video/other clips unaffected.
"""
dt = dt[: m.start()] + new12 + dt[m.end() :]
d.write_text(dt, encoding="utf-8")
print("OK docs §12")
