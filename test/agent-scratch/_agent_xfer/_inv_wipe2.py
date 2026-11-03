from pathlib import Path
import re
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
side = (ROOT/"Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
# play loop
i = side.find("textAnimPlaying")
print("=== play related ===")
for ln, line in enumerate(side.splitlines(), 1):
    if any(k in line for k in ["textAnimPlaying", "requestAnimationFrame", "signals.", "dirty(", "textAnimTime", "render"]):
        if "textAnim" in line or "Playing" in line or "raf" in line.lower() or "dirty" in line or "requestAnimation" in line:
            print(f"{ln}:{line}")

print("\n=== applyWipeReveal skip + end ===")
tl = (ROOT/"ui/TextLayerRT.js").read_text(encoding="utf-8")
i = tl.find("export function applyWipeReveal")
print(tl[i:i+2200])
