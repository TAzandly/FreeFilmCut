/**
 * Text sticker-follow (fccUI.textStickers).
 *
 * Schema (freecapcut.text-stickers/1) — hangs on the current Text object:
 *   textStickers: TextSticker[]
 *
 * TextSticker:
 *   id, name, enabled, sort
 *   char          'first' | 'last' | 'index' | 'all' | 'each'
 *   charIndex     number (when char === 'index')
 *   textureRange  CapCut horizontal atlas strips (default 1); char i -> strip i%range
 *   scaleX/Y      relative to base fill rect (may be >1).
 *                 first/last/index/each: base = square side=max(glyph AABB w,h),
 *                 centered on that glyph; all: base = whole-text AABB.
 *   offsetX/Y     project pixels after AABB cover
 *   rotation      radians (local Z)
 *   followCharAnim boolean (default true)
 *   layer         'behind' | 'front'  (default 'behind').
 *                 behind — under the text mesh (flower / effect-stack order
 *                 among themselves is unchanged).
 *                 front  — above text AND its effect stack (flower passes and,
 *                 when Text→RT→TextFx is on, after that composite blit).
 *   material      'sprite' | 'shader' (shader stub → sprite)
 *   texturePath, textureFileName, opacity, color
 *                 texturePath may be blob/http OR rt:<RenderTextureUuid>
 *   rtTargetUuid  optional mirror of rt: path for clip live-bind
 *
 * Runtime: `__fccTextStickers` under the Text group. Call
 * applyTextStickersInScene **after** UI rebind/layout each frame.
 */

import * as THREE from 'three';
import {
	getFccUI,
	isUIText,
	UI_LAYER,
	UI_CAMERA_LAYER,
	RENDER_MODE_CAMERA,
	getOwningCanvasRenderMode,
} from './UIConstants.js?v=fcc-ui-106';
import {
	FCC_TEXTANIM_ROOT,
	FCC_TEXTANIM_CHAR_PREFIX,
} from './TextAnimRuntime.js?v=fcc-ui-212';
import { textureForRenderTextureUuid } from '../media/FccVideo.js?v=fcc-ui-207';

export const FCC_TEXT_STICKERS_ROOT = '__fccTextStickers';
export const FCC_TEXT_STICKERS_ROOT_BEHIND = '__fccTextStickersBehind';
export const FCC_TEXT_STICKERS_ROOT_FRONT = '__fccTextStickersFront';
export const FCC_TEXT_STICKER_PREFIX = '__fccTextSticker_';

const _texLoader = new THREE.TextureLoader();
/** @type {Map<string, THREE.Texture>} */
const _texCache = new Map();
/** @type {THREE.Texture|null} */
let _whiteTex = null;

const _stkPos = new THREE.Vector3();
const _stkQuat = new THREE.Quaternion();
const _stkScale = new THREE.Vector3();
const _stkMat = new THREE.Matrix4();
const _stkInv = new THREE.Matrix4();
const _stkLocal = new THREE.Matrix4();
const _stkEuler = new THREE.Euler();
const _stkOffset = new THREE.Vector3();

function whiteTexture() {

	if ( _whiteTex ) return _whiteTex;
	const data = new Uint8Array( [ 255, 255, 255, 255 ] );
	_whiteTex = new THREE.DataTexture( data, 1, 1, THREE.RGBAFormat );
	_whiteTex.needsUpdate = true;
	_whiteTex.colorSpace = THREE.SRGBColorSpace;
	return _whiteTex;

}

function isStickerRtPath( path ) {

	return typeof path === 'string' && path.startsWith( 'rt:' );

}

function resolveStickerRtTexture( path ) {

	if ( ! isStickerRtPath( path ) ) return null;
	const uuid = path.slice( 3 );
	if ( ! uuid ) return null;
	const ed = typeof window !== 'undefined' ? window.editor : null;
	if ( ! ed ) return null;
	return textureForRenderTextureUuid( ed, uuid );

}

function stampStickerTexRtSlot( material, path ) {

	if ( ! material ) return;
	material.userData = material.userData || {};
	if ( isStickerRtPath( path ) ) {

		material.userData.fccRtSlots = [ { key: 'map', uuid: path.slice( 3 ) } ];

	} else if ( material.userData.fccRtSlots ) {

		delete material.userData.fccRtSlots;

	}

}

function loadStickerTexture( path ) {

	if ( ! path || typeof path !== 'string' ) return whiteTexture();
	// Live MediaFrame RT — always resolve (do not TextureLoader / static-cache).
	if ( isStickerRtPath( path ) ) {

		const live = resolveStickerRtTexture( path );
		return live || whiteTexture();

	}
	if ( _texCache.has( path ) ) return _texCache.get( path );
	const tex = _texLoader.load(
		path,
		() => { tex.needsUpdate = true; },
		undefined,
		() => { console.warn( '[FreeFilmCut] text sticker texture failed', path ); },
	);
	tex.colorSpace = THREE.SRGBColorSpace;
	tex.generateMipmaps = true;
	tex.minFilter = THREE.LinearMipmapLinearFilter;
	tex.magFilter = THREE.LinearFilter;
	_texCache.set( path, tex );
	return tex;

}


function resolveLinkedMaterial( sticker, materialsMap ) {

	if ( ! sticker || sticker.material !== 'material' ) return null;
	const uuid = sticker.materialUuid;
	if ( ! uuid || typeof uuid !== 'string' ) return null;
	if ( materialsMap && materialsMap[ uuid ] ) return materialsMap[ uuid ];
	return null;

}

function newId() {

	return 'stk_' + Math.random().toString( 36 ).slice( 2, 10 );

}

export function createDefaultTextSticker() {

	return {
		id: newId(),
		name: 'Sticker',
		enabled: true,
		sort: 0,
		char: 'first',
		charIndex: 0,
		textureRange: 1,
		scaleX: 1.2,
		scaleY: 1.2,
		offsetX: 0,
		offsetY: 0,
		rotation: 0,
		followCharAnim: true,
		layer: 'behind',
		material: 'sprite',
		materialUuid: '',
		texturePath: '',
		textureFileName: '',
		opacity: 1,
		// Visible default tint when no texture (white-on-white hid stickers).
		color: '#ff66aa',
	};

}

