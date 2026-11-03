# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# Fix dispose if missing
tl_path = ROOT / "ui/TextLayerRT.js"
tl = tl_path.read_text(encoding="utf-8")
if "alphaBoundsRT.dispose" not in tl:
    # find disposeTextLayerRT wipeOutRT block end
    i = tl.find("export function disposeTextLayerRT")
    j = tl.find("if ( wipeOutRT )", i)
    print("dispose section", j)
    # insert after wipeCam = null related wipe dispose
    k = tl.find("wipeScene = null;", j)
    if k < 0:
        k = tl.find("wipeCam = null;", j)
    print("after wipe", k, repr(tl[k:k+120]))
    # Find a good insert point - after wipeCam = null;
    ins = tl.find("wipeCam = null;", j)
    if ins > 0:
        ins = ins + len("wipeCam = null;")
        add = """

	if ( alphaBoundsRT ) {

		alphaBoundsRT.dispose();
		alphaBoundsRT = null;

	}

	if ( alphaBoundsMat ) {

		alphaBoundsMat.dispose();
		alphaBoundsMat = null;

	}

	if ( alphaBoundsMesh ) {

		alphaBoundsMesh.geometry.dispose();
		alphaBoundsMesh = null;

	}

	alphaBoundsScene = null;
	alphaBoundsCam = null;
	alphaBoundsBuf = null;"""
        tl = tl[:ins] + add + tl[ins:]
        tl_path.write_text(tl, encoding="utf-8")
        print("dispose added")
else:
    print("dispose already OK")

# Viewport: replace wipe layout path
vp_path = ROOT / "Viewport.js"
vp = vp_path.read_text(encoding="utf-8")

# Update imports
old_imp = """import {
	ensureTextLayerRenderTarget,
	renderOverlayTextLayerToRT,
	blitTextLayerToLetterbox,
	stackDataHasEnabledEffects,
	applyWipeReveal,
	applyTextLayerFx,
} from './ui/TextLayerRT.js?v=fcc-ui-19';
import { isFccUI, getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-88';
import {
	applyTextAnimsInScene,
	collectWipeLayoutMetrics,
} from './ui/TextAnimRuntime.js?v=fcc-ui-12';"""

# Flexible - find and replace TextLayerRT import block and Runtime import
m = re.search(
    r"import \{\n\tensureTextLayerRenderTarget,.*?\n\} from '\./ui/TextLayerRT\.js\?v=[^']+';",
    vp,
    re.S,
)
if not m:
    raise SystemExit("TextLayerRT import not found")
new_imp = """import {
	ensureTextLayerRenderTarget,
	renderOverlayTextLayerToRT,
	blitTextLayerToLetterbox,
	stackDataHasEnabledEffects,
	applyWipeReveal,
	applyTextLayerFx,
	computeWipeAlphaBounds,
} from './ui/TextLayerRT.js?v=fcc-ui-20';"""
vp = vp[:m.start()] + new_imp + vp[m.end():]

# Remove collectWipeLayoutMetrics from Runtime import
vp = re.sub(
    r"import \{\n\tapplyTextAnimsInScene,\n\tcollectWipeLayoutMetrics,\n\} from '\./ui/TextAnimRuntime\.js\?v=[^']+';",
    "import { applyTextAnimsInScene } from './ui/TextAnimRuntime.js?v=fcc-ui-12';",
    vp,
)
# or if already single
vp = re.sub(
    r"import \{\s*applyTextAnimsInScene,\s*collectWipeLayoutMetrics,\s*\} from '\./ui/TextAnimRuntime\.js\?v=[^']+';",
    "import { applyTextAnimsInScene } from './ui/TextAnimRuntime.js?v=fcc-ui-12';",
    vp,
)
vp = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-12", vp)

# Replace wipeInfo block body for layout
m = re.search(
    r"if \( wipeInfo \) \{\s*"
    r".*?"
    r"outTex = applyWipeReveal\( \{",
    vp,
    re.S,
)
if not m:
    i = vp.find("collectWipeLayoutMetrics")
    print("collect still at", i)
    i = vp.find("if ( wipeInfo )")
    # find the wipe one near applyWipeReveal
    i = vp.find("applyWipeReveal")
    print(vp[i-800:i+100])
    raise SystemExit("wipeInfo apply block not found")

new_wipe = """if ( wipeInfo ) {
					// Bounds from actual text-RT alpha (same space as wipe shader vUv*res).
					const layout = computeWipeAlphaBounds( {
						renderer,
						inputTexture: outTex,
						width: textRT.width,
						height: textRT.height,
						maxSide: 128,
						debug: !! editor.textAnimWipeDebug,
					} );
					if ( editor.textAnimWipeDebug ) {
						if ( ! editor._fccWipeDbgLogged ) {
							editor._fccWipeDbgLogged = true;
							console.log( '[FreeFilmCut wipe] alpha-AABB', layout,
								'progress', wipeInfo.wipe.progress );
						}
					} else {
						editor._fccWipeDbgLogged = false;
					}
					if ( layout ) {
					outTex = applyWipeReveal( {"""

vp = vp[:m.start()] + new_wipe + vp[m.end():]

# Close the if (layout) after applyWipeReveal call - find the call end
# After replacement, applyWipeReveal ends with `} ) || outTex;`
# Need to add closing brace for if (layout)
idx = vp.find("debugMask: !! editor.textAnimWipeDebug,")
if idx < 0:
    raise SystemExit("debugMask line missing")
# find closing of applyWipeReveal
end = vp.find("} ) || outTex;", idx)
if end < 0:
    raise SystemExit("applyWipeReveal end not found")
end = end + len("} ) || outTex;")
# Insert closing brace for if (layout)
if "if ( layout )" in vp[vp.find("computeWipeAlphaBounds"):end+50]:
    # check if already closed
    after = vp[end:end+40]
    if not after.strip().startswith("}"):
        vp = vp[:end] + "\n\t\t\t\t\t}" + vp[end:]
        print("closed if(layout)")
    else:
        print("already closed?", repr(after[:40]))

vp_path.write_text(vp, encoding="utf-8")
print("Viewport updated")

# Verify no collectWipeLayoutMetrics in Viewport
if "collectWipeLayoutMetrics" in vp:
    print("WARN still imports collectWipeLayoutMetrics")
else:
    print("collectWipeLayoutMetrics removed from Viewport")

import subprocess
r = subprocess.run(["node", "--check", str(vp_path)], capture_output=True, text=True)
print("vp syntax", r.returncode, (r.stderr or "")[:500])
r = subprocess.run(["node", "--check", str(tl_path)], capture_output=True, text=True)
print("tl syntax", r.returncode, (r.stderr or "")[:300])
