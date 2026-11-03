from pathlib import Path
for p in [
 Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIText.js"),
 Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\FlowerStyle.js"),
 Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js"),
]:
 t=p.read_text(encoding="utf-8")
 print(p.name, "brace", t.count("{")-t.count("}"), "paren", t.count("(")-t.count(")"), "lines", t.count("\n")+1)
# check UIText for disposeFlowerChildren before use and definition
t=Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIText.js").read_text(encoding="utf-8")
print("disposeFlower def", t.find("function disposeFlowerChildren"))
print("first use", t.find("disposeFlowerChildren"))
print("createDerivedMaterial import", "createDerivedMaterial" in t.split("export")[0])
# Check scene-builder unused import FlowerStyle type is used
sb=Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\scene-builder.ts").read_text(encoding="utf-8")
print("FlowerStyle type used", "FlowerStyle" in sb)
print("REV", [l for l in sb.splitlines() if "PACK_SCENE_BUILD_REV =" in l][:1])
