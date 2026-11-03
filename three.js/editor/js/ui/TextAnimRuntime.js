/**
 * Editor char-anim preview runtime (textanim v3).
 *
 * Responsibilities are deliberately small now:
 *   1. decide whether this Text needs a per-glyph split (char-scope components)
 *   2. build / dispose the per-char Troika + flower Effect stacks
 *   3. write sampled poses onto those groups
 *
 * Sampling itself lives in js/textanim/TextAnimEngine.js. Text-scope components
 * (wipe / future blur) never trigger a split — the single original Text mesh is
 * rendered and the pass is applied on the TextLayerRT instead.
 *
 * Perf: O(chars × flower passes) Troika meshes — long strings are heavy.
 */

import * as THREE from 'three';
import { Text } from 'troika-three-text';
import {
	getFccUI,
	isUIText,
} from './UIConstants.js?v=fcc-ui-108';
import {
	applyTroikaFromUI,
	syncUITextContent,
} from './UIText.js?v=fcc-ui-234';
import {
	ensureTextAnimOnUI,
	sampleTextAnim,
	textAnimNeedsCharSplit,
} from './TextAnim.js?v=fcc-ui-146';
import { getTextAnimSampleOpts } from './TextAnimOverrides.js';

export const FCC_TEXTANIM_ROOT = '__fccTextAnimRoot';
export const FCC_TEXTANIM_LAYOUT = '__fccTextAnimLayout';
export const FCC_TEXTANIM_CHAR_PREFIX = '__fccChar_';

/** Soft warning threshold for Editor preview cost. */
const PERF_WARN_CHARS = 24;


const FCC_FLOWER_FACE = '__fccFlower_face';
const FCC_TEXT_MESH = '__fccText';

function isTroikaMesh( o ) {

	return !! ( o && typeof o.sync === 'function' );

}

function findLayoutSourceTroika( group ) {

	const prefer = [ FCC_FLOWER_FACE, FCC_TEXT_MESH ];
	const pools = [];
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( ! c || c.name === FCC_TEXTANIM_ROOT ) continue;
		pools.push( c );

	}
	for ( let p = 0; p < prefer.length; p ++ ) {

		for ( let i = 0; i < pools.length; i ++ ) {

			const o = pools[ i ];
			if ( o && o.name === prefer[ p ] && isTroikaMesh( o ) ) return o;

		}

	}
	for ( let i = 0; i < pools.length; i ++ ) {

		const o = pools[ i ];
		if ( isTroikaMesh( o ) && ( o.name === '__fccTextShadow' || ( o.name && o.name.indexOf( '__fccFlower_' ) === 0 ) ) ) return o;

	}
	return null;

}

function readCaretPositions( src ) {

	if ( ! src ) return null;
	const info = src.textRenderInfo;
	const carets = info && info.caretPositions;
	if ( carets && carets.length >= 4 ) return carets;
	return null;

}

function copyTroikaTypesetMetrics( dst, src ) {

	const keys = [ 'font', 'fontSize', 'letterSpacing', 'lineHeight', 'maxWidth', 'textAlign', 'anchorX', 'anchorY', 'overflowWrap', 'sdfGlyphSize', 'lang' ];
	for ( let i = 0; i < keys.length; i ++ ) {

		const k = keys[ i ];
		if ( src[ k ] !== undefined && src[ k ] !== null ) {

			try { dst[ k ] = src[ k ]; } catch ( e ) { /* ignore */ }

		}

	}
	dst.text = src.text != null ? String( src.text ) : '';

}

function makeLayoutTroika( name ) {

	const t = new Text();
	t.name = name;
	t.frustumCulled = false;
	t.castShadow = false;
	t.receiveShadow = false;
	t.sdfGlyphSize = 128;
	return t;

}

function listAnimatableChars( text ) {

	const s = text != null ? String( text ) : '';
	const chars = [];
	for ( const ch of s ) {

		if ( ch === '\n' || ch === '\r' ) continue;
		chars.push( ch );

	}

	return chars;

}

function hideNonAnimChildren( group, hide ) {

	if ( ! group.userData.__fccTextAnimVis ) group.userData.__fccTextAnimVis = {};
	const store = group.userData.__fccTextAnimVis;
	// Flag read by syncUITextContent so Troika async sync cannot re-show originals.
	group.userData.__fccTextAnimHideOriginals = !! hide;
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( ! c ) continue;
		if ( c.name === FCC_TEXTANIM_ROOT ) continue;
		// Sticker-follow meshes stay visible during char-anim preview.
		if ( c.name === '__fccTextStickers'
			|| c.name === '__fccTextStickersBehind'
			|| c.name === '__fccTextStickersFront' ) continue;
		// Hide ALL non-preview children (flower / legacy text / unnamed leftovers).
		if ( hide ) {

			// Always remember "should be on" — during preview Troika/hideOrig may
			// already have forced visible=false; storing that would keep originals
			// invisible after clearTextAnimPreview.
			if ( store[ c.uuid ] === undefined ) store[ c.uuid ] = true;
			c.visible = false;

		} else if ( store[ c.uuid ] !== undefined ) {

			c.visible = !! store[ c.uuid ];
			delete store[ c.uuid ];

		}

	}

	if ( ! hide ) {

		group.userData.__fccTextAnimVis = {};
		group.userData.__fccTextAnimHideOriginals = false;

	}

}

