from pathlib import Path
import re, sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
t = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts").read_text(encoding="utf-8", errors="replace")
print("=== imports ===")
for m in re.finditer(r"^import .+$", t, re.M):
    print(m.group(0)[:120])
# duplicate Pass?
print("Pass import count", len(re.findall(r"from \"three/addons/postprocessing/Pass.js\"", t)))
