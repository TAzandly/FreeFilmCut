from pathlib import Path
ov = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIOverlay.js").read_text(encoding="utf-8")
i = ov.find("render( renderer, presentLayout")
print(ov[i:i+1200])
