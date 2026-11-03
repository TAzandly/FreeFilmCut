from pathlib import Path
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js").read_text(encoding="utf-8")
print(vp[vp.find("advanceTextAnim")-80:vp.find("advanceTextAnim")+250])
print("--- animate loop context ---")
# find animate function around 1144
lines = vp.splitlines()
for i in range(1120, 1160):
    print(f"{i+1}:{lines[i]}")
side = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
print("--- advanceTextAnim full ---")
print(side[side.find("editor.advanceTextAnim = function"):side.find("editor.advanceTextAnim = function")+550])
