from pathlib import Path
t = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js").read_text(encoding="utf-8")
i = t.find("outlineEnRow.setDisplay")
print(repr(t[i-200:i+350]))
print("---refresh calls---")
for i,line in enumerate(t.splitlines()):
    if "rebuildFlowerPanel" in line or "outlineEnRow.setDisplay" in line:
        print(i+1, line)
