from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
vp = (ROOT/"Viewport.js").read_text(encoding="utf-8")
tl = (ROOT/"ui/TextLayerRT.js").read_text(encoding="utf-8")
side = (ROOT/"Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")

# Viewport wipe section
i = vp.find("Active wipeReveal")
print("=== Viewport wipe block ===")
print(vp[i:i+2200])
print("\n=== textAnimTime / render ===")
for m in re.finditer(r"textAnimTime|textAnimPlaying|applyTextAnims|wantTextRT|applyWipeReveal|textLayerRT", vp):
    line = vp.rfind("\n", 0, m.start()) + 1
    end = vp.find("\n", m.start())
    ln = vp[:m.start()].count("\n") + 1
    print(f"{ln}:{vp[line:end].strip()}")
