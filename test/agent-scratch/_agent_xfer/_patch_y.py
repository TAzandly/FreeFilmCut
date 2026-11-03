# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")
rt_path = ROOT / "ui/TextAnimRuntime.js"
rt = rt_path.read_text(encoding="utf-8")

# Replace from camera.updateProjectionMatrix through the projection loop and expX/expY project
# with pixel-ortho aware path.

old = None
m = re.search(
    r"\tif \( camera && camera\.isCamera \) \{\n\n\t\tcamera\.updateProjectionMatrix\(\);\n\t\tcamera\.updateMatrixWorld\( true \);\n\n\t\}\n\n"
    r"\t// Project world.*?\n"
    r"\tlet minX = Infinity;\n"
    r".*?"
    r"\tif \( camera && camera\.isCamera \) \{\n\n"
    r"\t\tndc\.set\( object\.position\.x, object\.position\.y, object\.position\.z \|\| 0 \);\n"
    r"\t\tndc\.project\( camera \);\n"
    r"\t\expX = \( ndc\.x \* 0\.5 \+ 0\.5 \) \* resW;\n"
    r"\t\expY = \( ndc\.y \* 0\.5 \+ 0\.5 \) \* resH;\n\n"
    r"\t\}",
    rt,
    re.S,
)
if not m:
    # try find start
    i = rt.find("camera.updateProjectionMatrix")
    print("start", i)
    print(repr(rt[i:i+900]))
    raise SystemExit("block not found")

new = """\t// Pixel UI ortho (left=0,right=W,bottom=0,top=H): localToWorld x/y ARE already
	// RT pixels (same as shader world=vUv*res). camera.project here collapsed Y to
	// the bottom strip — skip project for that camera.
	const pixelOrtho = !!(
		camera
		&& camera.isOrthographicCamera
		&& Math.abs( camera.left ) < 1.5
		&& Math.abs( camera.right - resW ) < 2.5
		&& Math.abs( camera.bottom ) < 1.5
		&& Math.abs( camera.top - resH ) < 2.5
	);

	if ( camera && camera.isCamera && ! pixelOrtho ) {

		camera.updateProjectionMatrix();
		camera.updateMatrixWorld( true );

	}

	let minX = Infinity;
	let maxX = - Infinity;
	let minY = Infinity;
	let maxY = - Infinity;
	const ndc = new THREE.Vector3();

	for ( let i = 0; i < worldPts.length; i += 3 ) {

		ndc.set( worldPts[ i ], worldPts[ i + 1 ], worldPts[ i + 2 ] );
		let px;
		let py;
		if ( pixelOrtho || ! camera || ! camera.isCamera ) {

			// Raw overlay / RT pixels (Y-up, origin bottom-left).
			px = worldPts[ i ];
			py = worldPts[ i + 1 ];

		} else {

			ndc.project( camera );
			px = ( ndc.x * 0.5 + 0.5 ) * resW;
			py = ( ndc.y * 0.5 + 0.5 ) * resH;

		}
		if ( px < minX ) minX = px;
		if ( px > maxX ) maxX = px;
		if ( py < minY ) minY = py;
		if ( py > maxY ) maxY = py;

	}

	const padX = Math.max( 2, ( maxX - minX ) * 0.08 );
	const padY = Math.max( 2, ( maxY - minY ) * 0.08 );
	minX -= padX;
	maxX += padX;
	minY -= padY;
	maxY += padY;

	let bw = maxX - minX;
	let bh = maxY - minY;

	// Expected text center in RT px.
	let expX = object.position.x;
	let expY = object.position.y;
	if ( camera && camera.isCamera && ! pixelOrtho ) {

		ndc.set( object.position.x, object.position.y, object.position.z || 0 );
		ndc.project( camera );
		expX = ( ndc.x * 0.5 + 0.5 ) * resW;
		expY = ( ndc.y * 0.5 + 0.5 ) * resH;

	}"""

# Need to also remove the duplicate padX/bw that followed - the regex included through expY project
# Check what comes after match end - the old block included pad and bw already in my new string.
# Looking at original: after projection loop comes padX, then bw, then expX. My regex ended at expY project closing.
# But my `new` also includes pad and bw and exp - and the old text between loop and expY is DUPLICATED in file if I only replace the match that starts at updateProjectionMatrix.

