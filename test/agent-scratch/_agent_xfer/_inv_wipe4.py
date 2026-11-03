from pathlib import Path
import re
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
# Who calls advanceTextAnim?
hits = []
for p in ROOT.rglob("*.js"):
    try:
        s = p.read_text(encoding="utf-8")
    except Exception:
        continue
    if "advanceTextAnim" in s:
        for i, line in enumerate(s.splitlines(), 1):
            if "advanceTextAnim" in line:
                hits.append(f"{p.name}:{i}:{line.strip()}")
print("\n".join(hits))
print("--- sceneGraphChanged in Viewport ---")
vp = (ROOT/"Viewport.js").read_text(encoding="utf-8")
for i, line in enumerate(vp.splitlines(), 1):
    if "sceneGraphChanged" in line or "advanceTextAnim" in line:
        print(f"{i}:{line.strip()}")
