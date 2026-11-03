from pathlib import Path
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
i = vp.find("computeWipeAlphaBounds")
print(vp[i-100:i+1100])
