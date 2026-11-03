/**
 * FreeFilmCut UGUI Text — Troika dynamic SDF helpers.
 * Group holds fccUI (type=text). 花字 = multilayer Effect stack of ephemeral Troika children (__fccFlower_*); not a separate component.
 */

import * as THREE from 'three';
import { Text, configureTextBuilder } from 'troika-three-text';
import { createDerivedMaterial } from 'troika-three-utils';
// Troika default sdfMargin is 1/16. We used 0.5 before to grow UI strokes, but that
// inflated CJK glyph quads into heavy overlap; opaque alphaTest then killed SDF AA.
// 0.125 ≈ 2× default: enough headroom for modest outlines without dark junction scars.
// sdfGlyphSize 256: sharper CJK stems/corners (Troika issue #167); cost = atlas memory.
configureTextBuilder( { sdfMargin: 0.125, sdfGlyphSize: 256 } );

import {
	DEFAULT_TEXT_FONT_URL,
	getFccUI,
	isUIText,
	getOwningCanvasRenderMode,
	RENDER_MODE_CAMERA,
	readLocalEulerDegrees,
	readLocalScale,
} from './UIConstants.js?v=fcc-ui-102';
import {
	getEffectiveFlowerStyle,
	contentPrimaryColor,
	normalizeFillContent,
	hexToRgb01,
} from './FlowerStyle.js?v=fcc-ui-102';

export const FCC_TEXT_MESH = '__fccText';
export const FCC_TEXT_SHADOW = '__fccTextShadow';
export const FCC_FLOWER_PREFIX = '__fccFlower_';
export const FCC_FLOWER_FACE = '__fccFlower_face';

/**
 * URLs Troika can fetch directly. Project-relative paths (assets/fonts/…)
 * and absolute FS paths are NOT usable — reopen must rebuild blob: via ProjectFolder.
 * Session blob: is OK only after restoreUITextFontsFromProject / the font picker.
 */
function isUsableFontUrl( url ) {

	if ( ! url || typeof url !== 'string' ) return false;
	const u = url.trim();
	if ( ! u ) return false;
	if ( u.startsWith( 'blob:' ) || u.startsWith( 'data:' ) ) return true;
	if ( u.startsWith( 'http://' ) || u.startsWith( 'https://' ) ) return true;
	return false;

}

function disposeTroikaChild( group, name ) {

	const child = group.getObjectByName( name );
	if ( ! child ) return;
	group.remove( child );
	try {

		if ( typeof child.dispose === 'function' ) child.dispose();

	} catch ( e ) { /* ignore */ }

}

function resolveFontUrl( ui ) {

	if ( ui.bold && isUsableFontUrl( ui.fontBold ) ) return ui.fontBold;
	if ( isUsableFontUrl( ui.font ) ) return ui.font;
	if ( ui.font && ! isUsableFontUrl( ui.font ) ) {

		console.warn( '[FreeFilmCut] ignoring non-fetchable font URL (use「文件」picker):', ui.font );

	}

	return DEFAULT_TEXT_FONT_URL;

}

function revokeBlobUrlQuiet( url ) {

	if ( url && typeof url === 'string' && url.startsWith( 'blob:' ) ) {

		try {

			URL.revokeObjectURL( url );

		} catch ( e ) { /* ignore */ }

	}

}

function candidateFontRelPaths( ui ) {

	const paths = [];
	const push = ( p ) => {

		if ( ! p || typeof p !== 'string' ) return;
		const t = p.replace( /\\/g, '/' ).replace( /^\.?\/+/, '' );
		if ( ! t || paths.includes( t ) ) return;
		paths.push( t );

	};

	push( ui.fontProjectPath );
	if ( ui.font && typeof ui.font === 'string' ) {

		const f = ui.font.replace( /\\/g, '/' );
		if ( f.startsWith( 'assets/fonts/' ) || f.startsWith( 'fonts/' ) ) push( f );

	}

	if ( ui.fontFileName ) {

		const name = String( ui.fontFileName ).replace( /^.*[\\/]/, '' );
		if ( name ) {

			push( 'assets/fonts/' + name );
			push( 'fonts/' + name );

		}

	}

	return paths;

}

/**
 * Strip session-only blob: font URLs from a Three.js scene JSON (before save).
 * Keeps fontProjectPath / fontFileName so reopen can rebuild live blobs.
 *
 * IMPORTANT: Object3D.toJSON() assigns `object.userData = this.userData` by
 * reference. We MUST clone userData before mutating, or autosave/toJSON would
 * wipe live Troika blob: URLs and the next select/sync falls back to CDN.
 */
export function sanitizeUITextFontsInSceneJSON( sceneJSON ) {

	if ( ! sceneJSON || ! sceneJSON.object ) return sceneJSON;

	( function walk( node ) {

		if ( ! node || typeof node !== 'object' ) return;
		const ud = node.userData;
		const ui = ud && ud.fccUI;
		if ( ui && ui.type === 'text' ) {

			let cloned;
			try {

				cloned = JSON.parse( JSON.stringify( ud ) );

			} catch ( e ) {

				cloned = { ...ud, fccUI: { ...ui } };

			}

			node.userData = cloned;
			const ui2 = cloned.fccUI;
			if ( ui2.font && String( ui2.font ).startsWith( 'blob:' ) ) ui2.font = '';
			if ( ui2.fontBold && String( ui2.fontBold ).startsWith( 'blob:' ) ) ui2.fontBold = '';

		}

		if ( Array.isArray( node.children ) ) {

			for ( let i = 0; i < node.children.length; i ++ ) walk( node.children[ i ] );

		}

	} )( sceneJSON.object );

	return sceneJSON;

}

function applyRestoredFontToGroup( editor, group, ui, loaded ) {

	revokeBlobUrlQuiet( ui.font );
	revokeBlobUrlQuiet( ui.fontBold );
	const blob = new Blob( [ loaded.buffer ], { type: loaded.mime || 'font/ttf' } );
	const url = URL.createObjectURL( blob );
	ui.font = url;
	if ( ! ui.fontFileName ) ui.fontFileName = loaded.name;
	if ( loaded.relPath ) ui.fontProjectPath = loaded.relPath;
	editor._fccFontBytes.set( group.uuid, {
		name: loaded.name,
		buffer: loaded.buffer,
		mime: loaded.mime || 'font/ttf',
		blobUrl: url,
	} );
	// Drop any Troika children serialized by ObjectLoader / prior failed sync.
	disposeFlowerChildren( group );
	if ( group.userData ) {

		delete group.userData.__fccTextSig;
		delete group.userData.__fccTextFontUrl;

	}

	group.userData = { ...group.userData, fccUI: { ...ui } };
	delete group.userData.__fccTextSig;
	delete group.userData.__fccTextFontUrl;

}

/**
 * After fromJSON / open project: rebuild live blob: URLs for UI Text fonts
 * from the bound project folder (fontProjectPath / assets/fonts / fontFileName).
 * @param {object} editor
 * @param {THREE.Object3D} [root] defaults to editor.scene; pass parsed scene before setScene
 * @returns {Promise<{ restored: number, cleared: number, skipped: number }>}
 */
export async function restoreUITextFontsFromProject( editor, root = null ) {

	const result = { restored: 0, cleared: 0, skipped: 0 };
	const scene = root || ( editor && editor.scene );
	if ( ! editor || ! scene ) return result;

	if ( ! editor._fccFontBytes ) editor._fccFontBytes = new Map();

	const pf = editor.projectFolder;
	const canRead = !!(
		pf && typeof pf.hasFolder === 'function' && pf.hasFolder()
		&& typeof pf.readBinaryFile === 'function'
	);

	const texts = [];
	scene.traverse( ( o ) => {

		if ( isUIText( o ) ) texts.push( o );

	} );

	for ( const group of texts ) {

		const ui = getFccUI( group );
		if ( ! ui || ui.type !== 'text' ) continue;

		const font = ui.font != null ? String( ui.font ) : '';
		const isHttp = font.startsWith( 'http://' ) || font.startsWith( 'https://' );
		const isData = font.startsWith( 'data:' );
		const isBlob = font.startsWith( 'blob:' );
		const hasProjectHint = !!( ui.fontProjectPath || ui.fontFileName
			|| ( font.startsWith( 'assets/fonts/' ) || font.startsWith( 'fonts/' ) ) );

		// Live CDN / data with no project font — leave alone
		if ( ( isHttp || isData ) && ! hasProjectHint ) {

			result.skipped ++;
			continue;

		}

		// Same-session blob already rebuilt into _fccFontBytes — keep
		if ( isBlob && editor._fccFontBytes.has( group.uuid ) ) {

			const entry = editor._fccFontBytes.get( group.uuid );
			if ( entry && entry.blobUrl && entry.blobUrl === font ) {

				result.skipped ++;
				continue;

			}

		}

		// Always rebuild from disk when we have a project hint (never trust stale blob: from JSON).
		let loaded = null;
		if ( canRead && hasProjectHint ) {

			for ( const rel of candidateFontRelPaths( ui ) ) {

				const file = await pf.readBinaryFile( rel );
				if ( file && file.buffer && file.buffer.byteLength >= 100 ) {

					loaded = {
						...file,
						relPath: rel.startsWith( 'assets/' ) ? rel : ( 'assets/fonts/' + file.name ),
					};
					break;

				}

			}

		}

		if ( loaded ) {

			applyRestoredFontToGroup( editor, group, ui, loaded );
			const w = ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
			const h = ( ui.sizeDelta && ui.sizeDelta[ 1 ] ) || 100;
			syncUITextContent( group, { x: 0, y: 0, w, h } );
			result.restored ++;
			console.info(
				'[FreeFilmCut] restored UI font',
				group.name || group.uuid,
				'←',
				loaded.relPath,
				'bytes=',
				loaded.buffer.byteLength,
			);
			continue;

		}

		// Dead blob from project.json with no readable project file — CDN fallback
		if ( isBlob || ( hasProjectHint && canRead ) ) {

			if ( isBlob ) revokeBlobUrlQuiet( ui.font );
			if ( ui.fontBold && String( ui.fontBold ).startsWith( 'blob:' ) ) revokeBlobUrlQuiet( ui.fontBold );
			ui.font = '';
			if ( ui.fontBold && String( ui.fontBold ).startsWith( 'blob:' ) ) ui.fontBold = '';
			disposeFlowerChildren( group );
			if ( group.userData ) {

				delete group.userData.__fccTextSig;
				delete group.userData.__fccTextFontUrl;

			}

			group.userData = { ...group.userData, fccUI: { ...ui } };
			delete group.userData.__fccTextSig;
			const w = ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
			const h = ( ui.sizeDelta && ui.sizeDelta[ 1 ] ) || 100;
			syncUITextContent( group, { x: 0, y: 0, w, h } );
			result.cleared ++;
			console.warn(
				'[FreeFilmCut] UI Text font could not be restored (re-pick via「文件」+ Save with project folder):',
				group.name || group.uuid,
				ui.fontFileName || ui.fontProjectPath || font.slice( 0, 48 ),
			);
			continue;

		}

		result.skipped ++;

	}

	if ( result.restored || result.cleared ) {

		console.info( '[FreeFilmCut] restoreUITextFontsFromProject', result );

	}

	return result;

}

