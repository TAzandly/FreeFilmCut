# -*- coding: utf-8 -*-
from pathlib import Path

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
FRAG = ROOT / "scripts" / "vfxpack-patch"
EXPORTER = ROOT / "three.js" / "editor" / "js" / "VfxPackExporter.js"

def main():
    text = EXPORTER.read_text(encoding="utf-8")
    helpers = (FRAG / "helpers_fragment.js").read_text(encoding="utf-8")
    gather = (FRAG / "gather_block.js").read_text(encoding="utf-8")
    scene_block = (FRAG / "scene_json_block.js").read_text(encoding="utf-8")
    manifest_block = (FRAG / "manifest_block.js").read_text(encoding="utf-8")

    # Strip UTF-8 BOM from fragments if PowerShell added one
    for name, val in [("helpers", helpers), ("gather", gather), ("scene", scene_block), ("manifest", manifest_block)]:
        if val.startswith("\ufeff"):
            print("stripping BOM from", name)
    helpers = helpers.lstrip("\ufeff")
    gather = gather.lstrip("\ufeff")
    scene_block = scene_block.lstrip("\ufeff")
    manifest_block = manifest_block.lstrip("\ufeff")

    if "serializeRenderSettings" not in text:
        marker = "function mat4ToArray( m ) {"
        if marker not in text:
            raise SystemExit("mat4ToArray marker missing")
        text = text.replace(marker, helpers + "\n" + marker, 1)
        print("inserted helpers")
    else:
        print("helpers already present")

    if "scene.background && scene.background.isTexture" not in text:
        start = text.find("\t// First pass: gather all textures referenced by materials")
        if start < 0:
            raise SystemExit("gather start not found")
        end = text.find("\tconst textureRefs = new Map();", start)
        if end < 0:
            raise SystemExit("textureRefs not found")
        text = text[:start] + gather + "\n\n" + text[end:]
        print("patched texture gather")
    else:
        print("texture gather already patched")

    if "vfxpack-scene/1.1" not in text:
        start = text.find("\tconst sceneJson = {")
        if start < 0:
            raise SystemExit("sceneJson not found")
        end = text.find(
            "\t// Keep a documented placeholder only when the pack has no custom ShaderMaterials",
            start,
        )
        if end < 0:
            raise SystemExit("placeholder marker not found")
        text = text[:start] + scene_block + "\n" + text[end:]
        print("replaced sceneJson block")
    else:
        print("sceneJson already v1.1")

    if "vfxpack/1.2" not in text:
        start = text.find("\tconst manifest = {")
        if start < 0:
            raise SystemExit("manifest not found")
        end = text.find("\tpack.file( 'manifest.json'", start)
        if end < 0:
            raise SystemExit("pack.file manifest not found")
        text = text[:start] + manifest_block + "\n" + text[end:]
        print("replaced manifest block")
    else:
        print("manifest already v1.2")

    EXPORTER.write_text(text, encoding="utf-8")
    print("OK exporter", EXPORTER.stat().st_size)

if __name__ == "__main__":
    main()
