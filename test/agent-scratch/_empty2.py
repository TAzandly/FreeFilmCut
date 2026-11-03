from pathlib import Path
import re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

files = [
    "postprocessing/BuiltinEffects.js",
    "postprocessing/PostProcessStack.js",
    "postprocessing/PostProcessRegistry.js",
    "Sidebar.Object.PostProcess.js",
    "Sidebar.Object.TextFx.js",
    "ui/TextLayerRT.js",
    "Viewport.js",
]
for rel in files:
    p = root/rel
    if not p.exists():
        print("MISSING", rel)
        continue
    t = p.read_text(encoding="utf-8", errors="replace")
    print(f"\n===== {rel} =====")
    for m in re.finditer(r"from ['\"]([^'\"]*(?:PostProcess|BuiltinEffects|TextLayerRT)[^'\"]*)['\"]", t):
        print(" ", m.group(1))
