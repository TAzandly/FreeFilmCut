from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\VfxPackExporter.js")
text = p.read_text(encoding="utf-8")
print("has serializeRenderSettings", "serializeRenderSettings" in text)
print("has vfxpack 1.2", "vfxpack/1.2" in text)
print("has bg texture gather", "scene.background && scene.background.isTexture" in text)
print("len", len(text))
i = text.find("const sceneJson")
print(repr(text[i:i+400]))
