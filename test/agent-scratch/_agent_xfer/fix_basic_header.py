# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
t = p.read_text(encoding="utf-8")
i = t.find("textRow = new UIRow()")
print("idx", i)
print(repr(t[i-150:i+200]))
needle = "\tconst textRow = new UIRow();\n\ttextRow.add( new UIText( '文本' )"
print("needle found", needle in t)
# try variants
for n in [
    "\tconst textRow = new UIRow();\n\ttextRow.add( new UIText( '文本' )",
    "const textRow = new UIRow();\r\n\ttextRow.add( new UIText( '文本' )",
]:
    print("var", repr(n[:40]), n in t)
