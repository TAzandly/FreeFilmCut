from pathlib import Path
import re
tl = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js").read_text(encoding="utf-8")
m = re.search(r"fragmentShader: /\* glsl \*/`.*?`,\n\t\ttransparent: true,", tl, re.S)
print("found", bool(m))
if m:
    print(m.group(0)[:2500])
