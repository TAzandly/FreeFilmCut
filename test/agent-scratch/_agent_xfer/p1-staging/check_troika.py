from pathlib import Path
# check troika in opencut
import os
root = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\node_modules\troika-three-text")
print("exists", root.exists())
if root.exists():
    for p in root.rglob("*.js"):
        if p.name in ("index.js", "troika-three-text.esm.js", "index.esm.js"):
            print(p)
    pkg = root / "package.json"
    if pkg.exists():
        print(pkg.read_text(encoding="utf-8")[:500])
# also troika-three-utils
u = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\node_modules\troika-three-utils")
print("utils", u.exists())
# bun hoisted?
for cand in [
    Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\node_modules\troika-three-text"),
    Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\node_modules\troika-three-utils"),
]:
    print(cand, cand.exists())
