from pathlib import Path
rt = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js").read_text(encoding="utf-8")
i = rt.find("const bw = maxX")
print(repr(rt[i:i+600]))
