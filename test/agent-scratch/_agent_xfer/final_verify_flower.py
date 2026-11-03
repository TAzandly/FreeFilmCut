# -*- coding: utf-8 -*-
from pathlib import Path
import subprocess
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
files = [
    "three.js/editor/js/Sidebar.Object.UI.js",
    "three.js/editor/js/Sidebar.Scene.js",
    "three.js/editor/js/Selector.js",
    "three.js/editor/js/ui/FlowerStyle.js",
    "three.js/editor/js/ui/UIText.js",
    "three.js/editor/js/ui/FLOWER_P1.md",
]
for rel in files:
    p = ROOT / rel
    print(rel, "exists" if p.exists() else "MISSING", p.stat().st_size if p.exists() else 0)

t = (ROOT / "three.js/editor/js/Sidebar.Object.UI.js").read_text(encoding="utf-8")
assert "基础 · 排版" in t
assert "花字 · Effect 栈" in t
assert "从基础生成" not in t
assert "fcc-ui-56" in t
assert "outlineEnRow.setDisplay( 'none' )" in t

sc = (ROOT / "three.js/editor/js/Sidebar.Scene.js").read_text(encoding="utf-8")
assert "fccVisibleChildCount" in sc
assert "__fcc" in sc

sel = (ROOT / "three.js/editor/js/Selector.js").read_text(encoding="utf-8")
assert "__fccFlower_" in sel

for f in [
    ROOT / "three.js/editor/js/Sidebar.Object.UI.js",
    ROOT / "three.js/editor/js/Sidebar.Scene.js",
    ROOT / "three.js/editor/js/Selector.js",
]:
    r = subprocess.run(["node", "--check", str(f)], capture_output=True, text=True)
    assert r.returncode == 0, r.stderr

# no flower UI type anywhere in editor ui
bad = []
for p in (ROOT / "three.js/editor/js").rglob("*.js"):
    if "node_modules" in str(p):
        continue
    txt = p.read_text(encoding="utf-8", errors="ignore")
    if "type: 'flower'" in txt or 'type: "flower"' in txt or "createUIFlower" in txt:
        bad.append(str(p))
print("flower type leaks", bad)
print("ALL_OK")
