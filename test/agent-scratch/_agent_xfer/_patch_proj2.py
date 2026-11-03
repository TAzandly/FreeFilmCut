# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

vp_path = ROOT / "Viewport.js"
vp = vp_path.read_text(encoding="utf-8")

# Bump caches
vp = re.sub(r"TextLayerRT\.js\?v=fcc-ui-\d+", "TextLayerRT.js?v=fcc-ui-18", vp)
vp = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-11", vp)

# Find wipe layout collect call
old = """				if ( wipeInfo ) {
					// Axis from Troika caret / char layout (not object Box3 UV).
					const layout = collectWipeLayoutMetrics( wipeInfo.object );
					if ( editor.textAnimWipeDebug ) {
						if ( ! editor._fccWipeDbgLogged ) {
							editor._fccWipeDbgLogged = true;
							console.log( '[FreeFilmCut wipe] layout(world px)', layout,
								'progress', wipeInfo.wipe.progress,
								'res', textRT.width, textRT.height );
						}
					} else {
						editor._fccWipeDbgLogged = false;
					}
					outTex = applyWipeReveal( {"""

# Flexible match
m = re.search(
    r"if \( wipeInfo \) \{\s*"
    r"// Axis from Troika.*?"
    r"const layout = collectWipeLayoutMetrics\( wipeInfo\.object \);.*?"
    r"outTex = applyWipeReveal\( \{",
    vp,
    re.S,
)
if not m:
    # try without comment
    m = re.search(
        r"if \( wipeInfo \) \{\s*"
        r".*?const layout = collectWipeLayoutMetrics\( wipeInfo\.object \);.*?"
        r"outTex = applyWipeReveal\( \{",
        vp,
        re.S,
    )
if not m:
    # show context
    i = vp.find("collectWipeLayoutMetrics")
    print(repr(vp[i-200:i+400]))
    raise SystemExit("wipeInfo block not found")

new = """if ( wipeInfo ) {
					// Project caret/rect through the SAME ortho as text RT draw.
					const layout = collectWipeLayoutMetrics( wipeInfo.object, {
						camera: uiOverlay.camera,
						resW: projectRes.width,
						resH: projectRes.height,
						debug: !! editor.textAnimWipeDebug,
					} );
					if ( editor.textAnimWipeDebug ) {
						if ( ! editor._fccWipeDbgLogged ) {
							editor._fccWipeDbgLogged = true;
							console.log( '[FreeFilmCut wipe] rt-layout', layout,
								'progress', wipeInfo.wipe.progress,
								'cam', uiOverlay.camera && {
									l: uiOverlay.camera.left, r: uiOverlay.camera.right,
									t: uiOverlay.camera.top, b: uiOverlay.camera.bottom,
								} );
						}
					} else {
						editor._fccWipeDbgLogged = false;
					}
					outTex = applyWipeReveal( {"""

vp = vp[:m.start()] + new + vp[m.end():]
vp_path.write_text(vp, encoding="utf-8")
print("Viewport wired camera+res")

# Sync UIOverlay camera explicitly before metrics if needed - renderOverlay already did.
# Also bump UIText imports
for rel in ["ui/TextAnimRuntime.js", "ui/UIOverlay.js", "ui/UIRectLayout.js", "Sidebar.Object.TextAnim.js", "Sidebar.Object.UI.js"]:
    p = ROOT / rel
    if not p.exists():
        continue
    t = p.read_text(encoding="utf-8")
    t2 = t
    t2 = re.sub(r"UIText\.js\?v=fcc-ui-\d+", "UIText.js?v=fcc-ui-91", t2)
    t2 = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-11", t2)
    t2 = re.sub(r"Sidebar\.Object\.TextAnim\.js\?v=fcc-ui-\d+", "Sidebar.Object.TextAnim.js?v=fcc-ui-14", t2)
    if t2 != t:
        p.write_text(t2, encoding="utf-8")
        print("bumped", rel)

# TEXTANIM.md
md = (ROOT / "ui/TEXTANIM.md").read_text(encoding="utf-8")
md = md.replace("TextLayerRT.js?v=fcc-ui-17", "TextLayerRT.js?v=fcc-ui-18")
md = md.replace("TextAnimRuntime.js?v=fcc-ui-10", "TextAnimRuntime.js?v=fcc-ui-11")
if "project(camera)" not in md:
    md = md.replace(
        "1. `collectWipeLayoutMetrics(text)`：caret → `localToWorld` **overlay/RT 像素**",
        "1. `collectWipeLayoutMetrics(text,{camera,res})`：caret localToWorld → **uiOverlay.camera.project** → RT px；退化则全幅",
    )
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")

import subprocess
for f in ["ui/TextAnimRuntime.js", "ui/UIText.js", "Viewport.js"]:
    r = subprocess.run(["node", "--check", str(ROOT/f)], capture_output=True, text=True)
    print(("OK" if r.returncode==0 else "FAIL"), f, (r.stderr or "")[:300])

# Sanity: collectWipe signature
rt = (ROOT/"ui/TextAnimRuntime.js").read_text(encoding="utf-8")
assert "opts.camera" in rt or "opts = {}" in rt
assert "ndc.project" in rt
assert "fullFrame" in rt
print("asserts OK")