/**
 * Ensure in-memory custom fonts are copied into assets/fonts/ and fontProjectPath is set
 * before project.json save (so reopen can rebuild blob: URLs).
 * @returns {Promise<{ saved: number }>}
 */
export async function flushUITextFontsToProject( editor ) {

	const result = { saved: 0 };
	const pf = editor && editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) return result;
	if ( typeof pf.saveBlob !== 'function' ) return result;
	if ( ! editor.scene ) return result;
	if ( ! editor._fccFontBytes ) editor._fccFontBytes = new Map();

	const texts = [];
	editor.scene.traverse( ( o ) => {

		if ( isUIText( o ) ) texts.push( o );

	} );

	for ( const group of texts ) {

		const ui = getFccUI( group );
		if ( ! ui || ui.type !== 'text' ) continue;

		let entry = editor._fccFontBytes.get( group.uuid );
		if ( ( ! entry || ! entry.buffer ) && ui.font && String( ui.font ).startsWith( 'blob:' ) ) {

			// Try fetch live blob into memory
			try {

				const res = await fetch( ui.font );
				const buffer = await res.arrayBuffer();
				if ( buffer && buffer.byteLength >= 100 ) {

					entry = {
						name: ui.fontFileName || ( 'font_' + group.uuid.slice( 0, 8 ) + '.ttf' ),
						buffer,
						mime: 'font/ttf',
						blobUrl: ui.font,
					};
					editor._fccFontBytes.set( group.uuid, entry );

				}

			} catch ( e ) {

				/* ignore */

			}

		}

		if ( ! entry || ! entry.buffer ) continue;
		if ( ui.fontProjectPath ) continue;

		const safe = String( entry.name || 'font.ttf' ).replace( /[<>:"/\\|?*]+/g, '_' );
		try {

			const ok = await pf.saveBlob( 'assets/fonts', safe, entry.buffer );
			if ( ok ) {

				ui.fontProjectPath = 'assets/fonts/' + safe;
				ui.fontFileName = ui.fontFileName || safe;
				group.userData = { ...group.userData, fccUI: { ...ui } };
				result.saved ++;

			}

		} catch ( e ) {

			console.warn( '[FreeFilmCut] flush font failed', safe, e );

		}

	}

	if ( result.saved ) console.info( '[FreeFilmCut] flushUITextFontsToProject', result );
	return result;

}

function mapAnchorX( align ) {

	if ( align === 'left' ) return 'left';
	if ( align === 'right' ) return 'right';
	return 'center';

}

function mapAnchorY( verticalAlign ) {

	if ( verticalAlign === 'top' ) return 'top';
	if ( verticalAlign === 'bottom' ) return 'bottom';
	return 'middle';

}

function colorToTroika( hex, opacity = 1 ) {

	// Troika accepts CSS color string or number; opacity separate on outline.
	return hex || '#ffffff';

}

/**
 * Apply fccUI text fields + layout rect onto a Troika Text instance.
 * @param {import('troika-three-text').Text} troika
 * @param {object} ui
 * @param {{w:number,h:number}|null} rect
 * @param {'fill'|'shadow'} role
 */

function baseLayoutOnTroika( troika, ui, rect ) {

	const fontSize = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
	const align = ui.align || 'center';
	const vAlign = ui.verticalAlign || 'middle';

	troika.font = resolveFontUrl( ui );
	troika.fontSize = fontSize;
	if ( troika.sdfGlyphSize == null || troika.sdfGlyphSize < 256 ) troika.sdfGlyphSize = 256;
	troika.gpuAccelerateSDF = false; // Troika default true is experimental; CJK stems were gappy so force JS SDF.
	troika.anchorX = mapAnchorX( align );
	troika.anchorY = mapAnchorY( vAlign );
	troika.textAlign = align === 'left' || align === 'right' || align === 'justify'
		? align
		: 'center';
	troika.letterSpacing = Number( ui.letterSpacing ) || 0;
	troika.lineHeight = Number( ui.lineHeight ) > 0 ? Number( ui.lineHeight ) : 1.2;
	troika.maxWidth = rect && rect.w > 0 ? rect.w : ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
	troika.overflowWrap = 'break-word';
	troika.frustumCulled = false;
	troika.text = ui.text != null ? String( ui.text ) : '';

}

/**
 * Apply fccUI text fields + layout rect onto a Troika Text instance.
 * Legacy fill/shadow roles kept for callers; flower path uses applyFlowerPass.
 * @param {import('troika-three-text').Text} troika
 * @param {object} ui
 * @param {{w:number,h:number}|null} rect
 * @param {'fill'|'shadow'} role
 */
export function applyTroikaFromUI( troika, ui, rect, role = 'fill' ) {

	baseLayoutOnTroika( troika, ui, rect );
	troika.depthOffset = role === 'shadow' ? 0.1 : 0;

	if ( role === 'shadow' ) {

		const sh = ui.shadow || {};
		troika.color = colorToTroika( sh.color || '#000000' );
		troika.fillOpacity = sh.opacity != null ? Number( sh.opacity ) : 0.75;
		troika.outlineWidth = 0;
		troika.outlineOpacity = 0;
		troika.outlineBlur = Math.max( 0, Number( sh.blur ) || 0 );
		troika.outlineOffsetX = 0;
		troika.outlineOffsetY = 0;
		const ox = Number( sh.offsetX ) || 0;
		const oy = Number( sh.offsetY ) || 0;
		troika.position.set( ox, oy, - 0.01 );

	} else {

		troika.color = colorToTroika( ui.color || '#ffffff' );
		troika.fillOpacity = 1;
		troika.position.set( 0, 0, 0 );

		const ol = ui.outline || {};
		if ( ol.enabled ) {

			const px = Math.max( 0, Number( ol.width ) || 0 );
			troika.outlineWidth = px;
			troika.outlineColor = colorToTroika( ol.color || '#000000' );
			troika.outlineOpacity = ol.opacity != null ? Number( ol.opacity ) : 1;
			troika.outlineBlur = 0;
			troika.outlineOffsetX = 0;
			troika.outlineOffsetY = 0;

		} else {

			troika.outlineWidth = 0;
			troika.outlineOpacity = 0;
			troika.outlineBlur = 0;

		}

	}

}

function tuneMaterial( troika, mode ) {

	const mats = troika.material
		? ( Array.isArray( troika.material ) ? troika.material : [ troika.material ] )
		: [];
	// Keep Troika's soft SDF fringe (alphaTest=0). Overlap scars are mitigated by
	// smaller sdfMargin (see configureTextBuilder), not by hard-discarding AA.
	for ( const m of mats ) {

		if ( ! m ) continue;
		m.depthTest = mode === RENDER_MODE_CAMERA;
		m.depthWrite = false;
		m.toneMapped = false;
		m.transparent = true;
		m.alphaTest = 0;

	}

}

function makeTroika( name ) {

	const t = new Text();
	t.name = name;
	t.frustumCulled = false;
	t.castShadow = false;
	t.receiveShadow = false;
	// Match configureTextBuilder; explicit so preload / sync paths stay sharp.
	t.sdfGlyphSize = 256;
	// Troika default gpuAccelerateSDF=true is experimental; CJK stems were gappy so force JS SDF.
	t.gpuAccelerateSDF = false;
	return t;

}

function disposeFlowerChildren( group ) {

	disposeFaceMaskRT( group );

	const toRemove = [];
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( ! c || ! c.name ) continue;
		if ( c.name === FCC_TEXT_MESH || c.name === FCC_TEXT_SHADOW
			|| c.name.indexOf( FCC_FLOWER_PREFIX ) === 0 ) {

			toRemove.push( c );

		}

	}

	for ( const child of toRemove ) {

		group.remove( child );
		try {

			if ( typeof child.dispose === 'function' ) child.dispose();

		} catch ( e ) { /* ignore */ }

	}

}

/**
 * Face material when Troika returns [outline, face] multi-material.
 */
function resolveTroikaFaceMaterial( troika ) {

	const m = troika.material;
	if ( Array.isArray( m ) ) return m.length ? m[ m.length - 1 ] : null;
	return m || null;

}

/**
 * Leave gradient mode (or recover from a broken double-wrap) so solid/texture stay visible.
 */