export function normalizeTextSticker( raw ) {

	const d = createDefaultTextSticker();
	if ( ! raw || typeof raw !== 'object' ) return d;
	const char = raw.char === 'last' || raw.char === 'index' || raw.char === 'first' || raw.char === 'all' || raw.char === 'each'
		? raw.char
		: 'first';
	const layer = raw.layer === 'front' ? 'front' : 'behind';
	let textureRange = Math.floor( Number( raw.textureRange ) );
	if ( ! Number.isFinite( textureRange ) || textureRange < 1 ) textureRange = 1;
	return {
		id: typeof raw.id === 'string' && raw.id ? raw.id : d.id,
		name: raw.name != null ? String( raw.name ) : d.name,
		enabled: raw.enabled !== false,
		sort: Number.isFinite( Number( raw.sort ) ) ? Number( raw.sort ) : 0,
		char,
		charIndex: Math.max( 0, Math.floor( Number( raw.charIndex ) ) || 0 ),
		textureRange,
		scaleX: Number( raw.scaleX ) > 0 ? Number( raw.scaleX ) : 1,
		scaleY: Number( raw.scaleY ) > 0 ? Number( raw.scaleY ) : 1,
		offsetX: Number( raw.offsetX ) || 0,
		offsetY: Number( raw.offsetY ) || 0,
		rotation: Number( raw.rotation ) || 0,
		followCharAnim: raw.followCharAnim !== false,
		layer,
		material: ( raw.material === 'material' || raw.material === 'shader' ) ? 'material' : 'sprite',
		materialUuid: raw.materialUuid != null ? String( raw.materialUuid ) : '',
		texturePath: raw.texturePath != null ? String( raw.texturePath ) : '',
		textureFileName: raw.textureFileName != null ? String( raw.textureFileName ) : '',
		opacity: Math.max( 0, Math.min( 1, Number( raw.opacity ) != null && ! Number.isNaN( Number( raw.opacity ) )
			? Number( raw.opacity ) : 1 ) ),
		color: typeof raw.color === 'string' && raw.color ? raw.color : d.color,
		rtTargetUuid: ( () => {
			const tp = raw.texturePath != null ? String( raw.texturePath ) : '';
			const fromPath = tp.startsWith( 'rt:' ) ? tp.slice( 3 ) : '';
			if ( typeof raw.rtTargetUuid === 'string' && raw.rtTargetUuid ) return raw.rtTargetUuid;
			return fromPath;
		} )(),
	};

}

export function ensureTextStickersOnUI( ui ) {

	if ( ! ui || typeof ui !== 'object' ) return [];
	if ( ! Array.isArray( ui.textStickers ) ) ui.textStickers = [];
	// Normalize IN PLACE — never replace the array or objects. Sidebar cards
	// close over list/item references; a .map() rewrite orphaned edits/deletes.
	const list = ui.textStickers;
	for ( let i = 0; i < list.length; i ++ ) {

		const raw = list[ i ];
		if ( raw && typeof raw === 'object' ) {

			const n = normalizeTextSticker( raw );
			for ( const k of Object.keys( n ) ) raw[ k ] = n[ k ];
			list[ i ] = raw;

		} else {

			list[ i ] = normalizeTextSticker( raw );

		}

	}
	return list;

}

export function listStickerChars( text ) {

	const s = text != null ? String( text ) : '';
	const chars = [];
	for ( const ch of s ) {

		if ( ch === '\n' || ch === '\r' ) continue;
		chars.push( ch );

	}
	return chars;

}

export function resolveStickerCharIndex( sticker, charCount ) {

	const n = Math.max( 0, Math.floor( Number( charCount ) ) || 0 );
	if ( n <= 0 ) return - 1;
	const s = normalizeTextSticker( sticker );
	// 'all' is not a single glyph — callers handle it separately.
	if ( s.char === 'all' || s.char === 'each' ) return - 1;
	if ( s.char === 'last' ) return n - 1;
	if ( s.char === 'index' ) {

		// Clamp to current length when text shortens (binding stays live).
		const idx = Math.max( 0, Math.floor( Number( s.charIndex ) ) || 0 );
		return Math.max( 0, Math.min( n - 1, idx ) );

	}
	// first
	return 0;

}

function isTroikaMesh( o ) {

	return !! ( o && typeof o.sync === 'function' );

}

