from pathlib import Path
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
i = vp.find("computeWipeAlphaBounds( {")
print("at", i)
print(vp[i-80:i+1400])