function clearDerivedFillMaterial( troika, mode ) {

	// Unwrap gradient/texture derived materials so solid stays visible.
	// Do NOT wipe solely for fccInnerMask — that wrap is re-applied after sync; wiping
	// would replace Troika text materials with MeshBasic and break the next mask pass.
	const face = resolveTroikaFaceMaterial( troika );
	const hadGrad = !!( face && face.userData && ( face.userData.fccGradientMat || face.userData.fccTextureMat || face.userData.fccSolidExpandMat ) );
	const had = !!( troika.userData && ( troika.userData.fccHadGradient || troika.userData.fccHadTexture || troika.userData.fccHadSolidExpand ) );
	const base = troika._baseMaterial;
	const baseIsDerived = !!( base && base.userData && ( base.userData.fccGradientMat || base.userData.fccTextureMat || base.userData.fccSolidExpandMat ) );
	if ( hadGrad || had || baseIsDerived ) {

		troika.material = new THREE.MeshBasicMaterial( {
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide,
		} );
		if ( troika.userData ) {
			troika.userData.fccHadGradient = false;
			troika.userData.fccHadTexture = false;
			troika.userData.fccHadSolidExpand = false;
			troika.userData.fccHadInnerMask = false;
			troika.userData.fccHollowFill = false;
			delete troika.userData.fccInnerShadow;
		}

	}

	tuneMaterial( troika, mode );

}

/** @deprecated alias */
function clearGradientMaterial( troika, mode ) {

	clearDerivedFillMaterial( troika, mode );

}

const _fccTexLoader = new THREE.TextureLoader();
const _fccTexCache = new Map(); // path -> THREE.Texture

/** Coalesce Troika/texture async completions into one viewport redraw. */
let _flowerRefreshRaf = 0;
function requestFlowerViewportRefresh() {

	if ( _flowerRefreshRaf ) return;
	_flowerRefreshRaf = ( typeof requestAnimationFrame === 'function'
		? requestAnimationFrame
		: ( fn ) => setTimeout( fn, 16 ) )( () => {

		_flowerRefreshRaf = 0;
		try {

			const ed = typeof window !== 'undefined' ? window.editor : null;
			// Light redraw only. Never sceneGraphChanged (rebuilds Outliner / races selection).
			if ( ed && ed.signals && ed.signals.windowResize ) {

				ed.signals.windowResize.dispatch();

			}

		} catch ( e ) { /* ignore */ }

	} );

}
function loadFlowerTexture( path, onReady ) {

	if ( ! path ) {
		onReady( null );
		return;
	}
	if ( _fccTexCache.has( path ) ) {
		onReady( _fccTexCache.get( path ) );
		return;
	}
	_fccTexLoader.load(
		path,
		( tex ) => {
			tex.colorSpace = THREE.SRGBColorSpace;
			tex.wrapS = THREE.RepeatWrapping;
			tex.wrapT = THREE.RepeatWrapping;
			tex.needsUpdate = true;
			_fccTexCache.set( path, tex );
			onReady( tex );
		},
		undefined,
		( err ) => {
			console.warn( '[FreeFilmCut] flower texture load failed', path, err );
			onReady( null );
		},
	);

}


/**
 * Outer-stroke rewrite (fcc-ui-102): do NOT use Troika outlineWidth dual-pass.
 *
 * Single face material:
 *   uFccStrokeExpand — inflate glyph quads (vertex) + SDF edge (fragment)
 *   uFccContentExpand — plane UV over the expanded AABB (same value for outer stroke)
 * Gradient/texture sample the whole underlay; flower face covers the center.
 */
function hookFccStrokeExpandVertex( vertexShader ) {

	const re = /vec4\s+outlineBounds\s*=\s*vec4\(\s*bounds\.xy\s*-\s*uTroikaEdgeOffset\s*-\s*uTroikaBlurRadius\s*,\s*bounds\.zw\s*\+\s*uTroikaEdgeOffset\s*\+\s*uTroikaBlurRadius\s*\)\s*;/;
	if ( re.test( vertexShader ) ) {

		return vertexShader.replace( re, `vec4 outlineBounds = vec4(
  bounds.xy - uTroikaEdgeOffset - uTroikaBlurRadius - uFccStrokeExpand,
  bounds.zw + uTroikaEdgeOffset + uTroikaBlurRadius + uFccStrokeExpand
);` );

	}
	console.warn( '[FreeFilmCut] Troika outlineBounds expand hook missed' );
	return vertexShader;

}

