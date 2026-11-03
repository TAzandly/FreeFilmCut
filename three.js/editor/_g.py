from pathlib import Path
path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIText.js")
text = path.read_text(encoding="utf-8")

old = """\tderived.userData.fccGradientMat = true;
\tderived.userData.fccGradUv = true;
\tderived.userData.fccGradientUniforms = uniforms;
\tderived.transparent = true;
\tderived.depthWrite = false;
\tderived.toneMapped = false;
\tderived.depthTest = mode === RENDER_MODE_CAMERA;
\t// Critical: Text.material setter only keeps a custom mat if isTroikaTextMaterial."""

# Find exact text after bump - may have tabs
idx = text.find("derived.userData.fccGradientMat = true")
print("idx", idx)
print(repr(text[idx:idx+550]))