function disposeObject3D( obj ) {

	try {

		if ( typeof obj.dispose === 'function' ) obj.dispose();

	} catch ( e ) { /* ignore */ }

}

export function clearTextAnimPreview( group ) {

	if ( ! group ) return;
	const root = group.getObjectByName( FCC_TEXTANIM_ROOT );
	if ( ! root && ! group.userData.__fccTextAnimHideOriginals ) return;

	hideNonAnimChildren( group, false );
	if ( root ) {

		group.remove( root );
		root.traverse( ( o ) => disposeObject3D( o ) );

	}

	group.userData.__fccTextAnimBuiltSig = null;

}

function colorFromUI( ui ) {

	if ( ui.color != null ) return ui.color;
	if ( ui.fill && ui.fill.color ) return ui.fill.color;
	return '#ffffff';

}

/**
 * Per-char fccUI: keep flowerStyle / fontSize; force center anchors so glyph
 * sits on group origin and caret centers line up.
 */
function cloneCharUI( ui, ch ) {

	return {
		...ui,
		type: 'text',
		text: ch,
		align: 'center',
		verticalAlign: 'middle',
		// Spacing lives in caret midpoints from the full-string layout.
		letterSpacing: 0,
		// Keep flowerStyle reference (sync reads it; do not mutate).
		flowerStyle: ui.flowerStyle != null ? ui.flowerStyle : null,
	};

}

function buildSig( ui, rect ) {

	// Pose / selector / component params are sampled every frame — omit them so
	// tweaking knobs does not rebuild O(chars × flower) Troika stacks.
	return JSON.stringify( {
		text: ui.text,
		fontSize: ui.fontSize,
		font: ui.fontUrl || ui.font || '',
		fontBold: ui.fontBold || '',
		bold: !! ui.bold,
		align: ui.align,
		vAlign: ui.verticalAlign || ui.vAlign,
		letterSpacing: ui.letterSpacing,
		lineHeight: ui.lineHeight,
		color: ui.color,
		flowerStyle: ui.flowerStyle || null,
		w: rect && rect.w,
		h: rect && rect.h,
		flowerWithChar: 2, // parent carets + char LS=0
	} );

}

function applyOpacityToCharGroup( charGroup, op ) {

	const a = Math.max( 0, Math.min( 1, op ) );
	// Stickers (followCharAnim) sample this for opacity parity with clip.
	charGroup.userData.__fccAnimLastOp = a;
	charGroup.visible = a > 0.001;
	if ( ! charGroup.visible ) return;

	charGroup.traverse( ( o ) => {

		if ( ! o || typeof o.sync !== 'function' ) return;
		// Troika Text: drive channel alphas (preferred — avoids DerivedMaterial base bugs)
		if ( o.fillOpacity != null ) o.fillOpacity = a;
		if ( o.outlineOpacity != null && o.outlineWidth > 0 ) {

			o.userData.__fccAnimBaseOutlineOp = o.userData.__fccAnimBaseOutlineOp != null
				? o.userData.__fccAnimBaseOutlineOp
				: o.outlineOpacity;
			o.outlineOpacity = o.userData.__fccAnimBaseOutlineOp * a;

		}

		if ( o.strokeOpacity != null && ( o.strokeWidth > 0 || o.userData.__fccAnimStroke ) ) {

			o.userData.__fccAnimBaseStrokeOp = o.userData.__fccAnimBaseStrokeOp != null
				? o.userData.__fccAnimBaseStrokeOp
				: o.strokeOpacity;
			o.strokeOpacity = o.userData.__fccAnimBaseStrokeOp * a;
			o.userData.__fccAnimStroke = true;

		}

		// Optional material opacity: only real THREE.Materials. Reading Troika
		// .material after a DerivedMaterial was wrongly assigned as base can throw
		// (baseMaterial.addEventListener is not a function) — guard the getter.
		let mats = [];
		try {

			const raw = o.material;
			mats = raw ? ( Array.isArray( raw ) ? raw : [ raw ] ) : [];

		} catch ( e ) {

			return;

		}

		for ( let i = 0; i < mats.length; i ++ ) {

			const m = mats[ i ];
			if ( ! m || ! m.isMaterial ) continue;
			if ( typeof m.addEventListener !== 'function' ) continue;
			if ( m.opacity == null ) continue;
			if ( ! m.userData ) m.userData = {};
			if ( m.userData.__fccAnimBaseOp == null ) m.userData.__fccAnimBaseOp = m.opacity;
			m.opacity = m.userData.__fccAnimBaseOp * a;
			m.transparent = true;
			m.depthWrite = a > 0.95 && !! m.depthWrite;

		}

	} );

}