function hookFccStrokeExpandFragment( fragmentShader ) {

	const re = /troikaGetEdgeAlpha\(\s*fragDistance\s*,\s*uTroikaEdgeOffset\s*,/;
	if ( re.test( fragmentShader ) ) {

		return fragmentShader.replace( re,
			'troikaGetEdgeAlpha(fragDistance, uTroikaEdgeOffset + uFccStrokeExpand,' );

	}
	console.warn( '[FreeFilmCut] Troika edgeAlpha expand hook missed' );
	return fragmentShader;

}

/** Plane UV over totalBounds ± uFccContentExpand (outer stroke = stroke width). */
function hookFccLayerPlaneUv( vertexShader ) {

	const inject = `
{
  vec4 fccCB = uTroikaTotalBounds;
  fccCB.xy -= uFccContentExpand;
  fccCB.zw += uFccContentExpand;
  vec2 fccSpan = max( fccCB.zw - fccCB.xy, vec2( 1e-5 ) );
  vFccGradUv = ( position.xy - fccCB.xy ) / fccSpan;
}
`;

	const re = /uv\s*=\s*\(\s*position\.xy\s*-\s*uTroikaTotalBounds\.xy\s*\)\s*\/\s*\(\s*uTroikaTotalBounds\.zw\s*-\s*uTroikaTotalBounds\.xy\s*\)\s*;/;
	if ( re.test( vertexShader ) ) {

		return vertexShader.replace( re, ( m ) => m + inject );

	}
	const re2 = /troika_uv_(\d+)\s*=\s*\(\s*troika_position_\1\.xy\s*-\s*uTroikaTotalBounds\.xy\s*\)\s*\/\s*\(\s*uTroikaTotalBounds\.zw\s*-\s*uTroikaTotalBounds\.xy\s*\)\s*;/;
	if ( re2.test( vertexShader ) ) {

		return vertexShader.replace( re2, ( m, id ) => m + `
{
  vec4 fccCB = uTroikaTotalBounds;
  fccCB.xy -= uFccContentExpand;
  fccCB.zw += uFccContentExpand;
  vec2 fccSpan = max( fccCB.zw - fccCB.xy, vec2( 1e-5 ) );
  vFccGradUv = ( troika_position_${ id }.xy - fccCB.xy ) / fccSpan;
}
` );

	}
	const reGlyph = /vTroikaGlyphUV\s*=\s*clippedXY\.xy\s*;/;
	if ( reGlyph.test( vertexShader ) ) {

		return vertexShader.replace( reGlyph, ( m ) => m + `
{
  vec4 fccB = aTroikaGlyphBounds;
  fccB.xz += uTroikaPositionOffset.x;
  fccB.yw -= uTroikaPositionOffset.y;
  vec2 fccLocal = mix( fccB.xy, fccB.zw, clippedXY );
  vec4 fccCB = uTroikaTotalBounds;
  fccCB.xy -= uFccContentExpand;
  fccCB.zw += uFccContentExpand;
  vec2 fccSpan = max( fccCB.zw - fccCB.xy, vec2( 1e-5 ) );
  vFccGradUv = ( fccLocal - fccCB.xy ) / fccSpan;
}
` );

	}
	console.warn( '[FreeFilmCut] Troika layer plane UV hook missed' );
	return vertexShader;

}

/**
 * Paint plane content into Troika fillRGBA (outline + face share Troika's transform).
 *
 * Inner stroke (strokeWidth>0 + fillOpacity=0): Troika then does
 *   if (fillRGBA.a==0) fillRGBA.rgb = strokeRGBA.rgb;
 * which would wipe gradient/texture and force solid strokeColor. Rewrite that
 * to copy painted rgb into strokeRGBA instead so the rim keeps plane content.
 */
function hookFccContentIntoTroikaFillRGBA( fragmentShader, contentGLSL ) {

	const re = /vec4\s+fillRGBA\s*=\s*gl_FragColor\s*;\s*fillRGBA\.a\s*\*=\s*uTroikaFillOpacity\s*;/;
	if ( ! re.test( fragmentShader ) ) {

		console.warn( '[FreeFilmCut] Troika fillRGBA hook missed; outline may stay solid' );
		return fragmentShader;

	}

	let out = fragmentShader.replace( re,
		'vec4 fillRGBA = gl_FragColor;\nfillRGBA.a *= uTroikaFillOpacity;\n' + contentGLSL );

	const reWipe = /if\s*\(\s*fillRGBA\.a\s*==\s*0\.0\s*\)\s*fillRGBA\.rgb\s*=\s*strokeRGBA\.rgb\s*;/;
	if ( reWipe.test( out ) ) {

		out = out.replace( reWipe,
			'if (fillRGBA.a == 0.0) strokeRGBA.rgb = fillRGBA.rgb;' );

	} else {

		console.warn( '[FreeFilmCut] Troika fillRGBA wipe hook missed; inner stroke may stay solid' );

	}

	return out;

}

/** Outer/inner stroke with gradient|texture: keep face hollow (ring only). */
function setTroikaFillOpacity( troika, opacity ) {

	if ( troika.userData && troika.userData.fccHollowFill ) {

		troika.fillOpacity = 0;
		return;

	}

	troika.fillOpacity = Number.isFinite( opacity ) ? opacity : 1;

}

function markTroikaHollowFill( troika, hollow ) {

	troika.userData = troika.userData || {};
	troika.userData.fccHollowFill = !! hollow;
	if ( hollow ) troika.fillOpacity = 0;

}

/**
 * Troika builds outline as Object.create(face). Drop stale outline so the next
 * material get() recreates it from the current gradient/texture derived face.
 */
function rebakeTroikaOutlineFromFace( troika ) {

	const face = resolveTroikaFaceMaterial( troika );
	if ( face && face._outlineMtl ) delete face._outlineMtl;
	// Touch getter so [outline, face] rebuilds from derived face when hasOutline().
	void troika.material;

}

const FCC_GLSL_PLANE_GRAD = `
#if !defined(IS_DEPTH_MATERIAL) && !defined(IS_DISTANCE_MATERIAL)
if (uFccGUse > 0.5) {
  float rad = radians(uFccGAngle);
  vec2 dir = vec2(cos(rad), sin(rad));
  float t = dot(vFccGradUv - vec2(0.5), dir) + 0.5;
  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);
  t = clamp(t, 0.0, 1.0);
  fillRGBA.rgb = mix(uFccGA, uFccGB, t);
}
#endif
`;

const FCC_GLSL_PLANE_TEX = `
#if !defined(IS_DEPTH_MATERIAL) && !defined(IS_DISTANCE_MATERIAL)
if (uFccTexUse > 0.5) {
  float rad = radians(uFccTexAngle);
  vec2 uv = vFccGradUv - vec2(0.5);
  float cs = cos(rad); float sn = sin(rad);
  uv = mat2(cs, -sn, sn, cs) * uv;
  uv = uv / max(uFccTexScale, 1e-5) + vec2(0.5);
  vec4 tc = texture2D(uFccTex, uv);
  fillRGBA.rgb = tc.rgb;
  fillRGBA.a *= tc.a;
}
#endif
`;

/**
 * Derived material: plane UV + optional fillRGBA paint + SDF/geometry stroke expand.
 */
function createFccPlaneContentMaterial( baseMat, opts ) {

	const contentGLSL = opts.contentGLSL || '';
	const uniforms = Object.assign( {
		uFccContentExpand: { value: 0 },
		uFccStrokeExpand: { value: 0 },
	}, opts.uniforms || {} );
	return createDerivedMaterial( baseMat, {
		chained: true,
		uniforms,
		fragmentDefs: `
varying vec2 vFccGradUv;
uniform float uFccContentExpand;
uniform float uFccStrokeExpand;
` + ( opts.fragmentDefs || '' ),
		fragmentColorTransform: opts.fragmentColorTransform || '',
		customRewriter( { vertexShader, fragmentShader } ) {

			if ( vertexShader.indexOf( 'varying vec2 vFccGradUv' ) < 0 ) {

				vertexShader = 'varying vec2 vFccGradUv;\n' + vertexShader;

			}
			if ( vertexShader.indexOf( 'uniform float uFccContentExpand' ) < 0 ) {

				vertexShader = 'uniform float uFccContentExpand;\n' + vertexShader;

			}
			if ( vertexShader.indexOf( 'uniform float uFccStrokeExpand' ) < 0 ) {

				vertexShader = 'uniform float uFccStrokeExpand;\n' + vertexShader;

			}
			// Fragment uniform comes only from fragmentDefs — do not prepend here
			// (createDerivedMaterial injects defs after rewriter → would redefine).
			vertexShader = hookFccStrokeExpandVertex( vertexShader );
			vertexShader = hookFccLayerPlaneUv( vertexShader );
			fragmentShader = hookFccStrokeExpandFragment( fragmentShader );
			if ( contentGLSL ) {

				fragmentShader = hookFccContentIntoTroikaFillRGBA( fragmentShader, contentGLSL );

			}
			return { vertexShader, fragmentShader };

		},
	} );

}

/** Solid outer stroke: inflate glyph via uFccStrokeExpand (no Troika outlineWidth). */
function applySolidExpandMaterial( troika, colorHex, opacity, mode, expand ) {

	const expandVal = Math.max( 0, Number( expand ) || 0 );
	troika.color = colorToTroika( colorHex || '#ffffff' );
	setTroikaFillOpacity( troika, opacity > 0 ? opacity : 1 );
	troika.userData = troika.userData || {};
	troika.userData.fccHadSolidExpand = true;
	troika.userData.fccHadGradient = false;
	troika.userData.fccHadTexture = false;
	troika.userData.fccContentExpand = expandVal;

	let baseMat = resolveTroikaFaceMaterial( troika );
	if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

		troika.material = new THREE.MeshBasicMaterial( {
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide,
		} );
		baseMat = resolveTroikaFaceMaterial( troika );

	}
	if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

		tuneMaterial( troika, mode );
		return;

	}

	if ( baseMat.userData && ( baseMat.userData.fccGradientMat || baseMat.userData.fccTextureMat ) ) {

		troika.material = new THREE.MeshBasicMaterial( {
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide,
		} );
		baseMat = resolveTroikaFaceMaterial( troika );
		if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

			tuneMaterial( troika, mode );
			return;

		}

	}

	if ( baseMat.userData && baseMat.userData.fccSolidExpandMat && baseMat.userData.fccSolidExpandUniforms ) {

		const u = baseMat.userData.fccSolidExpandUniforms;
		if ( u.uFccStrokeExpand && u.uFccContentExpand ) {

			u.uFccStrokeExpand.value = expandVal;
			u.uFccContentExpand.value = expandVal;
			setTroikaFillOpacity( troika, opacity > 0 ? opacity : 1 );
			tuneMaterial( troika, mode );
			return;

		}

	}

	const uniforms = {
		uFccContentExpand: { value: expandVal },
		uFccStrokeExpand: { value: expandVal },
	};
	let derived;
	try {

		derived = createFccPlaneContentMaterial( baseMat, { uniforms } );

	} catch ( e ) {

		console.warn( '[FreeFilmCut] solid expand material failed', e );
		clearDerivedFillMaterial( troika, mode );
		troika.color = colorToTroika( colorHex || '#ffffff' );
		return;

	}
	derived.userData = derived.userData || {};
	derived.userData.fccSolidExpandMat = true;
	derived.userData.fccSolidExpandUniforms = uniforms;
	derived.transparent = true;
	derived.depthWrite = false;
	derived.toneMapped = false;
	derived.depthTest = mode === RENDER_MODE_CAMERA;
	Object.defineProperty( derived, 'isTroikaTextMaterial', { value: true } );
	if ( derived._outlineMtl ) delete derived._outlineMtl;
	troika.material = derived;
	tuneMaterial( troika, mode );

}

function applyTextureMaterial( troika, content, opacity, mode, contentExpand ) {

	const c = normalizeFillContent( content );
	const texInfo = c.texture || {};
	const path = texInfo.path || '';
	const angleVal = Number.isFinite( Number( texInfo.angle ) ) ? Number( texInfo.angle ) : 0;
	const scaleVal = Number.isFinite( Number( texInfo.scale ) ) && Number( texInfo.scale ) > 0
		? Number( texInfo.scale ) : 1;
	const texAlpha = Number.isFinite( Number( texInfo.alpha ) ) ? Number( texInfo.alpha ) : 1;
	const op = Math.max( 0, Math.min( 1, ( Number.isFinite( opacity ) ? opacity : 1 ) * texAlpha ) );

	troika.color = '#ffffff';
	setTroikaFillOpacity( troika, op > 0 ? op : 1 );
	const expandVal = Math.max( 0, Number( contentExpand ) || 0 );
	troika.userData = troika.userData || {};
	troika.userData.fccHadTexture = true;
	troika.userData.fccHadGradient = false;
	troika.userData.fccContentExpand = expandVal;

	const applyWithMap = ( map ) => {

		// Async texture load must not revive face fill on stroke rings.
		setTroikaFillOpacity( troika, op > 0 ? op : 1 );
		let baseMat = resolveTroikaFaceMaterial( troika );
		if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {
			troika.material = new THREE.MeshBasicMaterial( {
				color: 0xffffff,
				transparent: true,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide,
			} );
			baseMat = resolveTroikaFaceMaterial( troika );
		}
		if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {
			tuneMaterial( troika, mode );
			requestFlowerViewportRefresh();
			return;
		}
		// Drop prior gradient/solid-expand wrap; rebuild texture wrap.
		if ( baseMat.userData && ( baseMat.userData.fccGradientMat || baseMat.userData.fccSolidExpandMat || ( baseMat.userData.fccTextureMat && ! map ) ) ) {
			troika.material = new THREE.MeshBasicMaterial( {
				color: 0xffffff,
				transparent: true,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide,
			} );
			baseMat = resolveTroikaFaceMaterial( troika );
			if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {
				tuneMaterial( troika, mode );
				requestFlowerViewportRefresh();
				return;
			}
		}
		if ( baseMat.userData && baseMat.userData.fccTextureMat && baseMat.userData.fccTextureUniforms ) {
			const u = baseMat.userData.fccTextureUniforms;
			const canUpdate = ( u.uFccContentExpand && u.uFccStrokeExpand ) || expandVal <= 0;
			if ( canUpdate ) {
				if ( map ) u.uFccTex.value = map;
				u.uFccTexUse.value = map ? 1 : 0;
				u.uFccTexAngle.value = angleVal;
				u.uFccTexScale.value = scaleVal;
				if ( u.uFccContentExpand ) u.uFccContentExpand.value = expandVal;
				if ( u.uFccStrokeExpand ) u.uFccStrokeExpand.value = expandVal;
				setTroikaFillOpacity( troika, op > 0 ? op : 1 );
				tuneMaterial( troika, mode );
				requestFlowerViewportRefresh();
				return;
			}
			// Need contentExpand uniform for stroke UVs — fall through and rebuild.
			troika.material = new THREE.MeshBasicMaterial( {
				color: 0xffffff,
				transparent: true,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide,
			} );
			baseMat = resolveTroikaFaceMaterial( troika );
			if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {
				tuneMaterial( troika, mode );
				requestFlowerViewportRefresh();
				return;
			}
		}
		if ( ! map ) {
			// No map yet — solid fallback tint
			troika.color = colorToTroika( contentPrimaryColor( c ) || '#ffffff' );
			tuneMaterial( troika, mode );
			requestFlowerViewportRefresh();
			return;
		}
		const uniforms = {
			uFccTex: { value: map },
			uFccTexUse: { value: 1 },
			uFccTexAngle: { value: angleVal },
			uFccTexScale: { value: scaleVal },
			uFccContentExpand: { value: expandVal },
			uFccStrokeExpand: { value: expandVal },
		};
		let derived;
		try {
			derived = createFccPlaneContentMaterial( baseMat, {
				uniforms,
				fragmentDefs: `
uniform sampler2D uFccTex;
uniform float uFccTexUse;
uniform float uFccTexAngle;
uniform float uFccTexScale;
`,
				contentGLSL: FCC_GLSL_PLANE_TEX,
				fragmentColorTransform: `
if (uFccTexUse > 0.5) {
  float rad = radians(uFccTexAngle);
  vec2 uv = vFccGradUv - vec2(0.5);
  float cs = cos(rad); float sn = sin(rad);
  uv = mat2(cs, -sn, sn, cs) * uv;
  uv = uv / max(uFccTexScale, 1e-5) + vec2(0.5);
  vec4 tc = texture2D(uFccTex, uv);
  gl_FragColor.rgb = tc.rgb;
  gl_FragColor.a *= tc.a;
}
`,
			} );
		} catch ( e ) {
			console.warn( '[FreeFilmCut] texture material failed, solid fallback', e );
			clearDerivedFillMaterial( troika, mode );
			troika.color = colorToTroika( contentPrimaryColor( c ) || '#ffffff' );
			return;
		}
		derived.userData = derived.userData || {};
		derived.userData.fccTextureMat = true;
		derived.userData.fccTextureUniforms = uniforms;
		derived.transparent = true;
		derived.depthWrite = false;
		derived.toneMapped = false;
		derived.depthTest = mode === RENDER_MODE_CAMERA;
		Object.defineProperty( derived, 'isTroikaTextMaterial', { value: true } );
		troika.material = derived;
		// Drop stale Object.create outline so next hasOutline() rebuilds from this derived.
		if ( derived._outlineMtl ) delete derived._outlineMtl;
		tuneMaterial( troika, mode );
		requestFlowerViewportRefresh();

	};

	if ( ! path ) {
		applyWithMap( null );
		return;
	}
	loadFlowerTexture( path, ( map ) => {
		applyWithMap( map );
	} );

}

