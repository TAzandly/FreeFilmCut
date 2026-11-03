from pathlib import Path
path = Path(r"freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts")
text = path.read_text(encoding="utf-8")

old = """\t\tconst previewScale = this.flowerTextPreviewScale(resW, width);
\t\tconst rtW = Math.max(1, Math.round(resW * previewScale));
\t\tconst rtH = Math.max(1, Math.round(resH * previewScale));
"""
new = """\t\tconst previewScale = this.flowerTextPreviewScale(resW, width);
"""
if old not in text:
    raise SystemExit("rtW block missing")
text = text.replace(old, new, 1)

old2 = """\t\t\tconst ppRT = this.ensureTextLayerTarget(
\t\t\t\tMath.max(1, Math.round(rtRect.w)),
\t\t\t\tMath.max(1, Math.round(rtRect.h)),
\t\t\t\t{ fit: true },
\t\t\t);
"""
new2 = """\t\t\tconst ppRT = this.ensureTextLayerTarget(
\t\t\t\tMath.max(1, Math.round(rtRect.w)),
\t\t\t\tMath.max(1, Math.round(rtRect.h)),
\t\t\t\t{ fit: true },
\t\t\t);
\t\t\t// Composer signature uses actual RT size (hysteresis), not breathing AABB.
\t\t\tconst ppW = ppRT.width;
\t\t\tconst ppH = ppRT.height;
"""
if old2 not in text:
    raise SystemExit("ppRT block missing")
text = text.replace(old2, new2, 1)

old3 = """\t\t\t\t\twidth: Math.max(1, Math.round(rtRect.w)),
\t\t\t\t\theight: Math.max(1, Math.round(rtRect.h)),
\t\t\t\t\ttarget: ppRT,
"""
new3 = """\t\t\t\t\twidth: Math.max(1, ppW),
\t\t\t\t\theight: Math.max(1, ppH),
\t\t\t\t\ttarget: ppRT,
"""
if old3 not in text:
    raise SystemExit("width/height call missing")
text = text.replace(old3, new3, 1)

path.write_text(text, encoding="utf-8")
print("compositor cleanup ok")
