from pathlib import Path
import re
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# Current wipe fragment + applyWipeReveal + sidebar wipe section markers
tl = (ROOT/"ui/TextLayerRT.js").read_text(encoding="utf-8")
print("uDebug" in tl, "debugMask" in tl)
print("cache TextLayerRT imports:", re.findall(r"TextLayerRT\.js\?v=[^\"]+", (ROOT/"Viewport.js").read_text(encoding="utf-8")))
side = (ROOT/"Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
i = side.find("Edge intensity")
print("--- sidebar near edge ---")
print(side[i-200:i+900])
print("--- applyWipe uniforms ---")
i = tl.find("wipeMat.uniforms.uDir")
print(tl[i:i+900])
