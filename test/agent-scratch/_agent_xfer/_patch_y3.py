# -*- coding: utf-8 -*-
from pathlib import Path

rt_path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js")
rt = rt_path.read_text(encoding="utf-8")

# Find the function and rewrite from "if ( camera && camera.isCamera )" updateProjection through expY block
start = rt.find("\tif ( camera && camera.isCamera ) {\n\n\t\tcamera.updateProjectionMatrix();")
if start < 0:
    start = rt.find("camera.updateProjectionMatrix();")
    # back up to line start
    start = rt.rfind("\n", 0, start) + 1
    print("alt start", start)

end_marker = "\texpY = ( ndc.y * 0.5 + 0.5 ) * resH;\n\n\t}"
end = rt.find(end_marker, start)
if end < 0:
    raise SystemExit("end marker not found")
end = end + len(end_marker)

print("replacing", start, end, "len", end-start)
print("HEAD:", repr(rt[start:start+80]))
print("TAIL:", repr(rt[end-80:end]))

new = """\t// Pixel UI ortho (left=0,right=W,bottom=0,top=H): localToWorld x/y ARE already
	// RT pixels (same as shader world=vUv*res). camera.project collapsed Y to the
	// bottom strip — skip project for that camera.
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

		let px;
		let py;
		if ( pixelOrtho || ! camera || ! camera.isCamera ) {

			px = worldPts[ i ];
			py = worldPts[ i + 1 ];

		} else {

			ndc.set( worldPts[ i ], worldPts[ i + 1 ], worldPts[ i + 2 ] );
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

	let expX = object.position.x;
	let expY = object.position.y;
	if ( camera && camera.isCamera && ! pixelOrtho ) {

		ndc.set( object.position.x, object.position.y, object.position.z || 0 );
		ndc.project( camera );
		expX = ( ndc.x * 0.5 + 0.5 ) * resW;
		expY = ( ndc.y * 0.5 + 0.5 ) * resH;

	}"""

rt = rt[0:start] + new + rt[end:]

# Fix rect rebuild to use pixelOrtho
old_rc = """			for ( let k = 0; k < 4; k ++ ) {

				ndc.set( rc[ k ][ 0 ], rc[ k ][ 1 ], 0 );
				let px = rc[ k ][ 0 ];
				let py = rc[ k ][ 1 ];
				if ( camera && camera.isCamera ) {

					ndc.project( camera );
					px = ( ndc.x * 0.5 + 0.5 ) * resW;
					py = ( ndc.y * 0.5 + 0.5 ) * resH;

				}
"""
new_rc = """			for ( let k = 0; k < 4; k ++ ) {

				let px = rc[ k ][ 0 ];
				let py = rc[ k ][ 1 ];
				if ( camera && camera.isCamera && ! pixelOrtho ) {

					ndc.set( rc[ k ][ 0 ], rc[ k ][ 1 ], 0 );
					ndc.project( camera );
					px = ( ndc.x * 0.5 + 0.5 ) * resW;
					py = ( ndc.y * 0.5 + 0.5 ) * resH;

				}
"""
if old_rc in rt:
    rt = rt.replace(old_rc, new_rc)
    print("rect rebuild fixed")
else:
    print("WARN rect rebuild")

# debug log
rt = rt.replace(
    "console.log( '[FreeFilmCut wipe] rt-bounds', { minX, maxX, minY, maxY, resW, resH, n: worldPts.length / 3 } );",
    "console.log( '[FreeFilmCut wipe] rt-bounds', { minX, maxX, minY, maxY, resW, resH, pixelOrtho, expX, expY, midY: (minY+maxY)/2, n: worldPts.length / 3 } );",
)

rt_path.write_text(rt, encoding="utf-8")
print("Runtime Y fix OK", "pixelOrtho" in rt)

import subprocess
r = subprocess.run(["node", "--check", str(rt_path)], capture_output=True, text=True)
print("syntax", r.returncode, (r.stderr or "")[:300])