function findLayoutSourceTroika( group ) {

	const prefer = [ '__fccFlower_face', '__fccText' ];
	const pools = [];
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( ! c || c.name === FCC_TEXTANIM_ROOT || c.name === FCC_TEXT_STICKERS_ROOT
			|| c.name === FCC_TEXT_STICKERS_ROOT_BEHIND || c.name === FCC_TEXT_STICKERS_ROOT_FRONT ) continue;
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
		if ( isTroikaMesh( o ) ) return o;

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

function readGlyphBounds( src ) {

	if ( ! src ) return null;
	const info = src.textRenderInfo;
	const gb = info && info.glyphBounds;
	if ( gb && gb.length >= 4 ) return gb;
	return null;

}


function animToStringIndex( full ) {

	const s = full != null ? String( full ) : '';
	const out = [];
	for ( let si = 0; si < s.length; ) {

		const cp = s.codePointAt( si );
		const ch = String.fromCodePoint( cp );
		const adv = ch.length;
		if ( ch !== '\n' && ch !== '\r' ) out.push( si );
		si += adv;

	}
	return out;

}

/**
 * Prefer Troika glyphBounds (ink) when aligned; else caret cell; else fontSize box.
 */
function glyphAabbFromLayout( carets, glyphBounds, stringIndex, animIndex, fontSize ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;

	// glyphBounds is typically one [minX,minY,maxX,maxY] per non-whitespace glyph
	// in typeset order — same order as listStickerChars / animIndex.
	if ( glyphBounds && animIndex != null && glyphBounds.length >= ( animIndex + 1 ) * 4 ) {

		const i = animIndex * 4;
		const x0 = glyphBounds[ i ];
		const y0 = glyphBounds[ i + 1 ];
		const x1 = glyphBounds[ i + 2 ];
		const y1 = glyphBounds[ i + 3 ];
		const w = Math.max( 1, Math.abs( x1 - x0 ) );
		const h = Math.max( 1, Math.abs( y1 - y0 ) );
		return {
			x0: Math.min( x0, x1 ),
			x1: Math.max( x0, x1 ),
			y0: Math.min( y0, y1 ),
			y1: Math.max( y0, y1 ),
			cx: ( x0 + x1 ) * 0.5,
			cy: ( y0 + y1 ) * 0.5,
			w,
			h,
		};

	}

	if ( carets && stringIndex != null && carets.length >= ( stringIndex + 1 ) * 4 ) {

		const x0 = carets[ stringIndex * 4 ];
		const x1 = carets[ stringIndex * 4 + 1 ];
		const y0 = carets[ stringIndex * 4 + 2 ];
		const y1 = carets[ stringIndex * 4 + 3 ];
		const w = Math.max( 1, Math.abs( x1 - x0 ) );
		const h = Math.max( 1, Math.abs( y1 - y0 ) );
		return {
			x0: Math.min( x0, x1 ),
			x1: Math.max( x0, x1 ),
			y0: Math.min( y0, y1 ),
			y1: Math.max( y0, y1 ),
			cx: ( x0 + x1 ) * 0.5,
			cy: ( y0 + y1 ) * 0.5,
			w,
			h,
		};

	}

	return {
		x0: - fs * 0.4,
		x1: fs * 0.4,
		y0: - fs * 0.5,
		y1: fs * 0.5,
		cx: 0,
		cy: 0,
		w: fs * 0.8,
		h: fs,
	};

}

function disposeMesh( mesh ) {

	if ( ! mesh ) return;
	try {

		if ( mesh.geometry ) mesh.geometry.dispose();

	} catch ( e ) { /* ignore */ }
	try {

		// Never dispose project 材质球 / shared materials.
		if ( mesh.userData && mesh.userData.__fccStickerSharedMat ) return;
		const m = mesh.material;
		if ( m && m.userData && m.userData.__fccStickerSharedMat ) return;
		if ( m ) m.dispose();

	} catch ( e2 ) { /* ignore */ }

}


function aabbFromMinMax( minX, minY, maxX, maxY, fontSize ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;
	let x0 = Number( minX ), y0 = Number( minY ), x1 = Number( maxX ), y1 = Number( maxY );
	if ( ! Number.isFinite( x0 ) || ! Number.isFinite( y0 ) || ! Number.isFinite( x1 ) || ! Number.isFinite( y1 ) ) {

		return {
			x0: - fs * 0.4, x1: fs * 0.4, y0: - fs * 0.5, y1: fs * 0.5,
			cx: 0, cy: 0, w: fs * 0.8, h: fs,
		};

	}
	if ( x1 < x0 ) { const t = x0; x0 = x1; x1 = t; }
	if ( y1 < y0 ) { const t = y0; y0 = y1; y1 = t; }
	const w = Math.max( 1, x1 - x0 );
	const h = Math.max( 1, y1 - y0 );
	return { x0, x1, y0, y1, cx: ( x0 + x1 ) * 0.5, cy: ( y0 + y1 ) * 0.5, w, h };

}

/**
 * Whole-string AABB in Troika layout / text-local space.
 * Prefer visibleBounds (ink), then blockBounds, then union of glyphBounds / carets.
 */
function fullTextAabbFromLayout( layoutSrc, carets, glyphBounds, fontSize ) {

	const fs = Number( fontSize ) > 0 ? Number( fontSize ) : 48;
	const info = layoutSrc && layoutSrc.textRenderInfo;

	const vb = info && info.visibleBounds;
	if ( vb && vb.length >= 4 ) {

		return aabbFromMinMax( vb[ 0 ], vb[ 1 ], vb[ 2 ], vb[ 3 ], fs );

	}
	const bb = info && info.blockBounds;
	if ( bb && bb.length >= 4 ) {

		return aabbFromMinMax( bb[ 0 ], bb[ 1 ], bb[ 2 ], bb[ 3 ], fs );

	}

	if ( glyphBounds && glyphBounds.length >= 4 ) {

		let minX = Infinity, minY = Infinity, maxX = - Infinity, maxY = - Infinity;
		for ( let i = 0; i + 3 < glyphBounds.length; i += 4 ) {

			const x0 = glyphBounds[ i ], y0 = glyphBounds[ i + 1 ];
			const x1 = glyphBounds[ i + 2 ], y1 = glyphBounds[ i + 3 ];
			minX = Math.min( minX, x0, x1 );
			minY = Math.min( minY, y0, y1 );
			maxX = Math.max( maxX, x0, x1 );
			maxY = Math.max( maxY, y0, y1 );

		}
		if ( Number.isFinite( minX ) ) return aabbFromMinMax( minX, minY, maxX, maxY, fs );

	}

	if ( carets && carets.length >= 4 ) {

		let minX = Infinity, minY = Infinity, maxX = - Infinity, maxY = - Infinity;
		for ( let i = 0; i + 3 < carets.length; i += 4 ) {

			const x0 = carets[ i ], x1 = carets[ i + 1 ];
			const y0 = carets[ i + 2 ], y1 = carets[ i + 3 ];
			minX = Math.min( minX, x0, x1 );
			minY = Math.min( minY, y0, y1 );
			maxX = Math.max( maxX, x0, x1 );
			maxY = Math.max( maxY, y0, y1 );

		}
		if ( Number.isFinite( minX ) ) return aabbFromMinMax( minX, minY, maxX, maxY, fs );

	}

	return aabbFromMinMax( - fs * 0.4, - fs * 0.5, fs * 0.4, fs * 0.5, fs );

}

const _uniA = new THREE.Vector3();
const _uniB = new THREE.Vector3();
const _uniMat = new THREE.Matrix4();
const _uniInv = new THREE.Matrix4();

/**
 * When char-split anim is active, union each glyph AABB transformed by its char group
 * into text-group local space (follows animated letters as a block).
 */
function unionFollowedCharsAabb( group, animRoot, carets, glyphBounds, charCount, strIndex, fontSize ) {

	if ( ! group || ! animRoot || charCount <= 0 ) return null;
	group.updateMatrixWorld( true );
	_uniInv.copy( group.matrixWorld ).invert();

	let minX = Infinity, minY = Infinity, maxX = - Infinity, maxY = - Infinity;
	let any = false;

	for ( let gi = 0; gi < charCount; gi ++ ) {

		const charGroup = animRoot.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + gi );
		if ( ! charGroup ) continue;
		const si = strIndex && strIndex[ gi ];
		const g = glyphAabbFromLayout( carets, glyphBounds, si, gi, fontSize );
		charGroup.updateWorldMatrix( true, false );
		_uniMat.multiplyMatrices( _uniInv, charGroup.matrixWorld );

		// Glyph AABB is in text-local rest space; charGroup origin is at __fccCharBase.
		// Corners relative to char base, then through charGroup world.
		const base = charGroup.userData && charGroup.userData.__fccCharBase;
		const restCx = base ? base.x : g.cx;
		const restCy = base ? base.y : g.cy;
		const corners = [
			[ g.x0 - restCx, g.y0 - restCy ],
			[ g.x1 - restCx, g.y0 - restCy ],
			[ g.x0 - restCx, g.y1 - restCy ],
			[ g.x1 - restCx, g.y1 - restCy ],
		];
		for ( let c = 0; c < 4; c ++ ) {

			_uniA.set( corners[ c ][ 0 ], corners[ c ][ 1 ], 0 );
			_uniA.applyMatrix4( _uniMat );
			minX = Math.min( minX, _uniA.x );
			minY = Math.min( minY, _uniA.y );
			maxX = Math.max( maxX, _uniA.x );
			maxY = Math.max( maxY, _uniA.y );
			any = true;

		}

	}

	if ( ! any ) return null;
	return aabbFromMinMax( minX, minY, maxX, maxY, fontSize );

}

function resolveLayerMask( group ) {

	const mode = getOwningCanvasRenderMode( group );
	return mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER;

}

