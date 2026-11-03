from pathlib import Path

def check():
    exp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\VfxPackExporter.js").read_text(encoding="utf-8")
    # ensure no leftover old background string export
    assert "non-color background not exported in MVP" not in exp
    assert "serializeRenderSettings( editor )" in exp
    assert "serializeBackground( scene" in exp
    assert "serializeEnvironment( scene" in exp
    assert "schema: 'vfxpack/1.2'" in exp
    assert "schema: 'vfxpack-scene/1.1'" in exp
    # manifest uses renderSettings
    assert "render: renderSettings" in exp
    print("exporter OK")

    sb = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts").read_text(encoding="utf-8")
    assert "await applySceneRenderSettings({ root, sceneFile, loadTexture })" in sb
    assert "async function readPackText" in sb
    assert "EquirectangularReflectionMapping" in sb
    assert "new THREE.Fog" in sb
    assert "render: sceneFile.render" in sb
    print("scene-builder OK")

    lp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\load-pack.ts").read_text(encoding="utf-8")
    assert "isShader" in lp
    print("load-pack OK")

    comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts").read_text(encoding="utf-8")
    assert "built.render?.toneMapping" in comp
    assert "prevTone" in comp
    print("compositor OK")

    types = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\types.ts").read_text(encoding="utf-8")
    assert "VfxPackRenderSettings" in types
    assert "VfxSceneEnvironment" in types
    assert "VfxSceneFog" in types
    print("types OK")

    ed = Path(r"D:\GrokbotWork\FreeFilmCut\docs\vfxpack-editor.md").read_text(encoding="utf-8")
    assert "Tone Mapping" in ed or "tone mapping" in ed.lower()
    assert "vfxpack/1.2" in ed
    print("docs OK")

check()
print("ALL CHECKS PASSED")
