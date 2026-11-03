/**
 * FreeFilmCut UGUI Text — Troika dynamic SDF helpers.
 * Group holds fccUI; ephemeral Troika meshes are children (__fccText / __fccTextShadow).
 */

import * as THREE from 'three';
import { Text, configureTextBuilder } from 'troika-three-text';

// Default SDF margin is 1/16 of the glyph. Outline past that saturates and
// stops looking thicker. Reserve half the atlas cell so UI strokes can grow.
configureTextBuilder( { sdfMargin: 0.5 } );

import {
	DEFAULT_TEXT_FONT_URL,
	getFccUI,
	isUIText,
	getOwningCanvasRenderMode,
	RENDER_MODE_CAMERA,
	readLocalEulerDegrees,
	readLocalScale,
} from './UIConstants.js?v=fcc-ui-18';

export const FCC_TEXT_MESH = '__fccText';
export const FCC_TEXT_SHADOW = '__fccTextShadow';

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
	disposeTroikaChild( group, FCC_TEXT_MESH );
	disposeTroikaChild( group, FCC_TEXT_SHADOW );
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
			disposeTroikaChild( group, FCC_TEXT_MESH );
			disposeTroikaChild( group, FCC_TEXT_SHADOW );
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
export function applyTroikaFromUI( troika, ui, rect, role = 'fill' ) {

	const fontSize = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
	const align = ui.align || 'center';
	const vAlign = ui.verticalAlign || 'middle';

	const fontUrl = resolveFontUrl( ui );
	troika.font = fontUrl;
	troika.fontSize = fontSize;
	troika.anchorX = mapAnchorX( align );
	troika.anchorY = mapAnchorY( vAlign );
	troika.textAlign = align === 'left' || align === 'right' || align === 'justify'
		? align
		: 'center';
	troika.letterSpacing = Number( ui.letterSpacing ) || 0;
	troika.lineHeight = Number( ui.lineHeight ) > 0 ? Number( ui.lineHeight ) : 1.2;
	troika.maxWidth = rect && rect.w > 0 ? rect.w : ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
	troika.overflowWrap = 'break-word';
	troika.depthOffset = role === 'shadow' ? 0.1 : 0;
	troika.frustumCulled = false;

	if ( role === 'shadow' ) {

		const sh = ui.shadow || {};
		troika.text = ui.text != null ? String( ui.text ) : '';
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

		troika.text = ui.text != null ? String( ui.text ) : '';
		troika.color = colorToTroika( ui.color || '#ffffff' );
		troika.fillOpacity = 1;
		troika.position.set( 0, 0, 0 );

			const ol = ui.outline || {};
			if ( ol.enabled ) {

				// Troika treats a number as local units (same as fontSize: pixels).
				// Dividing by fontSize made the stroke stall after a few pixels.
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
	for ( const m of mats ) {

		if ( ! m ) continue;
		m.depthTest = mode === RENDER_MODE_CAMERA;
		m.depthWrite = false;
		m.toneMapped = false;
		m.transparent = true;

	}

}

function makeTroika( name ) {

	const t = new Text();
	t.name = name;
	t.frustumCulled = false;
	t.castShadow = false;
	t.receiveShadow = false;
	return t;

}

/**
 * Ensure Troika fill (+ optional shadow) children exist and match fccUI.
 * @param {THREE.Object3D} group text root (fccUI.type === 'text')
 * @param {{w:number,h:number}|null} [rect]
 */
function textSyncSignature( ui, rect, mode ) {

	const w = rect && rect.w != null ? rect.w : '';
	const h = rect && rect.h != null ? rect.h : '';
	return JSON.stringify( {
		text: ui.text, font: ui.font, fontBold: ui.fontBold, fontSize: ui.fontSize, bold: ui.bold,
		color: ui.color, letterSpacing: ui.letterSpacing, lineHeight: ui.lineHeight,
		align: ui.align, verticalAlign: ui.verticalAlign, outline: ui.outline, shadow: ui.shadow,
		w, h, mode,
	} );

}

export function syncUITextContent( group, rect = null ) {

	const ui = getFccUI( group );
	if ( ! ui || ui.type !== 'text' ) return;

	const mode = getOwningCanvasRenderMode( group );
	const fontUrl = resolveFontUrl( ui );
	const prevFontUrl = group.userData && group.userData.__fccTextFontUrl;
	const fontChanged = prevFontUrl !== fontUrl;

	const sig = textSyncSignature( ui, rect, mode );
	if ( ! fontChanged && group.userData.__fccTextSig === sig && group.getObjectByName( FCC_TEXT_MESH ) ) return;
	group.userData.__fccTextSig = sig;
	group.userData.__fccTextFontUrl = fontUrl;

	// Font URL change (e.g. dead blob → restored blob): dispose Troika so it cannot
	// keep an in-flight load against the old URL.
	if ( fontChanged ) {

		disposeTroikaChild( group, FCC_TEXT_MESH );
		disposeTroikaChild( group, FCC_TEXT_SHADOW );

	}

	let fill = group.getObjectByName( FCC_TEXT_MESH );
	if ( ! fill || ! fill.sync ) {

		if ( fill ) group.remove( fill );
		fill = makeTroika( FCC_TEXT_MESH );
		group.add( fill );

	}

	applyTroikaFromUI( fill, ui, rect, 'fill' );
	fill.layers.mask = group.layers.mask;
	fill.sync( () => {

		tuneMaterial( fill, mode );
		if ( ! fill.textRenderInfo ) {

			console.warn( '[FreeFilmCut] Troika text sync finished without textRenderInfo; font may have failed to load:', fontUrl );

		}

	} );

	const sh = ui.shadow || {};
	let shadow = group.getObjectByName( FCC_TEXT_SHADOW );

	if ( sh.enabled ) {

		if ( ! shadow || ! shadow.sync ) {

			if ( shadow ) group.remove( shadow );
			shadow = makeTroika( FCC_TEXT_SHADOW );
			group.add( shadow );
			// Keep shadow behind fill.
			group.remove( fill );
			group.add( shadow );
			group.add( fill );

		}

		applyTroikaFromUI( shadow, ui, rect, 'shadow' );
		shadow.layers.mask = group.layers.mask;
		shadow.visible = true;
		shadow.sync( () => tuneMaterial( shadow, mode ) );

	} else if ( shadow ) {

		shadow.visible = false;

	}

}

/**
 * Place text group in pixel/layout space.
 * Glyph size stays fontSize; Unity localScale/localEulerAngles apply on the group.
 */
export function applyTextTransform( group, rect ) {

	const ui = getFccUI( group ) || {};
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