/**
 * UI overlay depth contract for sticker materials (sprite MeshBasic OR project
 * material-ball / ShaderMaterial). Without this, an opaque ShaderMaterial is
 * drawn in the opaque pass *before* transparent Troika flower/text, so
 * layer:front loses regardless of renderOrder / parent root.
 *
 * Saves originals once on material.userData.__fccStickerDepthOrig so Material
 * tab edits keep working and we can restore when the sticker leaves the ball.
 */
function rememberStickerMaterialDepthOrig( mat ) {

	if ( ! mat || ! mat.userData ) mat.userData = {};
	if ( mat.userData.__fccStickerDepthOrig ) return;
	mat.userData.__fccStickerDepthOrig = {
		depthTest: mat.depthTest,
		depthWrite: mat.depthWrite,
		transparent: mat.transparent,
		toneMapped: mat.toneMapped,
	};

}

function restoreStickerMaterialDepthOrig( mat ) {

	if ( ! mat || ! mat.userData || ! mat.userData.__fccStickerDepthOrig ) return;
	const o = mat.userData.__fccStickerDepthOrig;
	mat.depthTest = o.depthTest;
	mat.depthWrite = o.depthWrite;
	mat.transparent = o.transparent;
	if ( o.toneMapped !== undefined ) mat.toneMapped = o.toneMapped;
	delete mat.userData.__fccStickerDepthOrig;

}

function enforceStickerMaterialContract( mat ) {

	if ( ! mat ) return;
	rememberStickerMaterialDepthOrig( mat );
	let dirty = false;
	// Always false for stickers: depth must not fight Troika / TextFx compositing.
	if ( mat.depthTest !== false ) { mat.depthTest = false; dirty = true; }
	if ( mat.depthWrite !== false ) { mat.depthWrite = false; dirty = true; }
	// Force transparent list so renderOrder vs flower/text is honored
	// (opaque ShaderMaterial otherwise draws in the opaque pass before Troika).
	if ( mat.transparent !== true ) { mat.transparent = true; dirty = true; }
	if ( mat.toneMapped !== false ) { mat.toneMapped = false; dirty = true; }
	if ( dirty ) mat.needsUpdate = true;

}

function stampStickerLayers( root, group ) {

	const mode = getOwningCanvasRenderMode( group );
	const layerIndex = mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER;
	root.layers.set( layerIndex );
	root.traverse( ( n ) => {

		n.layers.set( layerIndex );
		n.frustumCulled = false;
		if ( ! n.isMesh ) return;
		// Mesh renderOrder is re-applied in applyTextStickers pose loop; never
		// clear it here. Keep sticker meshes inside behind/front roots only.
		if ( n.material ) {

			const mats = Array.isArray( n.material ) ? n.material : [ n.material ];
			for ( let i = 0; i < mats.length; i ++ ) {

				enforceStickerMaterialContract( mats[ i ] );

			}

		}

	} );

}


/**
 * Place stickers roots among siblings without shuffling flower meshes relative
 * to each other. Front root is always last (after flower / anim); behind first.
 * Also stamps root.renderOrder so painter order wins even if a later add()
 * briefly moves a flower mesh past the front root before the next stickers pass.
 */
function placeRootAmongSiblings( group, root, where ) {

	if ( ! group || ! root ) return;
	if ( root.parent !== group ) group.add( root );

	const kids = group.children;
	const idx = kids.indexOf( root );
	if ( idx < 0 ) return;

	if ( where === 'front' ) {

		if ( idx !== kids.length - 1 ) {

			kids.splice( idx, 1 );
			kids.push( root );

		}
		root.renderOrder = 10000;

	} else {

		if ( idx !== 0 ) {

			kids.splice( idx, 1 );
			kids.unshift( root );

		}
		root.renderOrder = -10000;

	}

}

function ensureLayerRoot( group, name ) {

	let root = group.getObjectByName( name );
	if ( root ) return root;
	root = new THREE.Group();
	root.name = name;
	root.frustumCulled = false;
	root.matrixAutoUpdate = true;
	group.add( root );
	return root;

}

function ensureStickersRoots( group ) {

	// Legacy single root → treat as behind
	const legacy = group.getObjectByName( FCC_TEXT_STICKERS_ROOT );
	const behind = ensureLayerRoot( group, FCC_TEXT_STICKERS_ROOT_BEHIND );
	const front = ensureLayerRoot( group, FCC_TEXT_STICKERS_ROOT_FRONT );
	if ( legacy && legacy !== behind ) {

		while ( legacy.children.length ) behind.add( legacy.children[ 0 ] );
		group.remove( legacy );

	}
	placeRootAmongSiblings( group, behind, 'behind' );
	placeRootAmongSiblings( group, front, 'front' );
	return { behind, front };

}


/** Piece mesh name: single = PREFIX+id; each = PREFIX+id+'__c'+gi */
export function stickerPieceName( stickerId, gi ) {

	if ( gi == null || gi < 0 ) return FCC_TEXT_STICKER_PREFIX + stickerId;
	return FCC_TEXT_STICKER_PREFIX + stickerId + '__c' + gi;

}

/** CapCut-style horizontal atlas: remap sticker mesh UV.x into strip (charIndex % range). Shared material balls stay safe (no per-mesh uniform). */
function resolveStickerTexRange( material, sticker ) {

	if ( sticker ) {
		const tr = Math.floor( Number( sticker.textureRange ) );
		if ( Number.isFinite( tr ) && tr > 1 ) return tr;
	}
	if ( ! material ) {
		const tr0 = sticker ? Math.floor( Number( sticker.textureRange ) ) : 1;
		return ( Number.isFinite( tr0 ) && tr0 >= 1 ) ? tr0 : 1;
	}
	const ud = material.userData || {};
	if ( ud.fccTexRange != null ) {
		const n = Math.floor( Number( ud.fccTexRange ) );
		if ( Number.isFinite( n ) && n >= 1 ) return n;
	}
	const u = material.uniforms && material.uniforms.uFccTexRange;
	if ( u && u.value != null ) {
		const n = Math.floor( Number( u.value ) );
		if ( Number.isFinite( n ) && n >= 1 ) return n;
	}
	if ( sticker ) {
		const tr = Math.floor( Number( sticker.textureRange ) );
		if ( Number.isFinite( tr ) && tr >= 1 ) return tr;
	}
	return 1;

}