/**
 * Patch Troika material for linear gradient fill.
 * Plane UV via createFccPlaneContentMaterial (hooks Troika totalBounds uv) —
 * shared with outer-stroke outline channel. Troika text has no material.map, so
 * Three does not define vUv. Sampling vUv either fails the program or stays at (0,0) → always color0 (black) → face looks
 * gone on a dark editor background. Instead we emit vFccGradUv from glyph bounds
 * / uTroikaTotalBounds (same space Troika uses for block UV).
 * Must mark derived as isTroikaTextMaterial so Text's setter does not double-wrap.
 */
function applyGradientMaterial( troika, content, opacity, mode, contentExpand ) {

	const c = normalizeFillContent( content );
	const g = c.gradient;
	const rgbA = hexToRgb01( g.colors[ 0 ] );
	const rgbB = hexToRgb01( g.colors[ 1 ] );
	const angle = Number( g.angle );
	const stop0 = Number( g.stops[ 0 ] );
	const stop1 = Number( g.stops[ 1 ] );
	const angleVal = Number.isFinite( angle ) ? angle : 90;
	const stop0Val = Number.isFinite( stop0 ) ? stop0 : 0;
	const stop1Val = Number.isFinite( stop1 ) ? stop1 : 1;

	// White diffuse so a disabled-gradient frame is not stuck on color0 black.
	const expandVal = Math.max( 0, Number( contentExpand ) || 0 );
	troika.color = '#ffffff';
	setTroikaFillOpacity( troika, Number.isFinite( opacity ) ? opacity : 1 );
	troika.userData = troika.userData || {};
	troika.userData.fccHadGradient = true;
	troika.userData.fccContentExpand = expandVal;

	let baseMat = resolveTroikaFaceMaterial( troika );
	if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

		// Force Troika to build a real text material, then retry once.
		troika.material = new THREE.MeshBasicMaterial( {
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide,
		} );
		baseMat = resolveTroikaFaceMaterial( troika );

	}

	if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

		tuneMaterial( troika, mode );
		return;

	}

	// Drop stale wraps (broken vUv / solid-expand / texture) before building gradient.
	if ( baseMat.userData && (
		( baseMat.userData.fccGradientMat && ! baseMat.userData.fccGradUv )
		|| baseMat.userData.fccSolidExpandMat
		|| baseMat.userData.fccTextureMat
	) ) {

		troika.material = new THREE.MeshBasicMaterial( {
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide,
		} );
		baseMat = resolveTroikaFaceMaterial( troika );
		if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

			tuneMaterial( troika, mode );
			return;

		}

	}

	if ( baseMat.userData && baseMat.userData.fccGradientMat && baseMat.userData.fccGradUv ) {

		const u = baseMat.userData.fccGradientUniforms;
		const canUpdate = u && ( ( u.uFccContentExpand && u.uFccStrokeExpand ) || expandVal <= 0 );
		if ( canUpdate && u ) {

			u.uFccGA.value.setRGB( rgbA[ 0 ], rgbA[ 1 ], rgbA[ 2 ] );
			u.uFccGB.value.setRGB( rgbB[ 0 ], rgbB[ 1 ], rgbB[ 2 ] );
			u.uFccGAngle.value = angleVal;
			u.uFccGStop0.value = stop0Val;
			u.uFccGStop1.value = stop1Val;
			u.uFccGUse.value = 1;
			if ( u.uFccContentExpand ) u.uFccContentExpand.value = expandVal;
			if ( u.uFccStrokeExpand ) u.uFccStrokeExpand.value = expandVal;
			setTroikaFillOpacity( troika, Number.isFinite( opacity ) ? opacity : 1 );
			tuneMaterial( troika, mode );
			return;

		}

		// Stroke needs contentExpand uniform — rebuild derived material.
		troika.material = new THREE.MeshBasicMaterial( {
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide,
		} );
		baseMat = resolveTroikaFaceMaterial( troika );
		if ( ! baseMat || ! baseMat.isTroikaTextMaterial ) {

			tuneMaterial( troika, mode );
			return;

		}

	}

	const uniforms = {
		uFccGA: { value: new THREE.Color().setRGB( rgbA[ 0 ], rgbA[ 1 ], rgbA[ 2 ] ) },
		uFccGB: { value: new THREE.Color().setRGB( rgbB[ 0 ], rgbB[ 1 ], rgbB[ 2 ] ) },
		uFccGAngle: { value: angleVal },
		uFccGStop0: { value: stop0Val },
		uFccGStop1: { value: stop1Val },
		uFccGUse: { value: 1 },
		uFccContentExpand: { value: expandVal },
		uFccStrokeExpand: { value: expandVal },
	};

	let derived;
	try {

		derived = createFccPlaneContentMaterial( baseMat, {
			uniforms,
			fragmentDefs: `
uniform vec3 uFccGA;
uniform vec3 uFccGB;
uniform float uFccGAngle;
uniform float uFccGStop0;
uniform float uFccGStop1;
uniform float uFccGUse;
`,
			contentGLSL: FCC_GLSL_PLANE_GRAD,
			fragmentColorTransform: `
if (uFccGUse > 0.5) {
  float rad = radians(uFccGAngle);
  vec2 dir = vec2(cos(rad), sin(rad));
  float t = dot(vFccGradUv - vec2(0.5), dir) + 0.5;
  t = (t - uFccGStop0) / max(uFccGStop1 - uFccGStop0, 1e-5);
  t = clamp(t, 0.0, 1.0);
  gl_FragColor.rgb = mix(uFccGA, uFccGB, t);
}
`,
		} );

	} catch ( e ) {

		console.warn( '[FreeFilmCut] gradient material failed, solid fallback', e );
		clearGradientMaterial( troika, mode );
		return;

	}

	derived.userData = derived.userData || {};
	derived.userData.fccGradientMat = true;
	derived.userData.fccGradUv = true;
	derived.userData.fccGradientUniforms = uniforms;
	derived.transparent = true;
	derived.depthWrite = false;
	derived.toneMapped = false;
	derived.depthTest = mode === RENDER_MODE_CAMERA;
	// Critical: Text.material setter only keeps a custom mat if isTroikaTextMaterial.
	// Otherwise it treats our derived as a new base and Troika wraps again → invisible glyphs.
	Object.defineProperty( derived, 'isTroikaTextMaterial', { value: true } );
	troika.material = derived;
	if ( derived._outlineMtl ) delete derived._outlineMtl;
	tuneMaterial( troika, mode );

}

/**
 * Inner-shadow clip via STENCIL (fcc-ui-102), not Face RT + gl_FragCoord.
 *
 * Why RT failed on Overlay: letterbox viewport + DPR + nested renderer.render()
 * inside onBeforeRender left the mask empty (or UV-misaligned), so alpha*=0 and
 * the shadow vanished. Troika already discard()s outside the glyph (edgeAlpha==0),
 * so Face can write stencil=1 only inside the fill; inner shadow tests Equal 1.
 * Requires WebGLRenderer({ stencil: true }).
 */
const FCC_STENCIL_REF = 1;

/**
 * Per-object beforeRender extras live in a WeakMap, NOT in userData:
 * scenes are auto-saved with structuredClone → IndexedDB, and any function
 * alive inside userData throws `DataCloneError: function could not be cloned`,
 * which silently kills autosave for the whole project.
 */
const extraBeforeRenderByObject = new WeakMap();

