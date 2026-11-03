# -*- coding: utf-8 -*-
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js")

# ========== 1) Stamp resolved rect on applyTextTransform ==========
ut = (ROOT / "ui/UIText.js").read_text(encoding="utf-8")
old_att = """export function applyTextTransform( group, rect ) {

	const ui = getFccUI( group ) || {};
	group.position.set( rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, group.position.z || 0 );"""
new_att = """export function applyTextTransform( group, rect ) {

	const ui = getFccUI( group ) || {};
	// Resolved overlay/RT pixel rect (bottom-left origin) for wipe metrics fallback.
	ui.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
	ui._layoutRect = ui.rect;
	group.position.set( rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, group.position.z || 0 );"""
if old_att not in ut:
    raise SystemExit("applyTextTransform not found")
ut = ut.replace(old_att, new_att)
# bump? Viewport imports UIText indirectly - bump UIText cache if referenced
(ROOT / "ui/UIText.js").write_text(ut, encoding="utf-8")
print("UIText rect stamp OK")

# ========== 2) Rewrite collectWipeLayoutMetrics ==========
rt_path = ROOT / "ui/TextAnimRuntime.js"
rt = rt_path.read_text(encoding="utf-8")

m = re.search(r"export function collectWipeLayoutMetrics\( object \) \{.*?\n\}\n\n", rt, re.S)
if not m:
    # with JSDoc
    m = re.search(
        r"/\*\*\n \* Wipe axis metrics.*?export function collectWipeLayoutMetrics\( object.*?\) \{.*?\n\}\n\n",
        rt,
        re.S,
    )
if not m:
    raise SystemExit("collectWipeLayoutMetrics block not found")

new_fn = r'''/**
 * Wipe AABB in **text-RT pixel space** (matches shader `world = vUv * res`,
 * UI ortho bottom-left). Projects caret/rect corners through the overlay camera
 * used by `renderOverlayTextLayerToRT` — never raw untransformed rect alone.
 *
 * @param {THREE.Object3D} object UI Text root
 * @param {{camera?:THREE.Camera,resW?:number,resH?:number,debug?:boolean}} [opts]
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,space:string}|null}
 */
export function collectWipeLayoutMetrics( object, opts = {} ) {

	if ( ! object ) return null;
	const ui = getFccUI( object );
	const fs = ( ui && Number( ui.fontSize ) > 0 ) ? Number( ui.fontSize ) : 48;
	const resW = Math.max( 1, Number( opts.resW ) || 1 );
	const resH = Math.max( 1, Number( opts.resH ) || 1 );
	const camera = opts.camera || null;

	object.updateMatrixWorld( true );

	const worldPts = [];
	const v = new THREE.Vector3();
	const half = Math.max( 4, fs * 0.5 );

	const root = object.getObjectByName( FCC_TEXTANIM_ROOT );
	const count = root && root.userData ? ( root.userData.__fccCharCount || 0 ) : 0;
	if ( root && root.userData && root.userData.__fccReady && count > 0 ) {

		for ( let i = 0; i < count; i ++ ) {

			const cg = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
			const b = cg && cg.userData && cg.userData.__fccCharBase;
			if ( ! b ) continue;
			// Rest caret + half-glyph corners in text-local, then to world.
			const corners = [
				[ b.x - half, b.y - half ],
				[ b.x + half, b.y - half ],
				[ b.x - half, b.y + half ],
				[ b.x + half, b.y + half ],
			];
			for ( let k = 0; k < corners.length; k ++ ) {

				v.set( corners[ k ][ 0 ], corners[ k ][ 1 ], 0 );
				object.localToWorld( v );
				worldPts.push( v.x, v.y, v.z );

			}

		}

	}

	// Rect fallback: four corners of resolved layout rect → world via object parent chain.
	if ( worldPts.length < 2 ) {

		const rect = ( ui && ( ui._layoutRect || ui.rect ) ) || null;
		if ( rect && rect.w > 0 && rect.h > 0 ) {

			const corners = [
				[ rect.x, rect.y ],
				[ rect.x + rect.w, rect.y ],
				[ rect.x, rect.y + rect.h ],
				[ rect.x + rect.w, rect.y + rect.h ],
			];
			// rect is already overlay pixels; object.position is rect center — convert
			// corner from overlay px into object-local then localToWorld (handles parents).
			const cx = object.position.x;
			const cy = object.position.y;
			for ( let k = 0; k < 4; k ++ ) {

				v.set( corners[ k ][ 0 ] - cx, corners[ k ][ 1 ] - cy, 0 );
				// If parents only translate in pixel space, localToWorld(object-local)
				// equals corner when object local = corner - center... but scale/rot:
				v.set( corners[ k ][ 0 ] - cx, corners[ k ][ 1 ] - cy, 0 );
				object.localToWorld( v );
				// localToWorld applies full matrix including position → wrong if we
				// already subtracted center. Use: set local offset = corner - center
				// in unscaled space. Better: set world directly if overlay flat:
				worldPts.push( corners[ k ][ 0 ], corners[ k ][ 1 ], 0 );

			}

		}

	}

	if ( worldPts.length < 2 ) {

		if ( opts.debug ) {

			console.warn( '[FreeFilmCut wipe] no layout points; full-frame fallback' );

		}
		return { space: 'rt', minX: 0, maxX: resW, minY: 0, maxY: resH, fullFrame: true };

	}

	// Project world → RT pixels via overlay ortho (same camera as text RT draw).
	let minX = Infinity;
	let maxX = - Infinity;
	let minY = Infinity;
	let maxY = - Infinity;
	const ndc = new THREE.Vector3();

	for ( let i = 0; i < worldPts.length; i += 3 ) {

		ndc.set( worldPts[ i ], worldPts[ i + 1 ], worldPts[ i + 2 ] );
		let px;
		let py;
		if ( camera && camera.isCamera ) {

			ndc.project( camera );
			px = ( ndc.x * 0.5 + 0.5 ) * resW;
			py = ( ndc.y * 0.5 + 0.5 ) * resH;

		} else {

			px = worldPts[ i ];
			py = worldPts[ i + 1 ];

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

	const bw = maxX - minX;
	const bh = maxY - minY;
	const degenerate = ! ( bw > 8 && bh > 8 )
		|| maxX < 0 || maxY < 0
		|| minX > resW || minY > resH
		|| bw > resW * 1.5 || bh > resH * 1.5;

	if ( degenerate ) {

		if ( opts.debug ) {

			console.warn( '[FreeFilmCut wipe] degenerate bounds', { minX, maxX, minY, maxY, resW, resH },
				'→ full-frame LTR' );

		}
		return { space: 'rt', minX: 0, maxX: resW, minY: 0, maxY: resH, fullFrame: true };

	}

	if ( opts.debug ) {

		console.log( '[FreeFilmCut wipe] rt-bounds', { minX, maxX, minY, maxY, resW, resH, n: worldPts.length / 3 } );

	}

	return {
		space: 'rt',
		minX,
		maxX,
		minY,
		maxY,
	};

}

'''

