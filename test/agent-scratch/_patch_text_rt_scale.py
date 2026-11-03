from pathlib import Path

p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = p.read_text(encoding="utf-8")

old_ss = """\t/** Authored project pixels only (no supersample-as-contentScale). */
\tprivate flowerTextSupersample(_authoredW: number, _authoredH: number): number {
\t\treturn 1;
\t}
"""

new_ss = """\t/**
\t * Preview quality scale for text RT: compose buffer / authored canvas.
\t * Layout + fontSize stay in authored pixels; RT undersamples into fewer pixels.
\t * Export / Full Quality => 1.
\t */
\tprivate flowerTextPreviewScale(authoredW: number, composeW: number): number {
\t\tconst a = Math.max(1, authoredW);
\t\tconst c = Math.max(1, composeW);
\t\tconst s = c / a;
\t\tif (!Number.isFinite(s) || s <= 0) return 1;
\t\treturn Math.min(1, s);
\t}
"""

if old_ss not in text:
    raise SystemExit("flowerTextSupersample block not found")
text = text.replace(old_ss, new_ss, 1)

old_rt = """\t\t// Authored project pixels \u2014 FlowerStyle / fontSize stay here regardless of preview quality.
\t\tconst resW = Math.max(1, Math.round(props.canvasWidth));
\t\tconst resH = Math.max(1, Math.round(props.canvasHeight));
\t\t// SS from authored size; also peek compose buffer so Medium Quality keeps stroke AA.
\t\tconst ss = this.flowerTextSupersample(resW, resH);
\t\tvoid width;
\t\tvoid height;
\t\tconst rtW = Math.max(1, Math.round(resW * ss));
\t\tconst rtH = Math.max(1, Math.round(resH * ss));
"""

# file may use different dash character - try flexible
import re
pat = re.compile(
    r"\t\t// Authored project pixels.*?const rtH = Math\.max\(1, Math\.round\(resH \* ss\);\n",
    re.S,
)
m = pat.search(text)
if not m:
    # show nearby
    idx = text.find("const resW = Math.max(1, Math.round(props.canvasWidth))")
    print(repr(text[idx - 120 : idx + 350]))
    raise SystemExit("rt block not found")

new_rt = """\t\t// Authored project pixels — FlowerStyle / fontSize stay here (not scaled by preview quality).
\t\tconst resW = Math.max(1, Math.round(props.canvasWidth));
\t\tconst resH = Math.max(1, Math.round(props.canvasHeight));
\t\t// Compose buffer is already quality-scaled (CanvasRenderer contentScale). Undersample
\t\tthe text RT to that size so preview quality actually saves fill-rate / PP cost.
\t\tconst previewScale = this.flowerTextPreviewScale(resW, width);
\t\tconst rtW = Math.max(1, Math.round(resW * previewScale));
\t\tconst rtH = Math.max(1, Math.round(resH * previewScale));
"""

text = pat.sub(new_rt, text, count=1)

# PP path: composer should run at rt size, not authored
old_pp = """\t\t\t\tconst ortho = this.ensureFlowerPpOrtho(resW, resH);
\t\t\t\tthis.renderPackWithPostProcess({
\t\t\t\t\tpackId: packId + ":textanim-pp",
\t\t\t\t\tbuilt: {
\t\t\t\t\t\t...built,
\t\t\t\t\t\tpostProcess: packPpStack,
\t\t\t\t\t\tresolution: { width: resW, height: resH },
\t\t\t\t\t\tcamera: ortho,
\t\t\t\t\t},
\t\t\t\t\twidth: Math.max(1, resW),
\t\t\t\t\theight: Math.max(1, resH),
\t\t\t\t\ttarget: ppRT,
"""

new_pp = """\t\t\t\tconst ortho = this.ensureFlowerPpOrtho(resW, resH);
\t\t\t\tthis.renderPackWithPostProcess({
\t\t\t\t\tpackId: packId + ":textanim-pp",
\t\t\t\t\tbuilt: {
\t\t\t\t\t\t...built,
\t\t\t\t\t\tpostProcess: packPpStack,
\t\t\t\t\t\tresolution: { width: rtW, height: rtH },
\t\t\t\t\t\tcamera: ortho,
\t\t\t\t\t},
\t\t\t\t\twidth: Math.max(1, rtW),
\t\t\t\t\theight: Math.max(1, rtH),
\t\t\t\t\ttarget: ppRT,
"""

if old_pp not in text:
    raise SystemExit("PP block not found")
text = text.replace(old_pp, new_pp, 1)

with open(p, "w", encoding="utf-8", newline="\n") as f:
    f.write(text)

# verify
t2 = p.read_text(encoding="utf-8")
assert "flowerTextPreviewScale" in t2
assert "flowerTextSupersample" not in t2
assert "width: Math.max(1, rtW)" in t2
assert "void width" not in t2 or t2.count("void width") == 0
print("patched ok")
# show the new blocks
for needle in ["flowerTextPreviewScale", "previewScale", "width: Math.max(1, rtW)"]:
    i = t2.find(needle)
    print("---", needle, "---")
    print(t2[i - 80 : i + 200])
