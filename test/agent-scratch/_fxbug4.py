from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
# Invert pass + CopyShader + OpenCut text-layer-rt / composer texture fx
root = Path(r"D:\GrokbotWork\FreeFilmCut")
inv = (root/"three.js/editor/js/postprocessing/InvertColorPass.js").read_text(encoding="utf-8", errors="replace")
print("===== Invert =====")
print(inv)

# Viewport text path snippet
vp = (root/"three.js/editor/js/Viewport.js").read_text(encoding="utf-8", errors="replace")
i = vp.find("wantTextRT")
print("\n===== Viewport text RT =====\n", vp[i-100:i+900])