rt = rt[:m.start()] + new_fn + rt[m.end():]
rt_path.write_text(rt, encoding="utf-8")
print("collectWipeLayoutMetrics rewritten")

# Fix the messy rect fallback - I left duplicate logic. Clean the rect branch in the written function.
# Re-read and fix rect fallback to only push overlay corners as world (for flat overlay) OR
# properly transform. For overlay flat hierarchy, corners in pixel space ARE the world positions
# matching the ortho camera — project() will map them correctly IF camera is synced to resW/H.

rt = rt_path.read_text(encoding="utf-8")
# Simplify rect fallback section - replace the broken one
bad = """	// Rect fallback: four corners of resolved layout rect → world via object parent chain.
	if ( worldPts.length < 2 ) {

		const rect = ( ui && ( ui._layoutRect || ui.rect ) ) || null;
		if ( rect && rect.w > 0 && rect.h > 0 ) {

			const corners = [
				[ rect.x, rect.y ],
				[ rect.x + rect.w, rect.y ],
				[ rect.x, rect.y + rect.h ],
				[ rect.x + rect.w, rect.y + rect.h ],
			];
			// rect is already overlay pixels; object.position is rect center — convert
			// corner from overlay px into object-local then localToWorld (handles parents).
			const cx = object.position.x;
			const cy = object.position.y;
			for ( let k = 0; k < 4; k ++ ) {

				v.set( corners[ k ][ 0 ] - cx, corners[ k ][ 1 ] - cy, 0 );
				// If parents only translate in pixel space, localToWorld(object-local)
				// equals corner when object local = corner - center... but scale/rot:
				v.set( corners[ k ][ 0 ] - cx, corners[ k ][ 1 ] - cy, 0 );
				object.localToWorld( v );
				// localToWorld applies full matrix including position → wrong if we
				// already subtracted center. Use: set local offset = corner - center
				// in unscaled space. Better: set world directly if overlay flat:
				worldPts.push( corners[ k ][ 0 ], corners[ k ][ 1 ], 0 );

			}

		}

	}"""

good = """	// Rect fallback: four corners in overlay pixel space (same as UI ortho world).
	if ( worldPts.length < 2 ) {

		const rect = ( ui && ( ui._layoutRect || ui.rect ) ) || null;
		if ( rect && rect.w > 0 && rect.h > 0 ) {

			const corners = [
				[ rect.x, rect.y, 0 ],
				[ rect.x + rect.w, rect.y, 0 ],
				[ rect.x, rect.y + rect.h, 0 ],
				[ rect.x + rect.w, rect.y + rect.h, 0 ],
			];
			for ( let k = 0; k < 4; k ++ ) {

				worldPts.push( corners[ k ][ 0 ], corners[ k ][ 1 ], corners[ k ][ 2 ] );

			}

		}

	}"""

if bad not in rt:
    print("WARN: bad rect block not exact, trying continue")
else:
    rt = rt.replace(bad, good)
    rt_path.write_text(rt, encoding="utf-8")
    print("rect fallback cleaned")
