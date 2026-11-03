/**
 * FreeFilmCut UGUI Text — Troika dynamic SDF helpers.
 * Group holds fccUI (type=text). 花字 = multilayer Effect stack of ephemeral Troika children (__fccFlower_*); not a separate component.
 */

import * as THREE from 'three';
import { Text, configureTextBuilder } from 'troika-three-text';
import { createDerivedMaterial } from 'troika-three-utils';
// Default SDF margin is 1/16 of the glyph. Outline past that saturates and
// stops looking thicker. Reserve half the atlas cell so UI strokes can grow.
// Default Troika sdfGlyphSize is 64 — too soft for CJK thin stems + inner stroke.
// 128 keeps single-channel SDF corners round but sharpens stems / stroke bands.
configureTextBuilder( { sdfMargin: 0.5, sdfGlyphSize: 128 } );

import {
	DEFAULT_TEXT_FONT_URL,
	getFccUI,
	isUIText,
	getOwningCanvasRenderMode,
	RENDER_MODE_CAMERA,
	readLocalEulerDegrees,
	readLocalScale,
} from './UIConstants.js?v=fcc-ui-64';
import {
	getEffectiveFlowerStyle,
	contentPrimaryColor,
	normalizeFillContent,
	hexToRgb01,
} from './FlowerStyle.js?v=fcc-ui-64';

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
	if ( troika.sdfGlyphSize == null || troika.sdfGlyphSize < 128 ) troika.sdfGlyphSize = 128;
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
	// Match configureTextBuilder; explicit so preload / sync paths stay sharp.
	t.sdfGlyphSize = 128;
	return t;

}

