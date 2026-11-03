# -*- coding: utf-8 -*-
from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
t = p.read_text(encoding="utf-8")
if "基础 · 排版" in t:
    print("already present")
else:
    needle = "\tconst textRow = new UIRow().setMarginTop( '6px' );\n\ttextRow.add( new UIText( '文本' )"
    if needle not in t:
        raise SystemExit("needle still missing")
    insert = (
        "\tconst basicHeader = new UIRow().setMarginTop( '6px' );\n"
        "\tbasicHeader.add( new UIText( '基础 · 排版' ).setFontWeight( 'bold' ) );\n"
        "\ttextBlock.add( basicHeader );\n\n"
        "\tconst textRow = new UIRow();\n\ttextRow.add( new UIText( '文本' )"
    )
    t = t.replace(needle, insert, 1)
    p.write_text(t, encoding="utf-8")
    print("inserted basic header")
print("has", "基础 · 排版" in p.read_text(encoding="utf-8"))