function ensureStickerBaseUV( mesh ) {

	const geo = mesh && mesh.geometry;
	if ( ! geo || ! geo.attributes || ! geo.attributes.uv ) return null;
	const geoId = geo.uuid || '';
	// Geometry swap (or first bind) must recapture 0..1 UVs; never treat a
	// previously-sliced buffer as the atlas base.
	if ( ! mesh.userData.__fccStickerBaseUV || mesh.userData.__fccStickerBaseGeo !== geoId ) {
		const arr = geo.attributes.uv.array;
		mesh.userData.__fccStickerBaseUV = Float32Array.from( arr );
		mesh.userData.__fccStickerBaseGeo = geoId;
		delete mesh.userData.__fccStickerAtlasSlot;
		delete mesh.userData.__fccStickerAtlasRange;
		delete mesh.userData.__fccStickerAtlasMapId;
	}
	return mesh.userData.__fccStickerBaseUV;

}

function applyStickerAtlasRangeUV( mesh, charIndex, material, sticker ) {

	if ( ! mesh || ! mesh.geometry ) return;
	const range = resolveStickerTexRange( material, sticker );
	const base = ensureStickerBaseUV( mesh );
	const uv = mesh.geometry.attributes.uv;
	if ( ! base || ! uv ) return;
	const slot = range > 1 ? ( Math.max( 0, Math.floor( Number( charIndex ) ) || 0 ) % range ) : 0;
	// Include live map identity: RT picker / fccRtSlots rebind swaps white→RT
	// (or file→RT) without touching textureRange. Old slot/range cache then
	// skipped UV rewrite so 分区 looked dead until the sidebar was re-touched.
	const mapId = ( material && material.map && material.map.uuid ) ? String( material.map.uuid ) : '';
	const prev = mesh.userData.__fccStickerAtlasSlot;
	const prevR = mesh.userData.__fccStickerAtlasRange;
	const prevMap = mesh.userData.__fccStickerAtlasMapId;
	if ( prev !== slot || prevR !== range || prevMap !== mapId ) {
		for ( let i = 0; i < uv.count; i ++ ) {
			const u0 = base[ i * 2 ];
			const v0 = base[ i * 2 + 1 ];
			uv.setXY( i, range > 1 ? ( u0 + slot ) / range : u0, v0 );
		}
		uv.needsUpdate = true;
		mesh.userData.__fccStickerAtlasSlot = slot;
		mesh.userData.__fccStickerAtlasRange = range;
		mesh.userData.__fccStickerAtlasMapId = mapId;
	}
	// Shared material balls must NOT get per-piece uniform writes.
	const shared = !!( mesh.userData && mesh.userData.__fccStickerSharedMat );
	if ( ! shared && material && material.uniforms && material.uniforms.uFccCharIndex ) {
		material.uniforms.uFccCharIndex.value = Math.max( 0, Math.floor( Number( charIndex ) ) || 0 );
	}

}

function makeStickerMesh( sticker, layerIndex, gi ) {

	const geo = new THREE.PlaneGeometry( 1, 1 );
	const mat = new THREE.MeshBasicMaterial( {
		map: sticker.texturePath ? loadStickerTexture( sticker.texturePath ) : whiteTexture(),
		color: new THREE.Color( sticker.color || '#ff66aa' ),
		transparent: true,
		opacity: sticker.opacity,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		side: THREE.DoubleSide,
	} );
	stampStickerTexRtSlot( mat, sticker.texturePath || '' );
	const mesh = new THREE.Mesh( geo, mat );
	const pieceGi = ( gi == null || gi < 0 ) ? - 1 : Math.floor( gi );
	mesh.name = stickerPieceName( sticker.id, pieceGi < 0 ? null : pieceGi );
	mesh.frustumCulled = false;
	mesh.matrixAutoUpdate = true;
	mesh.layers.set( layerIndex );
	mesh.raycast = function () {};
	mesh.userData.__fccTextSticker = true;
	mesh.userData.__fccStickerGi = ( typeof pieceGi === 'number' ) ? pieceGi : - 1;
	mesh.userData.__fccStickerId = sticker.id;
	return mesh;

}



function bindStickerMeshAppearance( mesh, s, mats ) {

	if ( ! mesh || ! s ) return;
	let linked = resolveLinkedMaterial( s, mats );
	if ( s.material === 'material' ) {

		const cur = mesh.material;
		if ( cur && cur.uuid && mats && mats[ cur.uuid ] && cur.uuid !== s.materialUuid ) {

			s.materialUuid = cur.uuid;
			linked = cur;

		}
		if ( linked ) {

			const prev = mesh.material;
			if ( prev && prev !== linked && prev.userData && prev.userData.__fccStickerSharedMat
				&& prev.userData.__fccStickerDepthOrig ) {

				restoreStickerMaterialDepthOrig( prev );

			}
			if ( mesh.material !== linked ) mesh.material = linked;
			mesh.userData.__fccStickerSharedMat = true;
			if ( linked.userData ) linked.userData.__fccStickerSharedMat = true;
			else linked.userData = { __fccStickerSharedMat: true };
			enforceStickerMaterialContract( linked );

		}

	}
	if ( s.material !== 'material' || ! linked ) {

		const prevShared = mesh.material;
		if ( prevShared && prevShared.userData && prevShared.userData.__fccStickerSharedMat ) {

			restoreStickerMaterialDepthOrig( prevShared );
			delete prevShared.userData.__fccStickerSharedMat;

		}
		mesh.userData.__fccStickerSharedMat = false;
		let mat = mesh.material;
		if ( ! mat || mat.isShaderMaterial || mat.isRawShaderMaterial
			|| ( mat.userData && mat.userData.__fccStickerSharedMat ) ) {

			mat = new THREE.MeshBasicMaterial( {
				map: whiteTexture(),
				color: new THREE.Color( s.color || '#ff66aa' ),
				transparent: true,
				opacity: s.opacity,
				depthTest: false,
				depthWrite: false,
				toneMapped: false,
				side: THREE.DoubleSide,
			} );
			mesh.material = mat;

		}
		const wantMap = s.texturePath ? loadStickerTexture( s.texturePath ) : whiteTexture();
		if ( mat.map !== wantMap ) {

			mat.map = wantMap;
			mat.needsUpdate = true;
			// Force atlas UV re-slice with existing textureRange (no need to re-touch 分区).
			delete mesh.userData.__fccStickerAtlasSlot;
			delete mesh.userData.__fccStickerAtlasRange;
			delete mesh.userData.__fccStickerAtlasMapId;

		}
		stampStickerTexRtSlot( mat, s.texturePath || '' );
		// RT path: map may still be white until live rebind — still invalidate so
		// the first real RT uuid triggers applyStickerAtlasRangeUV via mapId.
		if ( isStickerRtPath( s.texturePath ) ) {
			delete mesh.userData.__fccStickerAtlasMapId;
		}
		mat.opacity = s.opacity;
		if ( mat.color ) mat.color.set( s.color || '#ff66aa' );
		mat.side = THREE.DoubleSide;
		enforceStickerMaterialContract( mat );

	}
	mesh.userData.__fccStickerData = s;

}