/**
 * Ensure per-char flower Groups exist (async via Troika sync on layout).
 * Only called when at least one enabled char-scope component exists.
 * @returns {boolean} true if ready to sample this frame
 */
export function ensureTextAnimPreview( group, rect ) {

	const ui = getFccUI( group );
	if ( ! ui || ui.type !== 'text' ) return false;
	const anim = ensureTextAnimOnUI( ui );
	if ( ! anim.enabled || ! textAnimNeedsCharSplit( anim, getTextAnimSampleOpts( group ).values ) ) {

		clearTextAnimPreview( group );
		return false;

	}

	const chars = listAnimatableChars( ui.text );
	if ( chars.length === 0 ) {

		clearTextAnimPreview( group );
		return false;

	}

	const sig = buildSig( ui, rect );
	let root = group.getObjectByName( FCC_TEXTANIM_ROOT );
	if ( root && group.userData.__fccTextAnimBuiltSig === sig && root.userData.__fccReady ) {

		hideNonAnimChildren( group, true );
		return true;

	}

	if ( root ) {

		group.remove( root );
		root.traverse( ( o ) => disposeObject3D( o ) );

	}

	root = new THREE.Group();
	root.name = FCC_TEXTANIM_ROOT;
	root.userData.__fccReady = false;
	group.add( root );

	const layoutSrc = findLayoutSourceTroika( group );
	const parentCarets = readCaretPositions( layoutSrc );

	hideNonAnimChildren( group, true );

	if ( chars.length > PERF_WARN_CHARS && ! group.userData.__fccTextAnimPerfWarned ) {

		group.userData.__fccTextAnimPerfWarned = true;
		console.warn(
			'[FreeFilmCut] textanim flower×char preview:',
			chars.length,
			'chars — each builds a full Effect stack; keep strings short in Editor.',
		);

	}

	const layout = makeLayoutTroika( FCC_TEXTANIM_LAYOUT );
	layout.visible = false;
	layout.layers.disableAll();
	root.add( layout );
	if ( layoutSrc ) {

		copyTroikaTypesetMetrics( layout, layoutSrc );
		layout.color = colorFromUI( ui );
		layout.fillOpacity = 0;
		layout.visible = false;

	} else {

		applyTroikaFromUI( layout, ui, rect, 'fill' );
		layout.color = colorFromUI( ui );
		layout.fillOpacity = 0;
		layout.visible = false;

	}

	const layersMask = group.layers.mask;
	const charRect = rect && rect.w > 0
		? rect
		: {
			w: ( Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48 ) * 4,
			h: ( Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48 ) * 2,
		};

	const placeChars = ( carets ) => {

		layout.visible = false;
		layout.fillOpacity = 0;
		const full = String( ui.text != null ? ui.text : '' );
		const strIndexOfAnim = [];
		for ( let si = 0; si < full.length; ) {

			const cp = full.codePointAt( si );
			const ch = String.fromCodePoint( cp );
			const adv = ch.length;
			if ( ch !== '\n' && ch !== '\r' ) strIndexOfAnim.push( si );
			si += adv;

		}

		for ( let i = 0; i < chars.length; i ++ ) {

			const charGroup = new THREE.Group();
			charGroup.name = FCC_TEXTANIM_CHAR_PREFIX + i;
			charGroup.userData.__fccCharFlowerUI = cloneCharUI( ui, chars[ i ] );
			charGroup.userData.__fccTextAnimChar = true;
			charGroup.layers.mask = layersMask;

			let bx = 0;
			let by = 0;
			const si = strIndexOfAnim[ i ];
			if ( carets && si != null && carets.length >= ( si + 1 ) * 4 ) {

				const x0 = carets[ si * 4 ];
				const x1 = carets[ si * 4 + 1 ];
				const y0 = carets[ si * 4 + 2 ];
				const y1 = carets[ si * 4 + 3 ];
				bx = ( x0 + x1 ) * 0.5;
				by = ( y0 + y1 ) * 0.5;

			} else {

				const fs = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
				bx = ( i - ( chars.length - 1 ) * 0.5 ) * fs * 0.95;
				by = 0;

			}

			charGroup.userData.__fccCharBase = { x: bx, y: by, z: 0.01 };
			charGroup.position.set( bx, by, 0.01 );
			root.add( charGroup );

			// Full flower Effect stack per glyph (same path as static Text).
			syncUITextContent( charGroup, charRect );

			// Match parent layers; never pick preview glyphs (select real Text root).
			for ( let c = 0; c < charGroup.children.length; c ++ ) {

				const child = charGroup.children[ c ];
				if ( ! child ) continue;
				child.layers.mask = layersMask;
				child.raycast = function () {};

			}

		}

		root.userData.__fccReady = true;
		root.userData.__fccCharCount = chars.length;
		group.userData.__fccTextAnimBuiltSig = sig;
		group.userData.__fccTextAnimCharCount = chars.length;

	};

	if ( parentCarets ) {

		placeChars( parentCarets );
		return true;

	}

	layout.sync( () => {

		const info = layout.textRenderInfo;
		const carets = info && info.caretPositions;
		placeChars( carets );

	} );

	return false;

}