/**
 * Troika.Text defines onBeforeRender on the prototype (sync + _prepareForRender).
 * Assigning troika.onBeforeRender = fn replaces that and breaks SDF uniforms —
 * inner shadow then draws empty / wrong. Always chain through Text.prototype.
 */
function chainTroikaBeforeRender( troika, extraFn ) {

	if ( ! troika ) return;
	extraBeforeRenderByObject.set( troika, extraFn );
	troika.userData = troika.userData || {};
	if ( troika.userData.fccChainedBeforeRender ) return;

	troika.userData.fccChainedBeforeRender = true;
	troika.onBeforeRender = function fccChainedBeforeRender( renderer, scene, camera, geometry, material, group ) {

		Text.prototype.onBeforeRender.call( this, renderer, scene, camera, geometry, material, group );
		const extra = extraBeforeRenderByObject.get( this );
		if ( typeof extra === 'function' ) {

			try {

				extra( this, renderer, material );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] troika beforeRender hook', e );

			}

		}

	};

}

function eachTroikaMaterial( troika, fn ) {

	if ( ! troika ) return;
	const mats = troika.material
		? ( Array.isArray( troika.material ) ? troika.material : [ troika.material ] )
		: [];
	for ( let i = 0; i < mats.length; i ++ ) {

		if ( mats[ i ] ) fn( mats[ i ] );

	}

}

function applyStencilWriteToMaterial( m ) {

	if ( ! m ) return;
	m.stencilWrite = true;
	m.stencilWriteMask = 0xff;
	m.stencilRef = FCC_STENCIL_REF;
	m.stencilFunc = THREE.AlwaysStencilFunc;
	m.stencilFuncMask = 0xff;
	m.stencilFail = THREE.KeepStencilOp;
	m.stencilZFail = THREE.KeepStencilOp;
	m.stencilZPass = THREE.ReplaceStencilOp;

}

function applyStencilTestToMaterial( m ) {

	if ( ! m ) return;
	m.stencilWrite = false;
	m.stencilWriteMask = 0x00;
	m.stencilRef = FCC_STENCIL_REF;
	m.stencilFunc = THREE.EqualStencilFunc;
	m.stencilFuncMask = 0xff;
	m.stencilFail = THREE.KeepStencilOp;
	m.stencilZFail = THREE.KeepStencilOp;
	m.stencilZPass = THREE.KeepStencilOp;

}

/** Face pass: write stencil ref where fragments survive Troika discard. */
export function ensureFaceStencilWrite( faceMesh ) {

	if ( ! faceMesh ) return;
	eachTroikaMaterial( faceMesh, applyStencilWriteToMaterial );
	// Re-apply every draw to the *material argument* (outline multi-pass safe),
	// without clobbering Troika's prototype onBeforeRender.
	chainTroikaBeforeRender( faceMesh, function ( _troika, _renderer, material ) {

		applyStencilWriteToMaterial( material );

	} );

}

/** Other flower layers: do not touch stencil. */
function clearStencilState( troika ) {

	eachTroikaMaterial( troika, ( m ) => {

		m.stencilWrite = false;
		m.stencilFunc = THREE.AlwaysStencilFunc;
		m.stencilFail = THREE.KeepStencilOp;
		m.stencilZFail = THREE.KeepStencilOp;
		m.stencilZPass = THREE.KeepStencilOp;

	} );
	if ( troika ) {

		extraBeforeRenderByObject.delete( troika );

	}

}

/**
 * Clip inner-shadow pass to Face via stencil (no RT / no gl_FragCoord UV).
 * @param {import('troika-three-text').Text} troika
 * @param {THREE.Object3D} group text root
 * @param {'overlay'|'camera'} mode
 */
function applyInnerShadowFaceMask( troika, group, mode ) {

	if ( ! troika || ! group ) return;

	troika.userData = troika.userData || {};
	troika.userData.fccHadInnerMask = true;
	troika.userData.fccInnerStencil = true;

	// Drop any legacy RT-mask derived material from fcc-ui-102..69.
	let baseMat = troika.material;
	if ( Array.isArray( baseMat ) ) {

		baseMat = baseMat.length ? baseMat[ baseMat.length - 1 ] : null;

	}

	if ( baseMat && baseMat.userData && baseMat.userData.fccFaceMaskRT ) {

		troika.material = new THREE.MeshBasicMaterial( {
			color: 0xffffff,
			transparent: true,
			depthWrite: false,
			toneMapped: false,
			side: THREE.DoubleSide,
		} );

	}

	const faceMesh = group.getObjectByName( FCC_FLOWER_FACE );
	if ( faceMesh ) ensureFaceStencilWrite( faceMesh );

	eachTroikaMaterial( troika, applyStencilTestToMaterial );

	// CRITICAL: chain Troika prototype — do NOT replace onBeforeRender outright.
	chainTroikaBeforeRender( troika, function ( _t, _renderer, material ) {

		applyStencilTestToMaterial( material );
		const face = group.getObjectByName( FCC_FLOWER_FACE );
		if ( face ) ensureFaceStencilWrite( face );

	} );

	tuneMaterial( troika, mode );
	eachTroikaMaterial( troika, applyStencilTestToMaterial );

}

/** Legacy RT helpers kept as no-ops so dispose paths stay safe. */
function disposeFaceMaskRT( group ) {

	if ( ! group || ! group.userData ) return;
	if ( group.userData.__fccFaceMaskRT ) {

		try {

			group.userData.__fccFaceMaskRT.dispose();

		} catch ( e ) { /* ignore */ }

		delete group.userData.__fccFaceMaskRT;

	}
	delete group.userData.__fccFaceMaskFrameId;

}

function applyContentToTroika( troika, content, layerAlpha, mode, contentExpand ) {

	const c = normalizeFillContent( content );
	const solidA = c.solid && c.solid.alpha != null ? Number( c.solid.alpha ) : 1;
	const layerA = layerAlpha != null ? Number( layerAlpha ) : 1;
	const opacity = Math.max( 0, Math.min( 1,
		( Number.isFinite( layerA ) ? layerA : 1 ) * ( Number.isFinite( solidA ) ? solidA : 1 ) ) );
	const expand = Math.max( 0, Number( contentExpand ) || 0 );

	if ( c.renderType === 'gradient' ) {

		applyGradientMaterial( troika, c, opacity, mode, expand );
		return;

	}

	if ( c.renderType === 'texture' ) {

		applyTextureMaterial( troika, c, opacity, mode, expand );
		return;

	}

	markTroikaHollowFill( troika, false );
	if ( expand > 0 ) {

		applySolidExpandMaterial( troika, contentPrimaryColor( c ) || '#ffffff', opacity, mode, expand );
		return;

	}

	clearDerivedFillMaterial( troika, mode );
	troika.color = colorToTroika( contentPrimaryColor( c ) || '#ffffff' );
	setTroikaFillOpacity( troika, opacity > 0 ? opacity : 1 );
	tuneMaterial( troika, mode );

}

function applyFlowerPass( troika, ui, rect, pass, z, mode ) {

		baseLayoutOnTroika( troika, ui, rect );
		troika.depthOffset = 0;
		troika.outlineWidth = 0;
		troika.outlineOpacity = 0;
		troika.outlineBlur = 0;
		troika.outlineOffsetX = 0;
		troika.outlineOffsetY = 0;
		// Reset Troika inner-stroke (strokeWidth) so outer/face/shadow passes do not leak it.
		troika.strokeWidth = 0;
		troika.strokeOpacity = 0;
		markTroikaHollowFill( troika, false );
		troika.position.set( 0, 0, z );

			if ( pass.kind === 'shadow' ) {

			const sh = pass.layer;
			const w = Math.max( 0, Number( sh.width ) || 0 );
			const shAlpha = sh.alpha != null ? Number( sh.alpha ) : 1;
			troika.position.set( Number( sh.offsetX ) || 0, Number( sh.offsetY ) || 0, z );
			troika.outlineBlur = Math.max( 0, Number( sh.diffuse ) || 0 );
			troika.outlineWidth = 0;
			// Soft edge via outline pass — outlineOpacity must be > 0 when diffuse > 0.
			troika.outlineOpacity = shAlpha;
			// width = TMP Underlay Dilate (SDF expand), same path as outer stroke.
			applyContentToTroika( troika, sh.content, shAlpha, mode, w );
			// CapCut often uses alpha=0 shadow fill with only nested strokes visible.
			troika.visible = shAlpha > 1e-4;
			return;

		}

		// Inner shadow: AFTER face. Offset + blur, then Face-SDF mask (no halo outside).
		if ( pass.kind === 'inner' ) {

			const sh = pass.layer;
			const w = Math.max( 0, Number( sh.width ) || 0 );
			const ox = Number( sh.offsetX ) || 0;
			const oy = Number( sh.offsetY ) || 0;
			troika.position.set( ox, oy, z );
			troika.outlineBlur = Math.max( 0, Number( sh.diffuse ) || 0 );
			troika.outlineWidth = 0;
			const col = contentPrimaryColor( sh.content );
			troika.outlineColor = colorToTroika( col );
			troika.outlineOpacity = sh.alpha != null ? Number( sh.alpha ) : 1;
			applyContentToTroika( troika, sh.content, sh.alpha, mode, w );
			// Mask applied after sync (Troika rebuilds materials on sync).
			troika.userData = troika.userData || {};
			troika.userData.fccInnerShadow = { ox, oy };
			return;

		}

		if ( pass.kind === 'stroke' ) {

			const st = pass.layer;
			const w = Math.max( 0, Number( st.width ) || 0 );
			const col = contentPrimaryColor( st.content );
			const side = st.side === 'inner' ? 'inner' : 'outer';
			const stContent = normalizeFillContent( st.content );
			const stDerived = stContent.renderType === 'gradient' || stContent.renderType === 'texture';
			// Path1: stroke nested on shadow — same offset as parent shadow silhouette.
			if ( pass.shadowParent ) {

				troika.position.set(
					Number( pass.shadowParent.offsetX ) || 0,
					Number( pass.shadowParent.offsetY ) || 0,
					z
				);

			}
			if ( side === 'inner' ) {
				// True inset ring: Troika strokeWidth (inner stroke API), NOT negative outlineWidth.
				// Negative outlineWidth shrinks the outline-material silhouette so stroke color
				// fills the glyph body and the face only peeks as a thin outer rim (looks inverted).
				troika.outlineWidth = 0;
				troika.outlineOpacity = 0;
				troika.outlineBlur = 0;
				// Cap inner stroke vs fontSize: CJK thin stems blob when stroke ≥ ~half stem.
				// Soft clamp ~8% of fontSize (still allows bold artistic look without eating 文/本).
				const fontSize = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
				const maxInner = fontSize * 0.08;
				const wi = Math.min( w, maxInner );
				if ( w > maxInner + 0.01 ) {
					console.warn( '[FreeFilmCut] inner stroke clamped', w, '→', wi, '(max 8% of fontSize)' );
				}
				troika.strokeWidth = wi;
				// White strokeColor so plane content (not solid tint) drives the rim.
				troika.strokeColor = stDerived ? '#ffffff' : colorToTroika( col );
				troika.strokeOpacity = st.alpha != null ? Number( st.alpha ) : 1;
				if ( stDerived ) markTroikaHollowFill( troika, true );
				applyContentToTroika( troika, st.content, st.alpha, mode );
				markTroikaHollowFill( troika, true ); // hollow fill → only the inward stroke band
				return;
			}
			// Outer stroke = single face mat, SDF+geometry expand (no Troika outlineWidth).
			// Plane UV / gradient / texture cover the whole underlay; face covers center.
			troika.outlineWidth = 0;
			troika.outlineOpacity = 0;
			troika.outlineBlur = 0;
			applyContentToTroika( troika, st.content, st.alpha, mode, w );
			if ( stDerived ) troika.color = '#ffffff';
			return;

		}

		// face
		const fill = pass.layer;
		applyContentToTroika( troika, fill.content, fill.alpha, mode );

	}