function disposeFlowerChildren( group ) {

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
	const hadGrad = !!( face && face.userData && ( face.userData.fccGradientMat || face.userData.fccTextureMat ) );
	const had = !!( troika.userData && ( troika.userData.fccHadGradient || troika.userData.fccHadTexture ) );
	const base = troika._baseMaterial;
	const baseIsDerived = !!( base && base.userData && ( base.userData.fccGradientMat || base.userData.fccTextureMat ) );
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
			troika.userData.fccHadInnerMask = false;
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

function applyTextureMaterial( troika, content, opacity, mode ) {

	const c = normalizeFillContent( content );
	const texInfo = c.texture || {};
	const path = texInfo.path || '';
	const angleVal = Number.isFinite( Number( texInfo.angle ) ) ? Number( texInfo.angle ) : 0;
	const scaleVal = Number.isFinite( Number( texInfo.scale ) ) && Number( texInfo.scale ) > 0
		? Number( texInfo.scale ) : 1;
	const texAlpha = Number.isFinite( Number( texInfo.alpha ) ) ? Number( texInfo.alpha ) : 1;
	const op = Math.max( 0, Math.min( 1, ( Number.isFinite( opacity ) ? opacity : 1 ) * texAlpha ) );

	troika.color = '#ffffff';
	troika.fillOpacity = op > 0 ? op : 1;
	troika.userData = troika.userData || {};
	troika.userData.fccHadTexture = true;
	troika.userData.fccHadGradient = false;

	const applyWithMap = ( map ) => {

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
		// Drop prior gradient wrap; rebuild texture wrap.
		if ( baseMat.userData && ( baseMat.userData.fccGradientMat || ( baseMat.userData.fccTextureMat && ! map ) ) ) {
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
		if ( baseMat.userData && baseMat.userData.fccTextureMat && baseMat.userData.fccTextureUniforms ) {
			const u = baseMat.userData.fccTextureUniforms;
			if ( map ) u.uFccTex.value = map;
			u.uFccTexUse.value = map ? 1 : 0;
			u.uFccTexAngle.value = angleVal;
			u.uFccTexScale.value = scaleVal;
			tuneMaterial( troika, mode );
			return;
		}
		if ( ! map ) {
			// No map yet — solid fallback tint
			troika.color = colorToTroika( contentPrimaryColor( c ) || '#ffffff' );
			tuneMaterial( troika, mode );
			return;
		}
		const uniforms = {
			uFccTex: { value: map },
			uFccTexUse: { value: 1 },
			uFccTexAngle: { value: angleVal },
			uFccTexScale: { value: scaleVal },
		};
		let derived;
		try {
			derived = createDerivedMaterial( baseMat, {
				chained: true,
				uniforms,
				vertexDefs: `
varying vec2 vFccGradUv;
`,
				vertexTransform: `
{
  vec4 fccB = aTroikaGlyphBounds;
  fccB.xz += uTroikaPositionOffset.x;
  fccB.yw -= uTroikaPositionOffset.y;
  vec2 fccLocal = mix( fccB.xy, fccB.zw, position.xy );
  vec2 fccSpan = max( uTroikaTotalBounds.zw - uTroikaTotalBounds.xy, vec2( 1e-5 ) );
  vFccGradUv = ( fccLocal - uTroikaTotalBounds.xy ) / fccSpan;
}
`,
				fragmentDefs: `
varying vec2 vFccGradUv;
uniform sampler2D uFccTex;
uniform float uFccTexUse;
uniform float uFccTexAngle;
uniform float uFccTexScale;
`,
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
		tuneMaterial( troika, mode );

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
 * Troika text has no material.map, so Three does not define vUv. Sampling vUv
 * either fails the program or stays at (0,0) → always color0 (black) → face looks
 * gone on a dark editor background. Instead we emit vFccGradUv from glyph bounds
 * / uTroikaTotalBounds (same space Troika uses for block UV).
 * Must mark derived as isTroikaTextMaterial so Text's setter does not double-wrap.
 */
function applyGradientMaterial( troika, content, opacity, mode ) {

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
	troika.color = '#ffffff';
	troika.fillOpacity = Number.isFinite( opacity ) ? opacity : 1;
	troika.userData = troika.userData || {};
	troika.userData.fccHadGradient = true;

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

	// Pre-fcc-ui-59 wraps used broken vUv — drop them and rebuild.
	if ( baseMat.userData && baseMat.userData.fccGradientMat && ! baseMat.userData.fccGradUv ) {

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
		if ( u ) {

			u.uFccGA.value.setRGB( rgbA[ 0 ], rgbA[ 1 ], rgbA[ 2 ] );
			u.uFccGB.value.setRGB( rgbB[ 0 ], rgbB[ 1 ], rgbB[ 2 ] );
			u.uFccGAngle.value = angleVal;
			u.uFccGStop0.value = stop0Val;
			u.uFccGStop1.value = stop1Val;
			u.uFccGUse.value = 1;

		}

		tuneMaterial( troika, mode );
		return;

	}

	const uniforms = {
		uFccGA: { value: new THREE.Color().setRGB( rgbA[ 0 ], rgbA[ 1 ], rgbA[ 2 ] ) },
		uFccGB: { value: new THREE.Color().setRGB( rgbB[ 0 ], rgbB[ 1 ], rgbB[ 2 ] ) },
		uFccGAngle: { value: angleVal },
		uFccGStop0: { value: stop0Val },
		uFccGStop1: { value: stop1Val },
		uFccGUse: { value: 1 },
	};

	let derived;
	try {

		derived = createDerivedMaterial( baseMat, {
			chained: true,
			uniforms,
			vertexDefs: `
varying vec2 vFccGradUv;
`,
			// Outer vertexTransform runs before Troika's; position.xy is still the unit quad.
			// Replicate Troika totalBounds UV so the fragment does not need Three's vUv.
			vertexTransform: `
{
  vec4 fccB = aTroikaGlyphBounds;
  fccB.xz += uTroikaPositionOffset.x;
  fccB.yw -= uTroikaPositionOffset.y;
  vec2 fccLocal = mix( fccB.xy, fccB.zw, position.xy );
  vec2 fccSpan = max( uTroikaTotalBounds.zw - uTroikaTotalBounds.xy, vec2( 1e-5 ) );
  vFccGradUv = ( fccLocal - uTroikaTotalBounds.xy ) / fccSpan;
}
`,
			fragmentDefs: `
varying vec2 vFccGradUv;
uniform vec3 uFccGA;
uniform vec3 uFccGB;
uniform float uFccGAngle;
uniform float uFccGStop0;
uniform float uFccGStop1;
uniform float uFccGUse;
`,
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
	tuneMaterial( troika, mode );

}

/**
 * Clip an inner-shadow Troika pass to the Face glyph: keep only fragments that
 * still land inside the unshifted SDF (same atlas). Mesh is translated by
 * (ox, oy) for the offset+blur look; we sample face coverage at UV shifted back
 * so anything outside the face contour is discarded (no halo leak).
 */
function applyInnerShadowFaceMask( troika, ox, oy, mode ) {

	const oxN = Number( ox ) || 0;
	const oyN = Number( oy ) || 0;
	troika.userData = troika.userData || {};
	troika.userData.fccHadInnerMask = true;
	troika.userData.fccInnerShadow = { ox: oxN, oy: oyN };

	// Inner shadow uses outlineBlur -> Troika returns [outline, face]. Never assign arrays.
	const faceMat = resolveTroikaFaceMaterial( troika );
	if ( ! faceMat || ! faceMat.isTroikaTextMaterial ) {

		tuneMaterial( troika, mode );
		return;

	}

	if ( faceMat.userData && faceMat.userData.fccInnerMask && faceMat.userData.fccInnerMaskUniforms ) {

		faceMat.userData.fccInnerMaskUniforms.uFccInnerOx.value = oxN;
		faceMat.userData.fccInnerMaskUniforms.uFccInnerOy.value = oyN;
		faceMat.userData.fccInnerMaskUniforms.uFccInnerMask.value = 1;
		tuneMaterial( troika, mode );
		return;

	}

	const uniforms = {
		uFccInnerOx: { value: oxN },
		uFccInnerOy: { value: oyN },
		uFccInnerMask: { value: 1 },
	};

	let derived;
	try {

		derived = createDerivedMaterial( faceMat, {
			chained: true,
			uniforms,
			fragmentDefs: `
uniform float uFccInnerOx;
uniform float uFccInnerOy;
uniform float uFccInnerMask;
`,
			fragmentColorTransform: `
if (uFccInnerMask > 0.5) {
  vec2 dim = max(vTroikaGlyphDimensions, vec2(1e-5));
  vec2 faceUV = vTroikaGlyphUV + vec2(uFccInnerOx, uFccInnerOy) / dim;
  vec2 clampedFaceUV = clamp(faceUV, 0.5 / uTroikaSDFGlyphSize, 1.0 - 0.5 / uTroikaSDFGlyphSize);
  float faceDist = troikaGlyphUvToDistance(clampedFaceUV);
  faceDist += clampedFaceUV == faceUV ? 0.0 :
    length((faceUV - clampedFaceUV) * vTroikaGlyphDimensions);
  float faceA = troikaGetEdgeAlpha(faceDist, 0.0, troikaGetAADist());
  gl_FragColor.a *= faceA;
  if (gl_FragColor.a < 0.001) discard;
}
`,
		} );

	} catch ( e ) {

		console.warn( '[FreeFilmCut] inner-shadow face mask failed', e );
		tuneMaterial( troika, mode );
		return;

	}

	derived.userData = derived.userData || {};
	derived.userData.fccInnerMask = true;
	derived.userData.fccInnerMaskUniforms = uniforms;
	if ( faceMat.userData ) {

		if ( faceMat.userData.fccGradientMat ) derived.userData.fccGradientMat = true;
		if ( faceMat.userData.fccGradUv ) derived.userData.fccGradUv = true;
		if ( faceMat.userData.fccGradientUniforms ) derived.userData.fccGradientUniforms = faceMat.userData.fccGradientUniforms;
		if ( faceMat.userData.fccTextureMat ) derived.userData.fccTextureMat = true;
		if ( faceMat.userData.fccTextureUniforms ) derived.userData.fccTextureUniforms = faceMat.userData.fccTextureUniforms;

	}
	derived.transparent = true;
	derived.depthWrite = false;
	derived.toneMapped = false;
	derived.depthTest = mode === RENDER_MODE_CAMERA;
	Object.defineProperty( derived, 'isTroikaTextMaterial', { value: true } );
	troika.material = derived;
	tuneMaterial( troika, mode );

}

function applyContentToTroika( troika, content, layerAlpha, mode ) {

	const c = normalizeFillContent( content );
	const solidA = c.solid && c.solid.alpha != null ? Number( c.solid.alpha ) : 1;
	const layerA = layerAlpha != null ? Number( layerAlpha ) : 1;
	const opacity = Math.max( 0, Math.min( 1,
		( Number.isFinite( layerA ) ? layerA : 1 ) * ( Number.isFinite( solidA ) ? solidA : 1 ) ) );

	if ( c.renderType === 'gradient' ) {

		applyGradientMaterial( troika, c, opacity, mode );
		return;

	}

	if ( c.renderType === 'texture' ) {

		applyTextureMaterial( troika, c, opacity, mode );
		return;

	}

	clearDerivedFillMaterial( troika, mode );
	troika.color = colorToTroika( contentPrimaryColor( c ) || '#ffffff' );
	troika.fillOpacity = opacity > 0 ? opacity : 1;
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
	troika.position.set( 0, 0, z );

	if ( pass.kind === 'shadow' ) {

		const sh = pass.layer;
		troika.position.set( Number( sh.offsetX ) || 0, Number( sh.offsetY ) || 0, z );
		troika.outlineBlur = Math.max( 0, Number( sh.diffuse ) || 0 );
		troika.outlineWidth = 0;
		applyContentToTroika( troika, sh.content, sh.alpha, mode );
		return;

	}

	// Inner shadow: AFTER face. Offset + blur, then Face-SDF mask (no halo outside).
	if ( pass.kind === 'inner' ) {

		const sh = pass.layer;
		const ox = Number( sh.offsetX ) || 0;
		const oy = Number( sh.offsetY ) || 0;
		troika.position.set( ox, oy, z );
		troika.outlineBlur = Math.max( 0, Number( sh.diffuse ) || 0 );
		troika.outlineWidth = 0;
		const col = contentPrimaryColor( sh.content );
		troika.outlineColor = colorToTroika( col );
		troika.outlineOpacity = sh.alpha != null ? Number( sh.alpha ) : 1;
		applyContentToTroika( troika, sh.content, sh.alpha, mode );
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
			troika.strokeColor = colorToTroika( col );
			troika.strokeOpacity = st.alpha != null ? Number( st.alpha ) : 1;
			applyContentToTroika( troika, st.content, st.alpha, mode );
			troika.fillOpacity = 0; // hollow fill → only the inward stroke band is visible
			return;
		}
		// Outer: thickened glyph under the face (TMP-style).
		troika.outlineWidth = w;
		troika.outlineColor = colorToTroika( col );
		troika.outlineOpacity = st.alpha != null ? Number( st.alpha ) : 1;
		applyContentToTroika( troika, st.content, st.alpha, mode );
		return;

	}

	// face
	const fill = pass.layer;
	applyContentToTroika( troika, fill.content, fill.alpha, mode );

}

function buildFlowerPasses( style ) {

	const passes = [];
	const shadows = ( style.shadows || [] ).filter( ( s ) => s && s.enable );
	const strokes = ( style.strokes || [] ).filter( ( s ) => s && s.enable );
	const outerStrokes = strokes.filter( ( s ) => s.side !== 'inner' );
	const innerStrokes = strokes.filter( ( s ) => s.side === 'inner' );
	const inners = ( style.innerShadows || [] ).filter( ( s ) => s && s.enable );

	// Back → front: outer shadows → outer strokes → face → inner strokes → inner shadows
	for ( let i = 0; i < shadows.length; i ++ ) {

		passes.push( { kind: 'shadow', name: FCC_FLOWER_PREFIX + 'shadow_' + i, layer: shadows[ i ] } );

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

function flowerSyncSignature( ui, rect, mode, style ) {

	const w = rect && rect.w != null ? rect.w : '';
	const h = rect && rect.h != null ? rect.h : '';
	return JSON.stringify( {
		text: ui.text, font: ui.font, fontBold: ui.fontBold, fontSize: ui.fontSize, bold: ui.bold,
		color: ui.color, letterSpacing: ui.letterSpacing, lineHeight: ui.lineHeight,
		align: ui.align, verticalAlign: ui.verticalAlign,
		outline: ui.outline, shadow: ui.shadow,
		flowerStyle: ui.flowerStyle || null,
		sdfGlyphSize: 128, // bump forces Troika rebuild when atlas res changes
		innerFaceMask: 1, // fcc-ui-66 Face-SDF clip; never assign Troika multi-material arrays
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
export function syncUITextContent( group, rect = null ) {

	const ui = getFccUI( group );
	if ( ! ui || ui.type !== 'text' ) return;

	const mode = getOwningCanvasRenderMode( group );
	const fontUrl = resolveFontUrl( ui );
	const prevFontUrl = group.userData && group.userData.__fccTextFontUrl;
	const fontChanged = prevFontUrl !== fontUrl;
	const style = getEffectiveFlowerStyle( ui );

	const sig = flowerSyncSignature( ui, rect, mode, style );
	if ( ! fontChanged && group.userData.__fccTextSig === sig
		&& group.getObjectByName( FCC_FLOWER_FACE ) ) return;

	group.userData.__fccTextSig = sig;
	group.userData.__fccTextFontUrl = fontUrl;

	if ( fontChanged ) {

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
		mesh.visible = true;

		const passMode = mode;
		mesh.sync( () => {

			if ( pass.kind === 'face' || pass.kind === 'stroke'
				|| pass.kind === 'shadow' || pass.kind === 'inner' ) {

				const content = pass.layer && pass.layer.content;
				const layerA = pass.layer && pass.layer.alpha;
				if ( content ) {

					// Re-apply after sync so solid/texture recover and gradient can wrap a real Troika mat
					applyContentToTroika( mesh, content, layerA, passMode );
					if ( pass.kind === 'stroke' && pass.layer && pass.layer.side === 'inner' ) {
						const w = Math.max( 0, Number( pass.layer.width ) || 0 );
						mesh.outlineWidth = 0;
						mesh.outlineOpacity = 0;
						mesh.strokeWidth = w;
						mesh.strokeColor = colorToTroika( contentPrimaryColor( content ) );
						mesh.strokeOpacity = layerA != null ? Number( layerA ) : 1;
						mesh.fillOpacity = 0;
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
						applyInnerShadowFaceMask( mesh, ox, oy, passMode );
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

		} );

	}

}


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
