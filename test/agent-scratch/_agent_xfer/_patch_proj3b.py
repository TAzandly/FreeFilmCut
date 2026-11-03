# -*- coding: utf-8 -*-
from pathlib import Path
import re
rt_path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextAnimRuntime.js")
rt = rt_path.read_text(encoding="utf-8")

m = re.search(
    r"\tconst bw = maxX - minX;\n\tconst bh = maxY - minY;\n\tconst degenerate = .*?\n\n\tif \( opts\.debug \) \{\n\n\t\tconsole\.log\( '\[FreeFilmCut wipe\] rt-bounds'",
    rt,
    re.S,
)
if not m:
    raise SystemExit("block not found via regex")

replacement = """\tlet bw = maxX - minX;
	let bh = maxY - minY;

	// Expected text center in RT px (object origin = layout rect center).
	let expX = object.position.x;
	let expY = object.position.y;
	if ( camera && camera.isCamera ) {

		ndc.set( object.position.x, object.position.y, object.position.z || 0 );
		ndc.project( camera );
		expX = ( ndc.x * 0.5 + 0.5 ) * resW;
		expY = ( ndc.y * 0.5 + 0.5 ) * resH;

	}
	const midX = ( minX + maxX ) * 0.5;
	const midY = ( minY + maxY ) * 0.5;
	const dist = Math.hypot( midX - expX, midY - expY );

	const tiny = bw < Math.max( fs, 32 ) || bh < Math.max( fs * 0.35, 16 );
	const cornerSpeck = ( maxX < resW * 0.2 && maxY < resH * 0.2 && tiny )
		|| ( minX > resW * 0.8 && minY > resH * 0.8 && tiny );
	const farFromText = dist > Math.max( bw, bh, fs * 2, 64 );
	const outOfFrame = maxX < 0 || maxY < 0 || minX > resW || minY > resH
		|| bw > resW * 1.5 || bh > resH * 1.5;

	if ( tiny || cornerSpeck || farFromText || outOfFrame ) {

		const rect = ( ui && ( ui._layoutRect || ui.rect ) ) || null;
		if ( rect && rect.w > 16 && rect.h > 8 ) {

			minX = Infinity;
			maxX = - Infinity;
			minY = Infinity;
			maxY = - Infinity;
			const rc = [
				[ rect.x, rect.y ], [ rect.x + rect.w, rect.y ],
				[ rect.x, rect.y + rect.h ], [ rect.x + rect.w, rect.y + rect.h ],
			];
			for ( let k = 0; k < 4; k ++ ) {

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

			}
			bw = maxX - minX;
			bh = maxY - minY;
			if ( opts.debug ) {

				console.warn( '[FreeFilmCut wipe] caret bounds bad; using ui.rect', {
					tiny, cornerSpeck, farFromText, dist, expX, expY, rect,
				} );

			}

		}
		if ( ! ( bw > 16 && bh > 8 ) ) {

			if ( opts.debug ) {

				console.warn( '[FreeFilmCut wipe] full-frame LTR fallback', { minX, maxX, minY, maxY } );

			}
			return { space: 'rt', minX: 0, maxX: resW, minY: 0, maxY: resH, fullFrame: true };

		}

	}

	if ( opts.debug ) {

		console.log( '[FreeFilmCut wipe] rt-bounds'"""

rt = rt[:m.start()] + replacement + rt[m.end():]
rt_path.write_text(rt, encoding="utf-8")
import subprocess
r = subprocess.run(["node", "--check", str(rt_path)], capture_output=True, text=True)
print("OK" if r.returncode==0 else r.stderr[:500])