/**
 * CapCut Path1: expand a shadow into nested stroke passes (share shadow offset)
 * then the shadow face. Nested strokes draw wide→narrow (reverse of CapCut array
 * when it stores narrow→wide). Stroke UV = that stroke's own expanded bounds.
 * Blur stays on the shadow face only (outline-before-blur); stroke-after-blur needs RT.
 */
function pushShadowPasses( passes, sh, nameBase ) {

	const nested = ( sh && Array.isArray( sh.strokes ) ) ? sh.strokes : [];
	const enabled = nested.filter( ( st ) => st && st.enable !== false );
	const parent = {
		offsetX: Number( sh.offsetX ) || 0,
		offsetY: Number( sh.offsetY ) || 0,
	};
	for ( let i = enabled.length - 1; i >= 0; i -- ) {

		const st = enabled[ i ];
		passes.push( {
			kind: 'stroke',
			name: nameBase + '_nst_' + i,
			layer: st,
			shadowParent: parent,
		} );

	}
	passes.push( { kind: 'shadow', name: nameBase, layer: sh } );

}

function buildFlowerPasses( style ) {

	const passes = [];
	const stack = ( style && Array.isArray( style.stack ) && style.stack.length )
		? style.stack
		: null;
	if ( ! stack ) {

		// Defensive: normalizeFlowerStyle always supplies stack; keep legacy path.
		const shadows = ( style.shadows || [] ).filter( ( s ) => s && s.enable );
		const strokes = ( style.strokes || [] ).filter( ( s ) => s && s.enable );
		const outerStrokes = strokes.filter( ( s ) => s.side !== 'inner' );
		const innerStrokes = strokes.filter( ( s ) => s.side === 'inner' );
		const inners = ( style.innerShadows || [] ).filter( ( s ) => s && s.enable );
		for ( let i = 0; i < shadows.length; i ++ ) {

			pushShadowPasses( passes, shadows[ i ], FCC_FLOWER_PREFIX + 'shadow_' + i );

		}
		for ( let i = 0; i < outerStrokes.length; i ++ ) {

			passes.push( { kind: 'stroke', name: FCC_FLOWER_PREFIX + 'stroke_o_' + i, layer: outerStrokes[ i ] } );

		}
		passes.push( {
			kind: 'face',
			name: FCC_FLOWER_FACE,
			layer: style.fill || { alpha: 1, content: { renderType: 'solid', solid: { color: '#ffffff', alpha: 1 } } },
		} );
		for ( let i = 0; i < innerStrokes.length; i ++ ) {

			passes.push( { kind: 'stroke', name: FCC_FLOWER_PREFIX + 'stroke_i_' + i, layer: innerStrokes[ i ] } );

		}
		for ( let i = 0; i < inners.length; i ++ ) {

			passes.push( { kind: 'inner', name: FCC_FLOWER_PREFIX + 'inner_' + i, layer: inners[ i ] } );

		}
		return passes;

	}

	// Canonical: style.stack order is back → front (any interleaving).
	for ( let i = 0; i < stack.length; i ++ ) {

		const e = stack[ i ];
		if ( ! e || ! e.kind ) continue;
		if ( e.kind === 'face' ) {

			passes.push( {
				kind: 'face',
				name: FCC_FLOWER_FACE,
				layer: style.fill || { alpha: 1, content: { renderType: 'solid', solid: { color: '#ffffff', alpha: 1 } } },
			} );
			continue;

		}
		if ( e.enable === false ) continue;
		const id = ( typeof e.id === 'string' && e.id ) ? e.id : ( 'i' + i );
		if ( e.kind === 'stroke' ) {

			passes.push( { kind: 'stroke', name: FCC_FLOWER_PREFIX + 'fx_' + id, layer: e } );

		} else if ( e.kind === 'shadow' ) {

			pushShadowPasses( passes, e, FCC_FLOWER_PREFIX + 'fx_' + id );

		} else if ( e.kind === 'inner' ) {

			passes.push( { kind: 'inner', name: FCC_FLOWER_PREFIX + 'fx_' + id, layer: e } );

		}

	}

	return passes;

}

function flowerSyncSignature( ui, rect, mode, style ) {

	const w = rect && rect.w != null ? rect.w : '';
	const h = rect && rect.h != null ? rect.h : '';
	return JSON.stringify( {
		text: ui.text, font: ui.font, fontBold: ui.fontBold, fontSize: ui.fontSize, bold: ui.bold,
		color: ui.color, letterSpacing: ui.letterSpacing, lineHeight: ui.lineHeight,
		align: ui.align, verticalAlign: ui.verticalAlign,
		outline: ui.outline, shadow: ui.shadow,
		flowerStyle: ui.flowerStyle || null,
		sdfGlyphSize: 256, // bump forces Troika rebuild when atlas res changes
		sdfMargin: 0.125, // fcc-ui-102 smaller margin → less CJK quad overlap
		defaultFont: 'msyh', // fcc-ui-102 try Microsoft YaHei
		gpuAccelerateSDF: 0, // fcc-ui-102 force JS SDF; bump rebuilds CJK atlases
		innerFaceMask: 5, // fcc-ui-102 chain Troika onBeforeRender + material-arg stencil
		strokeContentPaint: 6,
		effectStack: 1, // fcc-ui-102 free-order Effect stack
		shadowWidth: 1, // fcc-ui-102 shadow dilate/width
		cjkOpaqueAlphaTest: 0, // fcc-ui-102 drop hard alphaTest; restore SDF AA
		shadowNestedStrokes: 1, // fcc-ui-102 Path1: strokes on shadow pass
		style, w, h, mode,
	} );

}

/**
 * Ensure Troika flower Effect-stack children match fccUI.
 * Order: outer shadows → outer strokes → face → inner strokes → inner shadows.
 * Does NOT rely on Troika single outline/shadow for flowerStyle.
 * @param {THREE.Object3D} group text root (fccUI.type === 'text')
 * @param {{w:number,h:number}|null} [rect]
 */
/**
 * True when every __fccFlower_* child is a live troika Text. A scene loaded from
 * disk restores them as plain Mesh + MeshBasicMaterial (ObjectLoader has no troika
 * type), so they must be re-created instead of reused.
 */
function flowerChildrenAreTroika( group ) {

	let found = false;
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( ! c || ! c.name || c.name.indexOf( FCC_FLOWER_PREFIX ) !== 0 ) continue;
		found = true;
		if ( typeof c.text !== 'string' ) return false;

	}
	return found;

}

