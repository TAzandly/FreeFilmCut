from pathlib import Path
import subprocess, re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
checks = []

rt = (ROOT / "ui/TextAnimRuntime.js").read_text(encoding="utf-8")
checks.append(("collectWipeLayoutMetrics export", "export function collectWipeLayoutMetrics" in rt))
checks.append(("uses __fccCharBase", "__fccCharBase" in rt[rt.find("collectWipeLayoutMetrics"):rt.find("collectWipeLayoutMetrics")+2000]))

tl = (ROOT / "ui/TextLayerRT.js").read_text(encoding="utf-8")
checks.append(("uLocalBounds", "uLocalBounds" in tl))
checks.append(("no uBounds in wipe mat", "uBounds" not in tl[tl.find("ensureWipePass"):tl.find("ensureWipeOutRT")]))
checks.append(("layout in applyWipe", "args.layout" in tl))
checks.append(("un-rotate local", "cosR * d.x + sinR * d.y" in tl))

vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
checks.append(("VP layout metrics", "collectWipeLayoutMetrics" in vp))
checks.append(("VP no bbox UV", "computeWipeUvBounds" not in vp))
checks.append(("VP TextLayerRT v13", "TextLayerRT.js?v=fcc-ui-13" in vp))
checks.append(("VP Runtime v8", "TextAnimRuntime.js?v=fcc-ui-8" in vp))

for name, ok in checks:
    print(("PASS" if ok else "FAIL"), name)

for f in ["ui/TextAnimRuntime.js", "ui/TextLayerRT.js", "Viewport.js", "Sidebar.Object.TextAnim.js"]:
    r = subprocess.run(["node", "--check", str(ROOT / f)], capture_output=True, text=True)
    print(("OK" if r.returncode == 0 else "FAIL"), f, (r.stderr or "")[:200])

# Show metrics function head
i = rt.find("export function collectWipeLayoutMetrics")
print("--- metrics snippet ---")
print(rt[i:i+600])
