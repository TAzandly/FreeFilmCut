from pathlib import Path
ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# UIOverlay exports camera?
ov = (ROOT/"ui/UIOverlay.js").read_text(encoding="utf-8")
print("=== return / camera ===")
i = ov.find("return {")
print(ov[i:i+400] if i>=0 else "no return")
print("--- createUIOverlay end ---")
print(ov[-800:])

# Viewport how uiOverlay is used
vp = (ROOT/"Viewport.js").read_text(encoding="utf-8")
for k in ["uiOverlay", "createUIOverlay", "collectWipeLayoutMetrics"]:
    print(k, vp.find(k))
