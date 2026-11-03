from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
t = p.read_text(encoding="utf-8")
old = """\t\tif (outputToneMapping === THREE.NoToneMapping) {
\t\t\trendererArg.outputColorSpace = THREE.NoColorSpace;
\t\t}
"""
new = """\t\tif (outputToneMapping === THREE.NoToneMapping) {
\t\t\t// LinearSRGB: no sRGB OETF in OutputPass, and safe for renderer
\t\t\t// outputColorSpace setter (NoColorSpace is not in ColorManagement.spaces).
\t\t\trendererArg.outputColorSpace = THREE.LinearSRGBColorSpace;
\t\t}
"""
if old not in t:
    raise SystemExit("NoColorSpace block not found")
t = t.replace(old, new)
# also fix header comment if it says NoColorSpace for this
t = t.replace(
    "must NOT apply sRGB transfer or strength=0 PP reads brighter than overlay.",
    "must NOT apply sRGB transfer (use LinearSRGBColorSpace for OutputPass) or strength=0 PP reads brighter than overlay.",
)
p.write_text(t, encoding="utf-8")
print("switched to LinearSRGBColorSpace")
print("count LinearSRGB in wrap", p.read_text(encoding="utf-8").count("LinearSRGBColorSpace"))
