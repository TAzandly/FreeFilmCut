from pathlib import Path
s = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIRectLayout.js").read_text(encoding="utf-8")
i = s.find("function computeAnchoredRect")
print(s[i:i+1800])
print("==== layoutChildren position ====")
i = s.find("function layoutChildren")
print(s[i:i+1200])