function collectStickerMeshes( root, stickerId ) {

	const out = [];
	if ( ! root ) return out;
	for ( let i = 0; i < root.children.length; i ++ ) {

		const c = root.children[ i ];
		if ( c && c.userData && c.userData.__fccTextSticker && c.userData.__fccStickerId === stickerId ) {
			out.push( c );
		}

	}
	return out;

}

export function syncTextStickers( group, materialsMap ) {

	if ( ! group || ! isUIText( group ) ) return;
	const ui = getFccUI( group );
	if ( ! ui ) return;
	const list = ensureTextStickersOnUI( ui );
	const { behind, front } = ensureStickersRoots( group );
	const layerIndex = resolveLayerMask( group );
	const mats = materialsMap || null;

	const roots = [ behind, front ];
	const want = new Set( list.map( ( s ) => s.id ) );

	for ( const root of roots ) {

		for ( let i = root.children.length - 1; i >= 0; i -- ) {

			const c = root.children[ i ];
			if ( ! c || ! c.userData || ! c.userData.__fccTextSticker ) continue;
			if ( ! want.has( c.userData.__fccStickerId ) ) {

				root.remove( c );
				disposeMesh( c );

			}

		}

	}

	const charCountSync = listStickerChars( ui.text ).length;

	for ( let i = 0; i < list.length; i ++ ) {

		const s = list[ i ];
		const targetRoot = s.layer === 'front' ? front : behind;
		const existing = collectStickerMeshes( behind, s.id ).concat( collectStickerMeshes( front, s.id ) );
		const wantEach = s.char === 'each';
		const wantCount = wantEach ? Math.max( 0, charCountSync ) : 1;

		// Drop meshes that don't match current mode / piece count.
		for ( let ei = 0; ei < existing.length; ei ++ ) {

			const msh = existing[ ei ];
			const gi = ( msh.userData && msh.userData.__fccStickerGi != null )
				? Math.floor( Number( msh.userData.__fccStickerGi ) )
				: - 1;
			let keep = false;
			if ( wantEach ) {
				keep = gi >= 0 && gi < wantCount;
			} else {
				keep = gi < 0; // single mesh uses gi=-1
			}
			if ( ! keep ) {
				if ( msh.parent ) msh.parent.remove( msh );
				disposeMesh( msh );
			}

		}

		const live = collectStickerMeshes( behind, s.id ).concat( collectStickerMeshes( front, s.id ) );
		const byGi = new Map();
		for ( let li = 0; li < live.length; li ++ ) {
			const msh = live[ li ];
			const gi = ( msh.userData && msh.userData.__fccStickerGi != null )
				? Math.floor( Number( msh.userData.__fccStickerGi ) )
				: - 1;
			byGi.set( gi, msh );
		}

		if ( wantEach ) {

			for ( let gi = 0; gi < wantCount; gi ++ ) {
				let mesh = byGi.get( gi );
				if ( ! mesh ) {
					mesh = makeStickerMesh( s, layerIndex, gi );
					targetRoot.add( mesh );
				} else if ( mesh.parent !== targetRoot ) {
					targetRoot.add( mesh );
				}
				mesh.visible = !! s.enabled;
				mesh.name = stickerPieceName( s.id, gi );
				mesh.userData.__fccStickerGi = gi;
				mesh.userData.__fccStickerId = s.id;
				bindStickerMeshAppearance( mesh, s, mats );
				if ( mesh.parent !== targetRoot ) targetRoot.add( mesh );
			}

		} else {

			let mesh = byGi.get( - 1 );
			// Migrate legacy single mesh that never had __fccStickerGi.
			if ( ! mesh ) {
				for ( let li = 0; li < live.length; li ++ ) {
					const cand = live[ li ];
					if ( cand.userData.__fccStickerGi == null || cand.userData.__fccStickerGi < 0 ) {
						mesh = cand;
						break;
					}
				}
			}
			if ( ! mesh ) {
				mesh = makeStickerMesh( s, layerIndex, - 1 );
				targetRoot.add( mesh );
			} else if ( mesh.parent !== targetRoot ) {
				targetRoot.add( mesh );
			}
			mesh.visible = !! s.enabled;
			mesh.name = stickerPieceName( s.id, null );
			mesh.userData.__fccStickerGi = - 1;
			mesh.userData.__fccStickerId = s.id;
			bindStickerMeshAppearance( mesh, s, mats );
			if ( mesh.parent !== targetRoot ) targetRoot.add( mesh );

		}

	}

	placeRootAmongSiblings( group, behind, 'behind' );
	placeRootAmongSiblings( group, front, 'front' );
	stampStickerLayers( behind, group );
	stampStickerLayers( front, group );

}

function clearAllStickerRoots( group ) {

	for ( const name of [ FCC_TEXT_STICKERS_ROOT, FCC_TEXT_STICKERS_ROOT_BEHIND, FCC_TEXT_STICKERS_ROOT_FRONT ] ) {

		const oldRoot = group.getObjectByName( name );
		if ( ! oldRoot ) continue;
		group.remove( oldRoot );
		oldRoot.traverse( ( o ) => { if ( o.isMesh ) disposeMesh( o ); } );

	}

}


/**
 * Char opacity written by TextAnimRuntime.applyOpacityToCharGroup
 * (`charGroup.userData.__fccAnimLastOp`). Stickers read it when followCharAnim.
 * @returns {number} 0..1
 */
function readCharAnimOpacity( animRoot, gi ) {

	if ( ! animRoot || gi == null || gi < 0 ) return 1;
	const charGroup = animRoot.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + gi );
	if ( ! charGroup || ! charGroup.userData ) return 1;
	const op = charGroup.userData.__fccAnimLastOp;
	if ( op == null || ! Number.isFinite( Number( op ) ) ) {
		// Fallback: invisible char group => 0; else assume fully opaque.
		return charGroup.visible === false ? 0 : 1;
	}
	return Math.max( 0, Math.min( 1, Number( op ) ) );

}

/**
 * Whole-AABB (`char: all`) follow opacity — CapCut-like: **max** of per-char
 * anim opacities so the decoration stays with the strongest visible ink
 * during 逐字 cascade (not average, which would wash out early letters).
 */
function readAllCharsAnimOpacity( animRoot, charCount ) {

	if ( ! animRoot || ! ( charCount > 0 ) ) return 1;
	let maxOp = 0;
	let any = false;
	for ( let gi = 0; gi < charCount; gi ++ ) {
		const op = readCharAnimOpacity( animRoot, gi );
		any = true;
		if ( op > maxOp ) maxOp = op;
	}
	return any ? maxOp : 1;

}

/**
 * Multiply authored sticker.opacity by followed char anim opacity.
 * Unique materials only (clone once if currently shared).
 */
