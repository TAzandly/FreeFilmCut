from pathlib import Path
side = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
i = side.find("editor.advanceTextAnim = function")
print(side[i:i+700])
