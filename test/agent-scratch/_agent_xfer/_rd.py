from pathlib import Path
tl = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js").read_text(encoding="utf-8")
print(tl[8605:11000])
print("==== HEAD ====")
print(tl[:600])