/**
 * Apply sampled poses from the Text's current `.anim` overrides
 * (TextAnimOverrides — progress / params / clip clock).
 */
export function applyTextAnim( group, rect ) {

	const ui = getFccUI( group );
	if ( ! ui || ui.type !== 'text' ) return;
	const anim = ensureTextAnimOnUI( ui );
	const opts = getTextAnimSampleOpts( group );
	if ( ! anim.enabled || ! textAnimNeedsCharSplit( anim, opts.values ) ) {

		clearTextAnimPreview( group );
		return;

	}

	ensureTextAnimPreview( group, rect );
	const root = group.getObjectByName( FCC_TEXTANIM_ROOT );
	if ( ! root || ! root.userData.__fccReady ) return;

	// Layout Troika is caret-only; never paint it. Re-hide originals every frame
	// (Troika sync callbacks can flip mesh.visible back on).
	const layout = root.getObjectByName( FCC_TEXTANIM_LAYOUT );
	if ( layout ) layout.visible = false;
	hideNonAnimChildren( group, true );

	const count = root.userData.__fccCharCount || 0;
	const sample = sampleTextAnim( anim, count, opts );
	const poses = sample.charPoses;
	if ( ! poses ) return;

	for ( let i = 0; i < count; i ++ ) {

		const charGroup = root.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + i );
		if ( ! charGroup ) continue;
		const pose = poses[ i ];
		if ( ! pose ) continue;
		const base = charGroup.userData.__fccCharBase || { x: 0, y: 0, z: 0.01 };

		charGroup.position.set( base.x + pose.offsetX, base.y + pose.offsetY, base.z );
		charGroup.rotation.set( pose.rotateX, pose.rotateY, pose.rotateZ );
		charGroup.scale.set( pose.scaleX, pose.scaleY, 1 );
		const op = pose.charProgress < 1 ? pose.opacity * pose.charProgress : pose.opacity;
		applyOpacityToCharGroup( charGroup, op );

	}

}

/**
 * Wipe axis metrics in **overlay / RT pixel space** (same as UI ortho: origin
 * bottom-left, x right, y up). Kept for Script nodes / older callers —
 * the primary wipe bounds come from TextLayerRT.computeWipeAlphaBounds.
 *
 * @deprecated
 * @param {THREE.Object3D} object UI Text root
 * @param {{camera?:THREE.Camera,resW?:number,resH?:number,debug?:boolean}} [opts]
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

	// Rect fallback: four corners in overlay pixel space (same as UI ortho world).
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

	}

	if ( worldPts.length < 2 ) {

		return { space: 'rt', minX: 0, maxX: resW, minY: 0, maxY: resH, fullFrame: true };

	}

	// Pixel UI ortho (left=0,right=W,bottom=0,top=H): localToWorld x/y ARE already
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

			}
			bw = maxX - minX;
			bh = maxY - minY;

		}
		if ( ! ( bw > 16 && bh > 8 ) ) {

			return { space: 'rt', minX: 0, maxX: resW, minY: 0, maxY: resH, fullFrame: true };

		}

	}


	return {
		space: 'rt',
		minX,
		maxX,
		minY,
		maxY,
	};

}

export function applyTextAnimsInScene( root ) {

	if ( ! root ) return;
	root.traverse( ( obj ) => {

		if ( ! isUIText( obj ) ) return;
		if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
		const ui = getFccUI( obj );
		if ( ! ui || ! ui.textAnim || ! ui.textAnim.enabled ) return;
		const rect = ui.rect || null;
		applyTextAnim( obj, rect );

	} );

}

export { ensureTextAnimOnUI };