export function syncUITextContent( group, rect = null ) {

	// Char-anim preview Groups stash flower UI on __fccCharFlowerUI (not fccUI),
	// so they are not mistaken for selectable UI Text by isUIText / sidebar.
	const ui = getFccUI( group ) || ( group && group.userData && group.userData.__fccCharFlowerUI ) || null;
	if ( ! ui || ui.type !== 'text' ) return;

	// While char-anim preview is on, keep this group's original flower meshes hidden
	// even if Troika sync callbacks try to restore mesh.visible.
	const hideOrig = !!( group.userData && group.userData.__fccTextAnimHideOriginals );

	const mode = getOwningCanvasRenderMode( group );
	const fontUrl = resolveFontUrl( ui );
	const prevFontUrl = group.userData && group.userData.__fccTextFontUrl;
	const fontChanged = prevFontUrl !== fontUrl;
	const style = getEffectiveFlowerStyle( ui );

	const sig = flowerSyncSignature( ui, rect, mode, style );
	// A saved scene reloads flower children as plain Meshes: three's ObjectLoader
	// does not know troika Text, so it rebuilds them as Mesh + MeshBasicMaterial and
	// the glyphs vanish. The userData signature survives the round-trip, so trusting
	// it alone made loaded projects render an empty quad (and made any text-anim pass
	// see an empty RT). Only short-circuit when the children are real troika Texts.
	const flowerIsTroika = flowerChildrenAreTroika( group );
	if ( ! fontChanged && group.userData.__fccTextSig === sig && flowerIsTroika ) return;

	group.userData.__fccTextSig = sig;
	group.userData.__fccTextFontUrl = fontUrl;

	// Force a full rebuild when the existing meshes are load-time stubs.
	let wipeFlower = fontChanged || ! flowerIsTroika;
	if ( ! wipeFlower ) {

		for ( let i = 0; i < group.children.length; i ++ ) {

			const c = group.children[ i ];
			if ( ! c || ! c.name || c.name.indexOf( FCC_FLOWER_PREFIX ) !== 0 ) continue;
			const mats = c.material
				? ( Array.isArray( c.material ) ? c.material : [ c.material ] )
				: [];
			for ( let j = 0; j < mats.length; j ++ ) {

				const m = mats[ j ];
				if ( m && m.userData && m.userData.fccFaceMaskRT ) {

					wipeFlower = true;
					break;

				}

			}
			if ( wipeFlower ) break;
			if ( c.userData && c.userData.fccHadInnerMask && ! c.userData.fccInnerStencil ) {

				wipeFlower = true;
				break;

			}

		}

	}

	if ( wipeFlower ) {

		disposeFlowerChildren( group );

	}


	const passes = buildFlowerPasses( style );
	const existing = {};
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( c && c.name ) existing[ c.name ] = c;

	}

	const keep = new Set( passes.map( ( p ) => p.name ) );
	for ( const name of Object.keys( existing ) ) {

		if ( name === FCC_TEXT_MESH || name === FCC_TEXT_SHADOW
			|| ( name.indexOf( FCC_FLOWER_PREFIX ) === 0 && ! keep.has( name ) ) ) {

			const child = existing[ name ];
			group.remove( child );
			try {

				if ( typeof child.dispose === 'function' ) child.dispose();

			} catch ( e ) { /* ignore */ }

			delete existing[ name ];

		}

	}

	// Re-add in order (back → front)
	const zStep = 0.001;
	for ( let i = 0; i < passes.length; i ++ ) {

		const pass = passes[ i ];
		let mesh = existing[ pass.name ];
		if ( ! mesh || ! mesh.sync ) {

			if ( mesh ) {

				group.remove( mesh );
				try {

					if ( typeof mesh.dispose === 'function' ) mesh.dispose();

				} catch ( e ) { /* ignore */ }

			}

			mesh = makeTroika( pass.name );
			existing[ pass.name ] = mesh;

		}

		if ( mesh.parent === group ) group.remove( mesh );
		group.add( mesh );

		const z = ( i - passes.length ) * zStep;
		applyFlowerPass( mesh, ui, rect, pass, z, mode );
		mesh.layers.mask = group.layers.mask;
		// Non-face Effect passes: skip picking. Troika outline/shadow bounds are larger
		// than glyphs and were covering sibling Image/Box under the same Canvas.
		if ( pass.kind !== 'face' ) mesh.raycast = function () {};
		else mesh.raycast = THREE.Mesh.prototype.raycast;
		// Face fill can be hidden to inspect outer stroke / shadow underlays.
		// CapCut Path1: shadow with alpha=0 is a nested-stroke carrier only — keep invisible.
		const faceHidden = pass.kind === 'face' && pass.layer && pass.layer.visible === false;
		const shadowCarrierHidden = pass.kind === 'shadow' && pass.layer
			&& ( pass.layer.alpha != null ? Number( pass.layer.alpha ) : 1 ) <= 1e-4;
		mesh.visible = ! hideOrig && ! faceHidden && ! shadowCarrierHidden;

		const passMode = mode;
		mesh.sync( () => {

			if ( pass.kind === 'face' || pass.kind === 'stroke'
				|| pass.kind === 'shadow' || pass.kind === 'inner' ) {

				const content = pass.layer && pass.layer.content;
				const layerA = pass.layer && pass.layer.alpha;
				if ( content ) {

					// Re-apply after sync so solid/texture recover and gradient can wrap a real Troika mat
					const syncExpand = (
						( pass.kind === 'stroke' && pass.layer && pass.layer.side !== 'inner' )
						|| pass.kind === 'shadow'
						|| pass.kind === 'inner'
					) ? Math.max( 0, Number( pass.layer.width ) || 0 ) : 0;
					const stContentSync = normalizeFillContent( content );
					const stDerivedSync = stContentSync.renderType === 'gradient' || stContentSync.renderType === 'texture';
					// Inner stroke only: hollow fill. Outer stroke paints full underlay (like shadow).
					if ( pass.kind === 'stroke' && pass.layer && pass.layer.side === 'inner' && stDerivedSync ) {
						markTroikaHollowFill( mesh, true );
					}
					if ( pass.kind === 'stroke' && pass.layer && pass.layer.side !== 'inner' ) {
						mesh.outlineWidth = 0;
						mesh.outlineOpacity = 0;
						mesh.outlineBlur = 0;
					}
					applyContentToTroika( mesh, content, layerA, passMode, syncExpand );
					if ( pass.kind === 'stroke' && pass.layer && pass.layer.side === 'inner' ) {
						const w = Math.max( 0, Number( pass.layer.width ) || 0 );
						mesh.outlineWidth = 0;
						mesh.outlineOpacity = 0;
						mesh.strokeWidth = w;
						mesh.strokeColor = stDerivedSync ? '#ffffff' : colorToTroika( contentPrimaryColor( content ) );
						mesh.strokeOpacity = layerA != null ? Number( layerA ) : 1;
						markTroikaHollowFill( mesh, true );
					} else if ( pass.kind === 'stroke' && pass.layer && pass.layer.side !== 'inner' ) {
						mesh.outlineWidth = 0;
						mesh.outlineOpacity = 0;
						mesh.outlineBlur = 0;
						if ( stDerivedSync ) mesh.color = '#ffffff';
						markTroikaHollowFill( mesh, false );
						if ( pass.shadowParent ) {
							mesh.position.set(
								Number( pass.shadowParent.offsetX ) || 0,
								Number( pass.shadowParent.offsetY ) || 0,
								mesh.position.z
							);
						}
					} else if ( pass.kind === 'shadow' && pass.layer ) {
						mesh.outlineWidth = 0;
						mesh.outlineBlur = Math.max( 0, Number( pass.layer.diffuse ) || 0 );
						mesh.outlineOpacity = layerA != null ? Number( layerA ) : 1;
						mesh.visible = ! hideOrig && ( layerA != null ? Number( layerA ) : 1 ) > 1e-4;
					}
					if ( pass.kind === 'face' ) {
						ensureFaceStencilWrite( mesh );
						mesh.visible = ! hideOrig && !( pass.layer && pass.layer.visible === false );
					} else if ( pass.kind !== 'inner' ) {
						clearStencilState( mesh );
					}
					if ( pass.kind === 'inner' ) {
						const sh = pass.layer || {};
						const ox = Number( sh.offsetX ) || 0;
						const oy = Number( sh.offsetY ) || 0;
						const col = contentPrimaryColor( content );
						mesh.outlineColor = colorToTroika( col );
						mesh.outlineOpacity = layerA != null ? Number( layerA ) : 1;
						mesh.outlineBlur = Math.max( 0, Number( sh.diffuse ) || 0 );
						mesh.outlineWidth = 0;
						mesh.position.set( ox, oy, mesh.position.z );
						applyInnerShadowFaceMask( mesh, group, passMode );
					}

				} else {

					tuneMaterial( mesh, passMode );

				}

			} else {

				tuneMaterial( mesh, passMode );

			}

			if ( pass.kind === 'face' && ! mesh.textRenderInfo ) {

				console.warn( '[FreeFilmCut] Troika text sync finished without textRenderInfo; font may have failed to load:', fontUrl );

			}

			// Troika sync + material derives finish after the sidebar's sceneGraphChanged
			// render — request another frame so 贴图/描边 show without needing a nudge.
			requestFlowerViewportRefresh();

		} );

	}

}


export function applyTextTransform( group, rect ) {

	const ui = getFccUI( group ) || {};
	// Resolved overlay/RT pixel rect (bottom-left origin) for wipe metrics fallback.
	ui.rect = { x: rect.x, y: rect.y, w: rect.w, h: rect.h };
	ui._layoutRect = ui.rect;
	group.position.set( rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, group.position.z || 0 );
	const [ sx, sy, sz ] = readLocalScale( ui );
	const [ ex, ey, ez ] = readLocalEulerDegrees( ui );
	group.scale.set( sx, sy, sz );
	group.rotation.set(
		THREE.MathUtils.degToRad( ex ),
		THREE.MathUtils.degToRad( ey ),
		THREE.MathUtils.degToRad( ez ),
	);
	syncUITextContent( group, rect );

}

/**
 * Nested placement under a pixel-sized parent (Image PlaneGeometry in pixels).
 * Offset in pixels; localScale / localEulerAngles only (no 1/parentSize hack).
 */
export function applyTextTransformNested( group, rect, parentRect ) {

	const ui = getFccUI( group ) || {};
	const offsetX = ( rect.x + rect.w * 0.5 ) - ( parentRect.x + parentRect.w * 0.5 );
	const offsetY = ( rect.y + rect.h * 0.5 ) - ( parentRect.y + parentRect.h * 0.5 );
	group.position.set( offsetX, offsetY, group.position.z || 0 );
	const [ sx, sy, sz ] = readLocalScale( ui );
	const [ ex, ey, ez ] = readLocalEulerDegrees( ui );
	group.scale.set( sx, sy, sz );
	group.rotation.set(
		THREE.MathUtils.degToRad( ex ),
		THREE.MathUtils.degToRad( ey ),
		THREE.MathUtils.degToRad( ez ),
	);
	syncUITextContent( group, rect );

}
