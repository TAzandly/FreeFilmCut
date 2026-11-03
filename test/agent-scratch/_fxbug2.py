from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut")

# buildTextureFxComposer + renderTextureFx from PostProcessStack
pps = (root/"three.js/editor/js/postprocessing/PostProcessStack.js").read_text(encoding="utf-8", errors="replace")
i = pps.find("export function buildTextureFxComposer")
print(pps[i:i+4500])
print("\n=====\n")
i = pps.find("export function renderTextureFx")
print(pps[i:i+2500])
