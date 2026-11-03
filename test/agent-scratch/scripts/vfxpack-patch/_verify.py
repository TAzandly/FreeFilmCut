from pathlib import Path
text = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts").read_text(encoding="utf-8")
print("await applySceneRenderSettings", text.count("await applySceneRenderSettings"))
print("function applySceneRenderSettings", "async function applySceneRenderSettings" in text)
print("function readPackText", "async function readPackText" in text)
print("render: sceneFile.render", "render: sceneFile.render" in text)
print("toneMapping?: number in type", "toneMapping?: number" in text)
# show around AmbientLight
i = text.find("AmbientLight")
print(repr(text[i-200:i+80]))
# exporter checks
exp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\VfxPackExporter.js").read_text(encoding="utf-8")
print("exporter v1.2", "vfxpack/1.2" in exp)
print("exporter scene 1.1", "vfxpack-scene/1.1" in exp)
print("serializeBackground", "serializeBackground" in exp)
print("serializeEnvironment", "serializeEnvironment" in exp)
print("serializeRenderSettings", "serializeRenderSettings" in exp)
# compositor
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts").read_text(encoding="utf-8")
print("compositor tone", "built.render?.toneMapping" in comp)
# types
types = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\types.ts").read_text(encoding="utf-8")
print("types VfxPackRenderSettings", "VfxPackRenderSettings" in types)
print("types environment", "environment?: VfxSceneEnvironment" in types)
