# -*- coding: utf-8 -*-
from pathlib import Path

# --- UIConstants: add flowerStyle: null to defaultTextData ---
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIConstants.js")
src = p.read_text(encoding="utf-8")
if "flowerStyle" not in src:
    src = src.replace(
        """\t\tshadow: {
\t\t\tenabled: false,
\t\t\toffsetX: 2,
\t\t\toffsetY: -2,
\t\t\tblur: 4,
\t\t\tcolor: '#000000',
\t\t\topacity: 0.75,
\t\t},
\t\t...defaultRectData( {
""",
        """\t\tshadow: {
\t\t\tenabled: false,
\t\t\toffsetX: 2,
\t\t\toffsetY: -2,
\t\t\tblur: 4,
\t\t\tcolor: '#000000',
\t\t\topacity: 0.75,
\t\t},
\t\t/** @type {object|null} FlowerStyle (花字); null = use legacy outline/shadow */
\t\tflowerStyle: null,
\t\t...defaultRectData( {
""")
    p.write_bytes(src.replace("\r\n","\n").encode("utf-8"))
    print("UIConstants flowerStyle added")
else:
    print("UIConstants already has flowerStyle")