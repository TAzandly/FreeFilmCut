from pathlib import Path
import re
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# How canvases layout text groups
for name in ["UIOverlay.js", "UILayout.js", "UICanvas.js", "UIConstants.js"]:
    p = ROOT / "ui" / name
    if not p.exists():
        # search
        hits = list((ROOT/"ui").glob(name))
        print(name, "missing", hits)
        continue
    print("found", name, p.stat().st_size)

# find layoutAllCanvases
for p in (ROOT/"ui").rglob("*.js"):
    s = p.read_text(encoding="utf-8")
    if "layoutAllCanvases" in s or "applyTextTransform" in s:
        for i, line in enumerate(s.splitlines(), 1):
            if "layoutAllCanvases" in line or "applyTextTransform" in line or "position.set" in line and "rect" in line:
                if i < 5: continue
                print(f"{p.name}:{i}:{line.strip()[:120]}")
