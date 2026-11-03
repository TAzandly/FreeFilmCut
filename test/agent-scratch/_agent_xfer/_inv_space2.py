from pathlib import Path
s = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\UIRectLayout.js").read_text(encoding="utf-8")
print(s[:2500])
print("====")
print(s[s.find("export function layoutAllCanvases"):s.find("export function layoutAllCanvases")+1500])
