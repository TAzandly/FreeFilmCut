from pathlib import Path
src = Path(r"D:\GrokbotWork\FreeFilmCut\_agent_xfer\p1-staging\FlowerStyle.js")
text = src.read_text(encoding="utf-8-sig").replace("\r\n", "\n")
dst = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\FlowerStyle.js")
dst.write_bytes(text.encode("utf-8"))
print("wrote", dst, "len", len(text))