function applyStickerFollowOpacity( mesh, s, followOp ) {

	if ( ! mesh || ! s ) return;
	const base = Number( s.opacity );
	const b = Number.isFinite( base ) ? Math.max( 0, Math.min( 1, base ) ) : 1;
	const f = Number.isFinite( Number( followOp ) )
		? Math.max( 0, Math.min( 1, Number( followOp ) ) )
		: 1;
	const a = b * f;
	let mat = mesh.material;
	if ( ! mat ) {
		if ( a <= 0.001 ) mesh.visible = false;
		return;
	}
	const shared = !!( mesh.userData && mesh.userData.__fccStickerSharedMat );
	if ( shared ) {
		// Shared material balls cannot take per-piece opacity; clone for follow fade.
		if ( Math.abs( f - 1 ) > 0.001 ) {
			mat = mat.clone();
			mesh.material = mat;
			mesh.userData.__fccStickerSharedMat = false;
			if ( mat.userData ) delete mat.userData.__fccStickerSharedMat;
			else mat.userData = {};
			mat.userData.__fccStickerFollowOpClone = true;
		} else {
			return;
		}
	}
	if ( mat.opacity != null ) {
		mat.transparent = true;
		mat.opacity = a;
	}
	if ( mat.uniforms && mat.uniforms.opacity && mat.uniforms.opacity.value != null ) {
		mat.uniforms.opacity.value = a;
	}
	if ( a <= 0.001 ) mesh.visible = false;

}

function poseStickerOnGlyph( mesh, s, gi, opts ) {

	const {
		group, animRoot, follow, carets, glyphBounds, strIndex, fs, zBump, sortBase,
	} = opts;
	const si = strIndex[ gi ];
	const aabb = glyphAabbFromLayout( carets, glyphBounds, si, gi, fs );
	const side = Math.max( aabb.w, aabb.h );
	const planeW = Math.max( 0.001, side * s.scaleX );
	const planeH = Math.max( 0.001, side * s.scaleY );

	mesh.renderOrder = sortBase + ( Number( s.sort ) || 0 );

	const charGroup = follow
		? animRoot.getObjectByName( FCC_TEXTANIM_CHAR_PREFIX + gi )
		: null;

	if ( charGroup ) {

		const base = charGroup.userData.__fccCharBase;
		const restCx = base ? base.x : aabb.cx;
		const restCy = base ? base.y : aabb.cy;
		_stkOffset.set(
			( aabb.cx - restCx ) + s.offsetX,
			( aabb.cy - restCy ) + s.offsetY,
			zBump,
		);

		_stkLocal.compose(
			_stkOffset,
			_stkQuat.setFromEuler( _stkEuler.set( 0, 0, s.rotation ) ),
			_stkScale.set( planeW, planeH, 1 ),
		);

		charGroup.updateWorldMatrix( true, false );
		_stkInv.copy( group.matrixWorld ).invert();
		_stkMat.multiplyMatrices( charGroup.matrixWorld, _stkLocal );
		_stkMat.premultiply( _stkInv );
		_stkMat.decompose( _stkPos, _stkQuat, _stkScale );
		mesh.position.copy( _stkPos );
		mesh.quaternion.copy( _stkQuat );
		mesh.scale.copy( _stkScale );

	} else {

		mesh.position.set( aabb.cx + s.offsetX, aabb.cy + s.offsetY, zBump );
		mesh.rotation.set( 0, 0, s.rotation );
		mesh.scale.set( planeW, planeH, 1 );

	}

	mesh.updateMatrix();
	applyStickerAtlasRangeUV( mesh, gi, mesh.material, s );

	// Follow char anim opacity (position already tracks charGroup matrixWorld).
	const followOp = ( follow && charGroup )
		? readCharAnimOpacity( animRoot, gi )
		: 1;
	applyStickerFollowOpacity( mesh, s, followOp );

}

export function applyTextStickers( group, materialsMap ) {

	if ( ! group || ! isUIText( group ) ) return;
	const ui = getFccUI( group );
	if ( ! ui ) return;

	if ( ! Array.isArray( ui.textStickers ) ) {

		clearAllStickerRoots( group );
		return;

	}

	const list = ensureTextStickersOnUI( ui );
	if ( ! list.length ) {

		clearAllStickerRoots( group );
		return;

	}

	syncTextStickers( group, materialsMap );
	const behind = group.getObjectByName( FCC_TEXT_STICKERS_ROOT_BEHIND );
	const front = group.getObjectByName( FCC_TEXT_STICKERS_ROOT_FRONT );
	if ( behind ) placeRootAmongSiblings( group, behind, 'behind' );
	if ( front ) placeRootAmongSiblings( group, front, 'front' );
	if ( behind ) stampStickerLayers( behind, group );
	if ( front ) stampStickerLayers( front, group );

	const chars = listStickerChars( ui.text );
	const charCount = chars.length;
	const layoutSrc = findLayoutSourceTroika( group );
	const carets = readCaretPositions( layoutSrc );
	const glyphBounds = readGlyphBounds( layoutSrc );
	const strIndex = animToStringIndex( ui.text );
	const fs = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;

	const animRoot = group.getObjectByName( FCC_TEXTANIM_ROOT );
	const animReady = !!( animRoot && animRoot.userData && animRoot.userData.__fccReady );

	group.updateMatrixWorld( true );

	const sorted = list.slice().sort( ( a, b ) => ( a.sort - b.sort ) || 0 );

	for ( let i = 0; i < sorted.length; i ++ ) {

		const s = sorted[ i ];
		const parentRoot = s.layer === 'front' ? front : behind;
		if ( ! parentRoot ) continue;

		const isFront = s.layer === 'front';
		const sortBase = isFront ? 10000 : - 10000;
		const zBump = ( isFront ? 0.5 : - 0.5 ) + i * 0.001;
		const follow = s.followCharAnim !== false && animReady;
		const pieces = collectStickerMeshes( parentRoot, s.id );

		if ( ! s.enabled || charCount <= 0 ) {
			for ( let pi = 0; pi < pieces.length; pi ++ ) pieces[ pi ].visible = false;
			continue;
		}

		// --- char: 'each' — one piece per glyph + texture.range strip ---
		if ( s.char === 'each' ) {
			const poseOpts = {
				group, animRoot, follow, carets, glyphBounds, strIndex, fs, zBump, sortBase,
			};
			for ( let gi = 0; gi < charCount; gi ++ ) {
				let mesh = null;
				for ( let pi = 0; pi < pieces.length; pi ++ ) {
					if ( pieces[ pi ].userData.__fccStickerGi === gi ) { mesh = pieces[ pi ]; break; }
				}
				if ( ! mesh ) continue;
				mesh.visible = true;
				poseStickerOnGlyph( mesh, s, gi, poseOpts );
			}
			// Hide extras if text shortened mid-frame before sync.
			for ( let pi = 0; pi < pieces.length; pi ++ ) {
				const g = pieces[ pi ].userData.__fccStickerGi;
				if ( g == null || g < 0 || g >= charCount ) pieces[ pi ].visible = false;
			}
			continue;
		}

		const mesh = parentRoot.getObjectByName( stickerPieceName( s.id, null ) )
			|| pieces.find( ( p ) => ( p.userData.__fccStickerGi == null || p.userData.__fccStickerGi < 0 ) )
			|| pieces[ 0 ];
		if ( ! mesh ) continue;
		mesh.visible = true;
		mesh.renderOrder = sortBase + ( Number( s.sort ) || 0 );

		// --- char: 'all' — whole text AABB ---
		if ( s.char === 'all' ) {

			let aabb = fullTextAabbFromLayout( layoutSrc, carets, glyphBounds, fs );
			if ( follow && animRoot && charCount > 0 ) {

				const uni = unionFollowedCharsAabb(
					group, animRoot, carets, glyphBounds, charCount, strIndex, fs,
				);
				if ( uni ) aabb = uni;

			}
			const planeW = Math.max( 0.001, aabb.w * s.scaleX );
			const planeH = Math.max( 0.001, aabb.h * s.scaleY );
			mesh.position.set( aabb.cx + s.offsetX, aabb.cy + s.offsetY, zBump );
			mesh.rotation.set( 0, 0, s.rotation );
			mesh.scale.set( planeW, planeH, 1 );
			mesh.updateMatrix();
			applyStickerAtlasRangeUV( mesh, 0, mesh.material, s );
			const followOpAll = follow
				? readAllCharsAnimOpacity( animRoot, charCount )
				: 1;
			applyStickerFollowOpacity( mesh, s, followOpAll );
			continue;

		}

		const gi = resolveStickerCharIndex( s, charCount );
		if ( gi < 0 ) {
			mesh.visible = false;
			continue;
		}
		poseStickerOnGlyph( mesh, s, gi, {
			group, animRoot, follow, carets, glyphBounds, strIndex, fs, zBump, sortBase,
		} );

	}

}