# Actually the match starts at updateProjectionMatrix and ends after expY project block.
# Original structure:
#   if camera update
#   // Project comment
#   let minX...
#   for loop with project
#   padX/padY apply
#   let bw/bh
#   expX/expY with project
# My new includes all of that. Good - but regex might NOT include padX section!

Looking at my regex - it goes from updateProjectionMatrix directly to let minX, then .*? to expY project. The .*? should include pad and bw. Then I replace with new which ALSO has pad and bw. Good - one copy.

rt = rt[:m.start()] + new + rt[m.end():]

# Also fix the ui.rect rebuild path that still uses project - search for it
# In the "caret bounds bad; using ui.rect" section
rt2 = rt
# Fix rect rebuild to respect pixelOrtho
old_rc = """			for ( let k = 0; k < 4; k ++ ) {

				ndc.set( rc[ k ][ 0 ], rc[ k ][ 1 ], 0 );
				let px = rc[ k ][ 0 ];
				let py = rc[ k ][ 1 ];
				if ( camera && camera.isCamera ) {

					ndc.project( camera );
					px = ( ndc.x * 0.5 + 0.5 ) * resW;
					py = ( ndc.y * 0.5 + 0.5 ) * resH;

				}
				if ( px < minX ) minX = px;
				if ( px > maxX ) maxX = px;
				if ( py < minY ) minY = py;
				if ( py > maxY ) maxY = py;

			}"""

new_rc = """			for ( let k = 0; k < 4; k ++ ) {

				let px = rc[ k ][ 0 ];
				let py = rc[ k ][ 1 ];
				if ( camera && camera.isCamera && ! pixelOrtho ) {

					ndc.set( rc[ k ][ 0 ], rc[ k ][ 1 ], 0 );
					ndc.project( camera );
					px = ( ndc.x * 0.5 + 0.5 ) * resW;
					py = ( ndc.y * 0.5 + 0.5 ) * resH;

				}
				if ( px < minX ) minX = px;
				if ( px > maxX ) maxX = px;
				if ( py < minY ) minY = py;
				if ( py > maxY ) maxY = py;

			}"""

if old_rc not in rt:
    print("WARN: rect rebuild loop not found")
else:
    rt = rt.replace(old_rc, new_rc)

# Enhance debug log to include pixelOrtho and text center
rt = rt.replace(
    "console.log( '[FreeFilmCut wipe] rt-bounds', { minX, maxX, minY, maxY, resW, resH, n: worldPts.length / 3 } );",
    "console.log( '[FreeFilmCut wipe] rt-bounds', { minX, maxX, minY, maxY, resW, resH, pixelOrtho, expX, expY, mid: [ (minX+maxX)/2, (minY+maxY)/2 ], n: worldPts.length / 3 } );",
)

rt_path.write_text(rt, encoding="utf-8")
print("metrics Y fix written", "pixelOrtho" in rt)

# Bump Viewport runtime cache
vp = (ROOT / "Viewport.js").read_text(encoding="utf-8")
vp2 = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-12", vp)
(ROOT / "Viewport.js").write_text(vp2, encoding="utf-8")
side = (ROOT / "Sidebar.Object.TextAnim.js").read_text(encoding="utf-8")
side = re.sub(r"TextAnimRuntime\.js\?v=fcc-ui-\d+", "TextAnimRuntime.js?v=fcc-ui-12", side)
(ROOT / "Sidebar.Object.TextAnim.js").write_text(side, encoding="utf-8")

md = (ROOT / "ui/TEXTANIM.md").read_text(encoding="utf-8")
md = md.replace("TextAnimRuntime.js?v=fcc-ui-11", "TextAnimRuntime.js?v=fcc-ui-12")
if "pixelOrtho" not in md:
    md = md.replace(
        "caret localToWorld → **uiOverlay.camera.project** → RT px；退化则全幅",
        "caret localToWorld → **像素正交直接当 RT px**（勿 project，否则 Y 沉底）；非像素相机才 project；退化则全幅",
    )
(ROOT / "ui/TEXTANIM.md").write_text(md, encoding="utf-8")

import subprocess
r = subprocess.run(["node", "--check", str(rt_path)], capture_output=True, text=True)
print("syntax", "OK" if r.returncode == 0 else r.stderr[:400])
