from pathlib import Path
t = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js").read_text(encoding="utf-8")
# order checks
print("flowerBlock", t.find("const flowerBlock"))
print("rebuildFlowerPanel fn", t.find("function rebuildFlowerPanel"))
print("commitText", t.find("function commitText"))
print("legacy hide", t.find("outlineEnRow.setDisplay"))
# ensure no duplicate commitText
print("commitText count", t.count("function commitText"))
# UIText: ensure syncUITextContent doesn't reference FCC_TEXT_MESH for early return wrongly
u = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIText.js").read_text(encoding="utf-8")
# early return should check FCC_FLOWER_FACE
i = u.find("export function syncUITextContent")
print(u[i:i+600])