/**
 * True when any enabled text sticker asks for layer === 'front'.
 * Used by Viewport Text→RT→TextFx to schedule a post-blit front pass.
 */
export function sceneHasFrontTextStickers( sceneRoot ) {

	if ( ! sceneRoot ) return false;
	let found = false;
	sceneRoot.traverse( ( obj ) => {

		if ( found ) return;
		if ( ! isUIText( obj ) ) return;
		if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
		const ui = getFccUI( obj );
		if ( ! ui || ! Array.isArray( ui.textStickers ) ) return;
		for ( let i = 0; i < ui.textStickers.length; i ++ ) {

			const s = ui.textStickers[ i ];
			if ( ! s || s.enabled === false ) continue;
			if ( s.layer === 'front' ) {

				found = true;
				return;

			}

		}

	} );
	return found;

}

/** Show/hide `__fccTextStickersFront` roots (parent visibility; meshes stay enabled). */
export function setTextStickerFrontRootsVisible( sceneRoot, visible ) {

	if ( ! sceneRoot ) return;
	const v = !! visible;
	sceneRoot.traverse( ( obj ) => {

		if ( ! isUIText( obj ) ) return;
		if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
		const front = obj.getObjectByName( FCC_TEXT_STICKERS_ROOT_FRONT );
		if ( front ) front.visible = v;

	} );

}

/**
 * Hide every child of each Text group except the front stickers root, run `fn`,
 * then restore. Used to present front stickers alone after TextFx blit so they
 * sit above the effect stack without re-drawing text/flower into the letterbox.
 */
export function withTextContentHiddenExceptFrontStickers( sceneRoot, fn ) {

	if ( ! sceneRoot || typeof fn !== 'function' ) return fn && fn();
	const restored = [];
	sceneRoot.traverse( ( obj ) => {

		if ( ! isUIText( obj ) ) return;
		if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
		for ( let i = 0; i < obj.children.length; i ++ ) {

			const c = obj.children[ i ];
			if ( ! c ) continue;
			if ( c.name === FCC_TEXT_STICKERS_ROOT_FRONT ) {

				c.visible = true;
				continue;

			}
			if ( c.visible ) {

				restored.push( c );
				c.visible = false;

			}

		}

	} );
	try {

		return fn();

	} finally {

		for ( let i = 0; i < restored.length; i ++ ) restored[ i ].visible = true;

	}

}

export function applyTextStickersInScene( sceneRoot, materialsMap ) {

	if ( ! sceneRoot ) return;
	sceneRoot.traverse( ( obj ) => {

		if ( ! isUIText( obj ) ) return;
		if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
		applyTextStickers( obj, materialsMap );

	} );

}

/** Find sticker mesh under a Text group by sticker id. */
export function findTextStickerMesh( group, stickerId ) {

	if ( ! group || ! stickerId ) return null;
	const name = stickerPieceName( stickerId, null );
	for ( const rootName of [ FCC_TEXT_STICKERS_ROOT_BEHIND, FCC_TEXT_STICKERS_ROOT_FRONT, FCC_TEXT_STICKERS_ROOT ] ) {

		const root = group.getObjectByName( rootName );
		if ( ! root ) continue;
		const mesh = root.getObjectByName( name );
		if ( mesh ) return mesh;
		// each-mode: return first piece so Material-tab edit still works
		const pieces = collectStickerMeshes( root, stickerId );
		if ( pieces.length ) {
			pieces.sort( ( a, b ) => ( a.userData.__fccStickerGi || 0 ) - ( b.userData.__fccStickerGi || 0 ) );
			return pieces[ 0 ];
		}

	}
	return group.getObjectByName( name ) || null;

}


export function serializeTextStickersForExport( ui ) {

	if ( ! ui || ! Array.isArray( ui.textStickers ) || ! ui.textStickers.length ) return null;
	return ui.textStickers.map( ( s ) => {

		const n = normalizeTextSticker( s );
		const out = {
			id: n.id,
			name: n.name,
			enabled: n.enabled,
			sort: n.sort,
			char: n.char,
			charIndex: n.charIndex,
			textureRange: n.textureRange,
			scaleX: n.scaleX,
			scaleY: n.scaleY,
			offsetX: n.offsetX,
			offsetY: n.offsetY,
			rotation: n.rotation,
			followCharAnim: n.followCharAnim,
			layer: n.layer,
			material: n.material,
			materialUuid: n.materialUuid,
			texturePath: n.texturePath,
			textureFileName: n.textureFileName,
			opacity: n.opacity,
			color: n.color,
		};
		if ( n.rtTargetUuid ) out.rtTargetUuid = n.rtTargetUuid;
		else if ( isStickerRtPath( n.texturePath ) ) out.rtTargetUuid = n.texturePath.slice( 3 );
		return out;

	} );

}
