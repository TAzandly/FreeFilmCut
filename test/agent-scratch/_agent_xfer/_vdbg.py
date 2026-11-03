from pathlib import Path
tl = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js").read_text(encoding="utf-8")
i = tl.find("if ( uDebug > 0.5 )")
print(tl[i:i+700])
