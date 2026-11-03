# -*- coding: utf-8 -*-
from pathlib import Path
import re
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
t = (ROOT / "three.js/editor/js/Sidebar.Object.UI.js").read_text(encoding="utf-8")
checks = [
    "从基础生成", "已启用", "基础 · 排版", "花字 · Effect 栈",
    "重置特效", "仅排版", "不是单独物体", "Legacy single outline",
    "fcc-ui-56", "fcc-ui-55",
]
for c in checks:
    print(("YES" if c in t else "no "), c)

for rel in [
    "three.js/editor/js/Menubar.Add.js",
    "three.js/editor/js/ui/UIFactory.js",
    "three.js/editor/js/ui/UIConstants.js",
]:
    tt = (ROOT / rel).read_text(encoding="utf-8")
    bad = re.findall(r"type:\s*['\"]flower['\"]|createUIFlower|type === 'flower'", tt)
    print(rel, "bad=", bad)

sc = (ROOT / "three.js/editor/js/Sidebar.Scene.js").read_text(encoding="utf-8")
print("outliner skip", "__fcc" in sc and "Ephemeral UGUI" in sc)
sel = (ROOT / "three.js/editor/js/Selector.js").read_text(encoding="utf-8")
print("selector flower", "__fccFlower_" in sel)
# Menubar UI options
m = (ROOT / "three.js/editor/js/Menubar.Add.js").read_text(encoding="utf-8")
print("menubar has createUIText", "createUIText" in m)
print("menubar flower menu", "花字" in m or "Flower" in m and "createUI" in m)
# index cache
idx = (ROOT / "three.js/editor/index.html").read_text(encoding="utf-8")
print("index fcc-ui-56", "fcc-ui-56" in idx)
print("index leftover 55", "fcc-ui-55" in idx)
