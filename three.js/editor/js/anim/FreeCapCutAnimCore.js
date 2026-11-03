/**
 * FreeFilmCut .anim core — schema helpers, sampling, apply to Object3D.
 * Paths: transform | ui rect (anchoredPosition / localEulerAngles / localScale)
 *        | material.<uuid>.uniforms.<name>[.comp] | postProcess.<effectId>.<param>
 *        | textAnim.<compId>.<field> (runtime overrides, see ui/TextAnimOverrides.js)
 * See docs/animation-format.md
 */

import { applyAnimEase, isAnimEase } from './AnimEase.js';
import { beginTextAnimTarget, setTextAnimOverride, clearTextAnimOverrides } from '../ui/TextAnimOverrides.js';

const BELOW_INPUT_UNIFORM_NAMES = [ 'uInput', 'belowInput', 'iChannel0' ];
function isBelowInputUniformName( name ) {

	return BELOW_INPUT_UNIFORM_NAMES.includes( name );

}

export const ANIM_FORMAT = 'freecapcut.anim/2';
export const ANIM_FPS_OPTIONS = [ 24, 25, 30 ];

export function createEmptyAnim( name = 'Animation', fps = 30 ) {

	return {
		format: ANIM_FORMAT,
		name: String( name || 'Animation' ),
		fps: ANIM_FPS_OPTIONS.includes( fps ) ? fps : 30,
		duration: 1.0,
		loop: 'clamp',
		targets: [],
	};

}

export function normalizeAnim( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return createEmptyAnim();
	const clip = createEmptyAnim( raw.name, Number( raw.fps ) || 30 );
	clip.duration = Math.max( 0, Number( raw.duration ) || 0 );
	clip.loop = raw.loop === 'loop' ? 'loop' : 'clamp';
	clip.targets = Array.isArray( raw.targets ) ? raw.targets.map( normalizeTarget ).filter( Boolean ) : [];
	return clip;

}

function normalizeTarget( t ) {

	if ( ! t || ! t.objectUuid ) return null;
	return {
		objectUuid: String( t.objectUuid ),
		tracks: Array.isArray( t.tracks ) ? t.tracks.map( normalizeTrack ).filter( Boolean ) : [],
	};

}

function normalizeKey( k ) {

	const out = { t: Number( k && k.t ), v: Number( k && k.v ) };
	if ( k && isAnimEase( k.ease ) && k.ease !== 'linear' ) out.ease = k.ease;
	return out;

}

function normalizeTrack( tr ) {

	if ( ! tr || ! tr.path ) return null;
	const keys = Array.isArray( tr.keys )
		? tr.keys
			.map( normalizeKey )
			.filter( ( k ) => Number.isFinite( k.t ) && Number.isFinite( k.v ) )
			.sort( ( a, b ) => a.t - b.t )
		: [];
	return {
		path: String( tr.path ),
		interp: tr.interp === 'step' ? 'step' : 'linear',
		keys,
	};

}

export function mapAnimTime( t, duration, loop = 'clamp' ) {

	const d = Math.max( 0, Number( duration ) || 0 );
	if ( d <= 0 ) return 0;
	let x = Number( t ) || 0;
	if ( loop === 'loop' ) {

		x = x % d;
		if ( x < 0 ) x += d;
		return x;

	}
	return Math.max( 0, Math.min( d, x ) );

}

export function sampleKeys( keys, t, interp = 'linear' ) {

	if ( ! keys || keys.length === 0 ) return null;
	if ( t <= keys[ 0 ].t ) return keys[ 0 ].v;
	if ( t >= keys[ keys.length - 1 ].t ) return keys[ keys.length - 1 ].v;
	for ( let i = 0; i < keys.length - 1; i ++ ) {

		const a = keys[ i ];
		const b = keys[ i + 1 ];
		if ( t >= a.t && t <= b.t ) {

			if ( interp === 'step' || b.t === a.t ) return a.v;
			const u = applyAnimEase( a.ease || 'linear', ( t - a.t ) / ( b.t - a.t ) );
			return a.v + ( b.v - a.v ) * u;

		}

	}
	return keys[ keys.length - 1 ].v;

}

const TRANSFORM_PATHS = new Set( [
	'position.x', 'position.y', 'position.z',
	'rotation.x', 'rotation.y', 'rotation.z',
	'scale.x', 'scale.y', 'scale.z',
] );

/**
 * UI Image/Text rect. Written into fccUI so layout (which overwrites Object3D TRS
 * every frame) keeps the sampled values. Degrees for rotation, pixels for position.
 */
const UI_TRANSFORM_SPEC = {
	'ui.anchoredPosition.x': { key: 'anchoredPosition', index: 0, len: 2, fill: 0 },
	'ui.anchoredPosition.y': { key: 'anchoredPosition', index: 1, len: 2, fill: 0 },
	'ui.localEulerAngles.x': { key: 'localEulerAngles', index: 0, len: 3, fill: 0 },
	'ui.localEulerAngles.y': { key: 'localEulerAngles', index: 1, len: 3, fill: 0 },
	'ui.localEulerAngles.z': { key: 'localEulerAngles', index: 2, len: 3, fill: 0 },
	'ui.localScale.x': { key: 'localScale', index: 0, len: 3, fill: 1 },
	'ui.localScale.y': { key: 'localScale', index: 1, len: 3, fill: 1 },
	'ui.localScale.z': { key: 'localScale', index: 2, len: 3, fill: 1 },
};

const FCC_IMAGE_MESH_NAME = '__fccImageMesh';

export const TEXTANIM_PATH_PREFIX = 'textAnim.';

export function isTextAnimPath( path ) {

	return String( path || '' ).indexOf( TEXTANIM_PATH_PREFIX ) === 0;

}

export function isTransformPath( path ) {

	return TRANSFORM_PATHS.has( path );

}

export function isUITransformPath( path ) {

	return Object.prototype.hasOwnProperty.call( UI_TRANSFORM_SPEC, path );

}

/** Image / Text. Canvas placement is not a rect key. */
export function isUIAnimTarget( object ) {

	const ui = object && object.userData && object.userData.fccUI;
	return !!( ui && ui.type && ui.type !== 'canvas' );

}

function fccUIBag( object ) {

	if ( ! isUIAnimTarget( object ) ) return null;
	return object.userData.fccUI;

}

export function getUITransformValue( object, path ) {

	const spec = UI_TRANSFORM_SPEC[ path ];
	const ui = fccUIBag( object );
	if ( ! spec || ! ui ) return null;
	const arr = ui[ spec.key ];
	if ( Array.isArray( arr ) ) {

		const n = Number( arr[ spec.index ] );
		if ( Number.isFinite( n ) ) return n;

	}
	return spec.fill;

}

export function setUITransformValue( object, path, value ) {

	const spec = UI_TRANSFORM_SPEC[ path ];
	const ui = fccUIBag( object );
	if ( ! spec || ! ui || ! Number.isFinite( value ) ) return false;
	let arr = ui[ spec.key ];
	if ( ! Array.isArray( arr ) ) {

		arr = [];
		ui[ spec.key ] = arr;

	}
	for ( let i = 0; i < spec.len; i ++ ) {

		if ( ! Number.isFinite( Number( arr[ i ] ) ) ) arr[ i ] = spec.fill;

	}
	arr[ spec.index ] = value;
	return true;

}

const RAD_TO_DEG = 180 / Math.PI;

function ensureUINumberArray( ui, key, len, fill ) {

	let arr = ui[ key ];
	if ( ! Array.isArray( arr ) ) {

		arr = [];
		ui[ key ] = arr;

	}
	for ( let i = 0; i < len; i ++ ) {

		if ( ! Number.isFinite( Number( arr[ i ] ) ) ) arr[ i ] = fill;

	}
	return arr;

}

/**
 * Object3D position/rotation/scale on a UI node. Layout overwrites those every
 * frame, so store rotation (deg) and scale on fccUI, and keep keyed local
 * position for the layout pass.
 */
function applyLegacyUIObjectPath( object, path, value ) {

	const ui = fccUIBag( object );
	if ( ! ui || ! Number.isFinite( value ) ) return false;
	const parts = String( path ).split( '.' );
	if ( parts.length !== 2 ) return false;
	const index = parts[ 1 ] === 'x' ? 0 : parts[ 1 ] === 'y' ? 1 : parts[ 1 ] === 'z' ? 2 : - 1;
	if ( index < 0 ) return false;

	if ( parts[ 0 ] === 'rotation' ) {

		ensureUINumberArray( ui, 'localEulerAngles', 3, 0 )[ index ] = value * RAD_TO_DEG;
		return true;

	}
	if ( parts[ 0 ] === 'scale' ) {

		ensureUINumberArray( ui, 'localScale', 3, 1 )[ index ] = value;
		return true;

	}
	if ( parts[ 0 ] === 'position' ) {

		if ( parts[ 1 ] === 'z' ) {

			object.position.z = value;
			return true;

		}
		// Layout sets local position = anchoredPosition + constant, so
		// anchor += keyedPosition - currentPosition.
		const arr = ensureUINumberArray( ui, 'anchoredPosition', 2, 0 );
		const currentAnchor = Number( arr[ index ] ) || 0;
		const currentPos = parts[ 1 ] === 'x' ? object.position.x : object.position.y;
		arr[ index ] = currentAnchor + ( value - currentPos );
		return true;

	}
	return false;

}

/** True when one track under this prefix has two different key values. */
function trackPrefixVaries( target, prefix ) {

	for ( const tr of target.tracks || [] ) {

		if ( ! tr || ! tr.keys || tr.keys.length < 2 ) continue;
		if ( String( tr.path || '' ).indexOf( prefix ) !== 0 ) continue;
		let first = null;
		for ( const key of tr.keys ) {

			const raw = key && ( key.v !== undefined ? key.v : key.value );
			const v = Number( raw );
			if ( ! Number.isFinite( v ) ) continue;
			if ( first === null ) first = v;
			else if ( Math.abs( v - first ) > 1e-4 ) return true;

		}

	}
	return false;

}

function isolateUserDataFromAncestors( object ) {

	let p = object.parent;
	while ( p ) {

		if ( p.userData && p.userData === object.userData ) {

			try {

				object.userData = JSON.parse( JSON.stringify( object.userData ) );

			} catch ( e ) {

				const ui = object.userData.fccUI;
				object.userData = { ...object.userData, fccUI: ui ? { ...ui } : ui };

			}
			break;

		}
		p = p.parent;

	}

}

/** Canvas must not keep an empty controller just because a child Image/Text has one. */
function clearEmptyCanvasAncestorControllers( editor, object ) {

	isolateUserDataFromAncestors( object );
	let p = object.parent;
	while ( p && p.isScene !== true ) {

		const ui = p.userData && p.userData.fccUI;
		const ctrl = p.userData && p.userData.freecapcutAnimController;
		const childHasCtrl = object.userData && object.userData.freecapcutAnimController;
		if ( ui && ui.type === 'canvas' && ctrl && childHasCtrl && countObjectAnimKeys( editor, p.uuid ) === 0 ) {

			delete p.userData.freecapcutAnimController;
			stripEmptyAnimTargets( editor, p.uuid );

		}
		p = p.parent;

	}

}

/** Drop empty Canvas controllers created beside a child Image/Text controller. */
export function releaseEmptyCanvasControllers( editor ) {

	const root = editor && editor.scene;
	if ( ! root || typeof root.traverse !== 'function' ) return;
	const nodes = [];
	root.traverse( ( obj ) => {

		if ( isUIAnimTarget( obj ) ) nodes.push( obj );

	} );
	for ( const obj of nodes ) clearEmptyCanvasAncestorControllers( editor, obj );

}

function stripEmptyAnimTargets( editor, objectUuid ) {

	for ( const clip of listEditorAnimClips( editor ) ) {

		if ( ! clip || ! Array.isArray( clip.targets ) ) continue;
		clip.targets = clip.targets.filter( ( t ) => {

			if ( ! t || t.objectUuid !== objectUuid ) return true;
			const keys = ( t.tracks || [] ).some( ( tr ) => tr && tr.keys && tr.keys.length );
			return keys;

		} );

	}

}

/** @returns {{ materialUuid: string, uniform: string, comp: string|null }|null} */
export function parseMaterialPath( path ) {

	const m = String( path || '' ).match( /^material\.([^.]+)\.uniforms\.([^.]+)(?:\.(x|y|z|w|r|g|b))?$/ );
	if ( ! m ) return null;
	return { materialUuid: m[ 1 ], uniform: m[ 2 ], comp: m[ 3 ] || null };

}

/** @returns {{ effectId: string, param: string, comp: string|null }|null} */
export function parsePostProcessPath( path ) {

	const m = String( path || '' ).match( /^postProcess\.([^.]+)\.([^.]+)(?:\.(x|y|z|w|r|g|b))?$/ );
	if ( ! m ) return null;
	return { effectId: m[ 1 ], param: m[ 2 ], comp: m[ 3 ] || null };

}

export function isMaterialPath( path ) {

	return !! parseMaterialPath( path );

}

export function isPostProcessPath( path ) {

	return !! parsePostProcessPath( path );

}

export function buildMaterialUniformPath( materialUuid, uniform, comp = null ) {

	const base = 'material.' + materialUuid + '.uniforms.' + uniform;
	return comp ? base + '.' + comp : base;

}

export function buildPostProcessParamPath( effectId, param, comp = null ) {

	const base = 'postProcess.' + effectId + '.' + param;
	return comp ? base + '.' + comp : base;

}

function hexToRgb01( hex ) {

	const h = String( hex || '#ffffff' ).replace( '#', '' );
	const full = h.length === 3
		? h.split( '' ).map( ( c ) => c + c ).join( '' )
		: h.slice( 0, 6 );
	const n = parseInt( full, 16 );
	if ( ! Number.isFinite( n ) ) return { r: 1, g: 1, b: 1 };
	return {
		r: ( ( n >> 16 ) & 255 ) / 255,
		g: ( ( n >> 8 ) & 255 ) / 255,
		b: ( n & 255 ) / 255,
	};

}

function rgb01ToHex( r, g, b ) {

	const to = ( v ) => Math.max( 0, Math.min( 255, Math.round( Number( v ) * 255 ) ) )
		.toString( 16 ).padStart( 2, '0' );
	return '#' + to( r ) + to( g ) + to( b );

}

/**
 * Scalar key channels for a PP param (null comp = whole scalar/bool).
 * @returns {{ comp: string|null, value: number }[]}
 */
export function listPostProcessParamKeyChannels( schemaType, rawValue ) {

	const t = String( schemaType || '' );
	if ( t === 'boolean' ) return [ { comp: null, value: rawValue ? 1 : 0 } ];
	if ( t === 'float' || t === 'int' ) return [ { comp: null, value: Number( rawValue ) || 0 } ];
	if ( t === 'vec2' || t === 'vec3' || t === 'vec4' ) {

		const size = Number( t.slice( 3 ) ) || 2;
		const labels = [ 'x', 'y', 'z', 'w' ];
		const arr = Array.isArray( rawValue ) ? rawValue : [];
		const out = [];
		for ( let i = 0; i < size; i ++ ) {

			out.push( { comp: labels[ i ], value: Number( arr[ i ] ) || 0 } );

		}
		return out;

	}
	if ( t === 'color' ) {

		const rgb = hexToRgb01( typeof rawValue === 'string' ? rawValue : '#ffffff' );
		return [
			{ comp: 'r', value: rgb.r },
			{ comp: 'g', value: rgb.g },
			{ comp: 'b', value: rgb.b },
		];

	}
	return [];

}

export function getObjectPathValue( object, path ) {

	if ( ! object || ! path ) return null;
	const parts = String( path ).split( '.' );
	if ( parts.length === 2 && object[ parts[ 0 ] ] ) {

		const v = object[ parts[ 0 ] ][ parts[ 1 ] ];
		return typeof v === 'number' ? v : null;

	}
	return null;

}

export function setObjectPathValue( object, path, value ) {

	if ( ! object || ! path || ! Number.isFinite( value ) ) return false;
	const parts = String( path ).split( '.' );
	if ( parts.length === 2 && object[ parts[ 0 ] ] ) {

		object[ parts[ 0 ] ][ parts[ 1 ] ] = value;
		return true;

	}
	return false;

}

function findMaterialByUuid( root, materialsByUuid, uuid ) {

	if ( materialsByUuid && materialsByUuid.get ) {

		const m = materialsByUuid.get( uuid );
		if ( m ) return m;

	}
	if ( ! root || ! uuid ) return null;
	let found = null;
	root.traverse( ( obj ) => {

		if ( found ) return;
		const mat = obj.material;
		if ( ! mat ) return;
		const mats = Array.isArray( mat ) ? mat : [ mat ];
		for ( const m of mats ) {

			if ( m && m.uuid === uuid ) {

				found = m;
				return;

			}

		}

	} );
	return found;

}

function readUniformComponent( uVal, comp ) {

	if ( typeof uVal === 'number' ) return comp ? null : uVal;
	if ( typeof uVal === 'boolean' ) return comp ? null : ( uVal ? 1 : 0 );
	if ( ! uVal || ! comp ) return null;
	if ( typeof uVal[ comp ] === 'number' ) return uVal[ comp ];
	return null;

}

function writeUniformComponent( uniformBag, comp, value ) {

	if ( ! uniformBag ) return false;
	const cur = uniformBag.value;
	if ( typeof cur === 'number' || typeof cur === 'boolean' ) {

		if ( comp ) return false;
		uniformBag.value = typeof cur === 'boolean' ? ( value >= 0.5 ) : value;
		return true;

	}
	if ( cur && typeof cur[ comp ] === 'number' ) {

		cur[ comp ] = value;
		return true;

	}
	return false;

}

/**
 * UI Image stores its shader material on the child mesh, not the selected Group.
 * @param {object} object
 */
function materialSourceObject( object ) {

	if ( ! object ) return null;
	if ( object.material ) return object;
	if ( typeof object.getObjectByName === 'function' ) {

		const mesh = object.getObjectByName( FCC_IMAGE_MESH_NAME );
		if ( mesh && mesh.material ) return mesh;

	}
	return null;

}

/**
 * List keyable material uniform paths for an object (prefer exposedUniforms).
 * @returns {{ path: string, value: number, label: string }[]}
 */
export function listMaterialKeyPaths( object ) {

	const out = [];
	const host = materialSourceObject( object );
	if ( ! host || ! host.material ) return out;
	const mats = Array.isArray( host.material ) ? host.material : [ host.material ];
	for ( const mat of mats ) {

		if ( ! mat || ! mat.uniforms ) continue;
		const exposed = ( mat.userData && mat.userData.exposedUniforms ) || {};
		const exposedNames = Object.keys( exposed ).filter( ( k ) => exposed[ k ] );
		const names = exposedNames.length > 0 ? exposedNames : Object.keys( mat.uniforms );
		for ( const name of names ) {

			if ( isBelowInputUniformName && isBelowInputUniformName( name ) ) continue;
			const u = mat.uniforms[ name ];
			if ( ! u ) continue;
			const val = u.value;
			if ( typeof val === 'number' ) {

				out.push( {
					path: buildMaterialUniformPath( mat.uuid, name ),
					value: val,
					label: mat.name ? ( mat.name + '.' + name ) : name,
				} );

			} else if ( typeof val === 'boolean' ) {

				out.push( {
					path: buildMaterialUniformPath( mat.uuid, name ),
					value: val ? 1 : 0,
					label: mat.name ? ( mat.name + '.' + name ) : name,
					interp: 'step',
				} );

			} else if ( val && ( val.isVector2 || val.isVector3 || val.isVector4 ) ) {

				const comps = val.isVector2 ? [ 'x', 'y' ] : val.isVector4 ? [ 'x', 'y', 'z', 'w' ] : [ 'x', 'y', 'z' ];
				for ( const c of comps ) {

					out.push( {
						path: buildMaterialUniformPath( mat.uuid, name, c ),
						value: val[ c ],
						label: ( mat.name || 'mat' ) + '.' + name + '.' + c,
					} );

				}

			} else if ( val && val.isColor ) {

				for ( const c of [ 'r', 'g', 'b' ] ) {

					out.push( {
						path: buildMaterialUniformPath( mat.uuid, name, c ),
						value: val[ c ],
						label: ( mat.name || 'mat' ) + '.' + name + '.' + c,
					} );

				}

			}

		}

	}
	return out;

}

/**
 * List keyable post-process param paths for a camera.
 * @returns {{ path: string, value: number, label: string, interp?: string }[]}
 */
export function listPostProcessKeyPaths( camera ) {

	const out = [];
	if ( ! camera || ! camera.isCamera ) return out;
	const stack = camera.userData && camera.userData.postProcessStack;
	if ( ! stack || ! Array.isArray( stack.effects ) ) return out;
	for ( const entry of stack.effects ) {

		if ( ! entry || entry.enabled === false ) continue;
		const params = entry.params || {};
		for ( const [ key, val ] of Object.entries( params ) ) {

			if ( typeof val === 'number' ) {

				out.push( {
					path: buildPostProcessParamPath( entry.id, key ),
					value: val,
					label: ( entry.type || 'fx' ) + '.' + key,
				} );

			} else if ( typeof val === 'boolean' ) {

				out.push( {
					path: buildPostProcessParamPath( entry.id, key ),
					value: val ? 1 : 0,
					label: ( entry.type || 'fx' ) + '.' + key,
					interp: 'step',
				} );

			}

		}

	}
	return out;

}

function applyMaterialPath( root, path, value, materialsByUuid ) {

	const parsed = parseMaterialPath( path );
	if ( ! parsed ) return false;
	const mat = findMaterialByUuid( root, materialsByUuid, parsed.materialUuid );
	if ( ! mat || ! mat.uniforms || ! mat.uniforms[ parsed.uniform ] ) return false;
	const ok = writeUniformComponent( mat.uniforms[ parsed.uniform ], parsed.comp, value );
	if ( ok ) mat.needsUpdate = true;
	return ok;

}

function applyPostProcessPath( root, objectUuid, path, value, postProcessStack ) {

	const parsed = parsePostProcessPath( path );
	if ( ! parsed ) return false;

	let stack = postProcessStack || null;
	if ( ! stack && root ) {

		const cam = objectUuid
			? root.getObjectByProperty( 'uuid', objectUuid )
			: null;
		if ( cam && cam.userData && cam.userData.postProcessStack ) {

			stack = cam.userData.postProcessStack;

		} else {

			// Fallback: first camera with a stack
			root.traverse( ( obj ) => {

				if ( stack ) return;
				if ( obj.isCamera && obj.userData && obj.userData.postProcessStack ) {

					stack = obj.userData.postProcessStack;

				}

			} );

		}

	}
	if ( ! stack || ! Array.isArray( stack.effects ) ) return false;
	const entry = stack.effects.find( ( e ) => e && e.id === parsed.effectId );
	if ( ! entry ) return false;
	if ( ! entry.params || typeof entry.params !== 'object' ) entry.params = {};
	const prev = entry.params[ parsed.param ];
	const comp = parsed.comp;

	if ( comp === 'r' || comp === 'g' || comp === 'b' ) {

		const rgb = hexToRgb01( typeof prev === 'string' ? prev : '#ffffff' );
		rgb[ comp ] = value;
		entry.params[ parsed.param ] = rgb01ToHex( rgb.r, rgb.g, rgb.b );
		return true;

	}

	if ( comp === 'x' || comp === 'y' || comp === 'z' || comp === 'w' ) {

		const idx = { x: 0, y: 1, z: 2, w: 3 }[ comp ];
		const arr = Array.isArray( prev ) ? prev.slice() : [ 0, 0, 0, 0 ];
		while ( arr.length <= idx ) arr.push( 0 );
		arr[ idx ] = value;
		entry.params[ parsed.param ] = arr;
		return true;

	}

	if ( typeof prev === 'boolean' ) {

		entry.params[ parsed.param ] = value >= 0.5;
		return true;

	}
	entry.params[ parsed.param ] = value;
	return true;

}

/**
 * Apply one .anim clip to a scene graph at local time t.
 * @param {object} [opts]
 * @param {Map<string, Material>} [opts.materialsByUuid]
 * @param {object} [opts.postProcess] — OpenCut BuiltPackScene.postProcess stack
 */
export function applyAnimToRoot( root, clip, t, opts = {} ) {

	if ( ! root || ! clip ) return 0;
	const tc = mapAnimTime( t, clip.duration, clip.loop );
	const materialsByUuid = opts.materialsByUuid || null;
	const postProcess = opts.postProcess || null;
	let n = 0;
	for ( const target of clip.targets || [] ) {

		const obj = root.getObjectByProperty( 'uuid', target.objectUuid );
		let touchedXform = false;
		const uiPosVaries = trackPrefixVaries( target, 'ui.anchoredPosition.' );
		const uiRotVaries = trackPrefixVaries( target, 'ui.localEulerAngles.' );
		const uiScaleVaries = trackPrefixVaries( target, 'ui.localScale.' );
		const legacyPosVaries = trackPrefixVaries( target, 'position.' );
		const legacyRotVaries = trackPrefixVaries( target, 'rotation.' );
		const legacyScaleVaries = trackPrefixVaries( target, 'scale.' );
		if ( obj && ( target.tracks || [] ).some( ( tr ) => tr && isTextAnimPath( tr.path ) && tr.keys && tr.keys.length ) ) {

			// Only begin (clear+clock) when THIS clip drives textAnim. Never clear
			// here for transform-only clips — that wiped progress keys written by
			// another per-object clip during applyAllEditorAnims.
			beginTextAnimTarget( obj, tc );

		}
		for ( const track of target.tracks || [] ) {

			const v = sampleKeys( track.keys, tc, track.interp );
			if ( v === null ) continue;

			if ( isTextAnimPath( track.path ) ) {

				if ( obj ) {

					setTextAnimOverride( obj, track.path.slice( TEXTANIM_PATH_PREFIX.length ), v, track.keys );
					n ++;

				}
				continue;

			}

			if ( obj && isUIAnimTarget( obj ) && isTransformPath( track.path ) ) {

				const channel = String( track.path ).split( '.' )[ 0 ];
				if ( channel === 'position' && uiPosVaries ) continue;
				if ( channel === 'rotation' && uiRotVaries ) continue;
				if ( channel === 'scale' && uiScaleVaries ) continue;
				if ( applyLegacyUIObjectPath( obj, track.path, v ) ) n ++;
				continue;

			}

			if ( isUITransformPath( track.path ) ) {

				if ( ! obj ) continue;
				const p = String( track.path );
				if ( p.indexOf( 'ui.anchoredPosition.' ) === 0 && ! uiPosVaries && legacyPosVaries ) continue;
				if ( p.indexOf( 'ui.localEulerAngles.' ) === 0 && ! uiRotVaries && legacyRotVaries ) continue;
				if ( p.indexOf( 'ui.localScale.' ) === 0 && ! uiScaleVaries && legacyScaleVaries ) continue;
				if ( setUITransformValue( obj, track.path, v ) ) n ++;
				continue;

			}

			if ( isTransformPath( track.path ) ) {

				if ( ! obj ) continue;
				if ( setObjectPathValue( obj, track.path, v ) ) {

					touchedXform = true;
					n ++;

				}
				continue;

			}

			if ( isMaterialPath( track.path ) ) {

				if ( applyMaterialPath( root, track.path, v, materialsByUuid ) ) n ++;
				continue;

			}

			if ( isPostProcessPath( track.path ) ) {

				if ( applyPostProcessPath( root, target.objectUuid, track.path, v, postProcess ) ) n ++;
				continue;

			}

		}
		if ( touchedXform && obj && obj.isCamera && typeof obj.updateProjectionMatrix === 'function' ) {

			obj.updateProjectionMatrix();

		}

	}
	return n;

}

export function ensureTarget( clip, objectUuid ) {

	let t = clip.targets.find( ( x ) => x.objectUuid === objectUuid );
	if ( ! t ) {

		t = { objectUuid, tracks: [] };
		clip.targets.push( t );

	}
	return t;

}

export function ensureTrack( target, path, interp = 'linear' ) {

	let tr = target.tracks.find( ( x ) => x.path === path );
	if ( ! tr ) {

		tr = { path, interp, keys: [] };
		target.tracks.push( tr );

	} else if ( interp === 'step' ) {

		tr.interp = 'step';

	}
	return tr;

}

/** @param {string} [ease] omitted = keep an existing key's ease (new keys: linear) */
export function upsertKey( track, t, v, eps = 1e-4, ease ) {

	const tt = Number( t );
	const vv = Number( v );
	if ( ! Number.isFinite( tt ) || ! Number.isFinite( vv ) ) return null;
	const setEase = ( k ) => {

		if ( ease === undefined ) return;
		if ( isAnimEase( ease ) && ease !== 'linear' ) k.ease = ease;
		else delete k.ease;

	};
	for ( const k of track.keys ) {

		if ( Math.abs( k.t - tt ) <= eps ) {

			k.v = vv;
			setEase( k );
			return k;

		}

	}
	const key = { t: tt, v: vv };
	setEase( key );
	track.keys.push( key );
	track.keys.sort( ( a, b ) => a.t - b.t );
	return key;

}

export function findTrackOnObject( clip, objectUuid, path ) {

	if ( ! clip || ! objectUuid || ! path ) return null;
	const target = ( clip.targets || [] ).find( ( x ) => x && x.objectUuid === objectUuid );
	if ( ! target ) return null;
	return ( target.tracks || [] ).find( ( tr ) => tr && tr.path === path ) || null;

}

export function hasKeyAtTime( track, t, eps = 1e-4 ) {

	if ( ! track || ! Array.isArray( track.keys ) ) return false;
	const tt = Number( t );
	if ( ! Number.isFinite( tt ) ) return false;
	return track.keys.some( ( k ) => Math.abs( k.t - tt ) <= eps );

}

export function removeKeyAtTime( track, t, eps = 1e-4 ) {

	if ( ! track || ! Array.isArray( track.keys ) ) return false;
	const tt = Number( t );
	if ( ! Number.isFinite( tt ) ) return false;
	const before = track.keys.length;
	track.keys = track.keys.filter( ( k ) => Math.abs( k.t - tt ) > eps );
	return track.keys.length !== before;

}

function isPostProcessParamTrackPath( path, effectId, param ) {

	const base = buildPostProcessParamPath( effectId, param );
	return path === base || ( typeof path === 'string' && path.startsWith( base + '.' ) );

}

/** Remove postProcess.{effectId}.{param}(+ .comp) tracks from clips targeting the camera. */
export function removePostProcessParamTracks( editor, camera, effectId, param ) {

	if ( ! editor || ! camera || ! effectId || ! param ) return 0;
	const clips = [];
	if ( Array.isArray( editor.freecapcutAnims ) ) {

		for ( const c of editor.freecapcutAnims ) if ( c ) clips.push( c );

	}
	if ( editor.activeFreecapcutAnim && ! clips.includes( editor.activeFreecapcutAnim ) ) {

		clips.push( editor.activeFreecapcutAnim );

	}
	let n = 0;
	for ( const clip of clips ) {

		for ( const target of clip.targets || [] ) {

			if ( ! target || target.objectUuid !== camera.uuid || ! Array.isArray( target.tracks ) ) continue;
			const before = target.tracks.length;
			target.tracks = target.tracks.filter(
				( tr ) => ! ( tr && isPostProcessParamTrackPath( tr.path, effectId, param ) )
			);
			n += before - target.tracks.length;

		}

	}
	return n;

}

function playheadAnimTime( editor, clip ) {

	const fps = clip.fps || 30;
	const raw = typeof editor.getAnimPreviewTime === 'function'
		? Number( editor.getAnimPreviewTime() ) || 0
		: 0;
	const mapped = mapAnimTime( raw, clip.duration, clip.loop );
	return Math.round( mapped * fps ) / fps;

}

/** True if any channel of this PP param has a key at the playhead. */
export function hasPostProcessParamKeyAtPlayhead( editor, camera, effectId, param, schemaType ) {

	if ( ! editor || ! camera || ! effectId || ! param ) return false;
	const clip = editor.activeFreecapcutAnim;
	if ( ! clip ) return false;
	const t = playheadAnimTime( editor, clip );
	const channels = listPostProcessParamKeyChannels( schemaType, null );
	if ( channels.length === 0 ) {

		const track = findTrackOnObject( clip, camera.uuid, buildPostProcessParamPath( effectId, param ) );
		return !!( track && hasKeyAtTime( track, t ) );

	}
	for ( const ch of channels ) {

		const track = findTrackOnObject(
			clip,
			camera.uuid,
			buildPostProcessParamPath( effectId, param, ch.comp ),
		);
		if ( track && hasKeyAtTime( track, t ) ) return true;

	}
	return false;

}

/**
 * Toggle PP param key(s) at the animation playhead (scalar / bool / vec / color).
 * @returns {'added'|'removed'|null}
 */
export function togglePostProcessParamKeyAtPlayhead( editor, camera, effectId, param, schemaType, rawValue, interp = 'linear' ) {

	if ( ! editor || ! camera || ! camera.isCamera || ! effectId || ! param ) return null;
	const clip = ensureObjectAnimClip( editor, camera );
	const target = ensureTarget( clip, camera.uuid );
	const t = playheadAnimTime( editor, clip );
	const channels = listPostProcessParamKeyChannels( schemaType, rawValue );
	if ( channels.length === 0 ) return null;

	const anyKeyed = channels.some( ( ch ) => {

		const track = findTrackOnObject(
			clip,
			camera.uuid,
			buildPostProcessParamPath( effectId, param, ch.comp ),
		);
		return !!( track && hasKeyAtTime( track, t ) );

	} );

	if ( anyKeyed ) {

		for ( const ch of channels ) {

			const path = buildPostProcessParamPath( effectId, param, ch.comp );
			const track = findTrackOnObject( clip, camera.uuid, path );
			if ( ! track ) continue;
			removeKeyAtTime( track, t );
			if ( track.keys.length === 0 ) {

				target.tracks = ( target.tracks || [] ).filter( ( tr ) => tr !== track );

			}

		}
		recomputeDuration( clip );
		return 'removed';

	}

	for ( const ch of channels ) {

		const path = buildPostProcessParamPath( effectId, param, ch.comp );
		upsertKey( ensureTrack( target, path, interp ), t, ch.value );

	}
	recomputeDuration( clip );
	return 'added';

}

export function recomputeDuration( clip ) {

	let maxT = 0;
	for ( const target of clip.targets || [] ) {

		for ( const track of target.tracks || [] ) {

			for ( const k of track.keys || [] ) {

				if ( k.t > maxT ) maxT = k.t;

			}

		}

	}
	clip.duration = Math.max( clip.duration || 0, maxT, 0.01 );
	return clip.duration;

}

export const DEFAULT_TRANSFORM_PATHS = [
	'position.x', 'position.y', 'position.z',
	'rotation.x', 'rotation.y', 'rotation.z',
	'scale.x', 'scale.y', 'scale.z',
];

/** Keys the animation panel records for the current selection. */
export function listDefaultTransformKeys( object ) {

	if ( isUIAnimTarget( object ) ) {

		return Object.keys( UI_TRANSFORM_SPEC ).map( ( path ) => ( {
			path,
			value: getUITransformValue( object, path ),
		} ) );

	}
	const out = [];
	for ( const path of DEFAULT_TRANSFORM_PATHS ) {

		const value = getObjectPathValue( object, path );
		if ( value === null ) continue;
		out.push( { path, value } );

	}
	return out;

}


/** Deep-clone a clip for project.json / .anim file (no editor-only fields). */
export function serializeAnimClip( clip ) {

	if ( ! clip || typeof clip !== 'object' ) return null;
	const targets = [];
	for ( const t of clip.targets || [] ) {

		if ( ! t || ! t.objectUuid ) continue;
		targets.push( {
			objectUuid: String( t.objectUuid ),
			tracks: ( t.tracks || [] ).map( ( tr ) => ( {
				path: String( tr.path || '' ),
				interp: tr.interp === 'step' ? 'step' : 'linear',
				keys: ( tr.keys || [] ).map( normalizeKey ).filter( ( k ) => Number.isFinite( k.t ) && Number.isFinite( k.v ) ),
			} ) ).filter( ( tr ) => tr.path ),
		} );

	}
	return {
		format: ANIM_FORMAT,
		name: String( clip.name || 'Animation' ),
		fps: Number( clip.fps ) || 30,
		duration: Math.max( 0.01, Number( clip.duration ) || 1 ),
		loop: clip.loop === 'loop' ? 'loop' : 'clamp',
		targets,
	};

}

function clipHasAnyKeys( clip ) {

	return Array.isArray( clip && clip.targets ) && clip.targets.some( ( t ) =>
		t && Array.isArray( t.tracks ) && t.tracks.some( ( tr ) => tr && tr.keys && tr.keys.length )
	);

}

/** Collect unique in-memory clips (active first). */
export function collectEditorAnimClips( editor ) {

	const out = [];
	const seen = new Set();
	const push = ( raw ) => {

		const ser = serializeAnimClip( raw );
		if ( ! ser ) return;
		if ( seen.has( ser.name ) ) return;
		seen.add( ser.name );
		out.push( { serialized: ser, source: raw } );

	};
	if ( editor && editor.activeFreecapcutAnim ) push( editor.activeFreecapcutAnim );
	if ( editor && Array.isArray( editor.freecapcutAnims ) ) {

		for ( const a of editor.freecapcutAnims ) push( a );

	}
	return out;

}

/** Build project.json freecapcut.animations block. */
export function buildProjectAnimPayload( editor ) {

	const entries = collectEditorAnimClips( editor );
	const animations = [];
	const index = [];
	for ( const { serialized, source } of entries ) {

		const hasKeys = clipHasAnyKeys( serialized );
		if ( ! hasKeys ) continue;
		const safe = String( serialized.name || 'Animation' ).replace( /[<>:"/\\|?*\s]+/g, '_' ).slice( 0, 48 ) || 'Animation';
		const path = ( source && source._projectPath ) || ( 'assets/animations/' + safe + '.anim' );
		animations.push( serialized );
		index.push( {
			name: serialized.name,
			path,
			fps: serialized.fps,
			duration: serialized.duration,
		} );

	}
	const active = editor && editor.activeFreecapcutAnim ? String( editor.activeFreecapcutAnim.name || '' ) : '';
	return {
		format: 'freecapcut.project-anims/1',
		activeAnimName: active,
		animations,
		index,
	};

}

/** Apply project.json / loaded clips onto editor. */
export function applyProjectAnimPayload( editor, payload ) {

	if ( ! editor ) return 0;
	const list = [];
	const rawList = ( payload && Array.isArray( payload.animations ) ) ? payload.animations : [];
	for ( const raw of rawList ) {

		const clip = normalizeAnim( raw );
		if ( ! clip ) continue;
		if ( ! clipHasAnyKeys( clip ) ) continue;
		clip._export = true;
		list.push( clip );

	}
	editor.freecapcutAnims = list;
	const want = payload && payload.activeAnimName ? String( payload.activeAnimName ) : '';
	let active = list.find( ( c ) => c.name === want ) || list[ 0 ] || null;
	if ( ! active ) active = createEmptyAnim( 'Animation', 30 );
	editor.activeFreecapcutAnim = active;
	return list.length;

}

/**
 * Write in-memory clips to assets/animations/*.anim when a project folder is bound.
 * @returns {Promise<{ saved: number, paths: string[] }>}
 */
export async function flushFreecapcutAnimsToProject( editor ) {

	const result = { saved: 0, paths: [], deleted: 0 };
	const pf = editor && editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) return result;
	if ( typeof pf.saveBlob !== 'function' ) return result;
	const entries = collectEditorAnimClips( editor );
	const keptFiles = new Set();
	for ( const { serialized, source } of entries ) {

		if ( ! clipHasAnyKeys( serialized ) ) continue;
		const safe = String( serialized.name || 'Animation' ).replace( /[<>:"/\\|?*\s]+/g, '_' ).slice( 0, 48 ) || 'Animation';
		const filename = safe + '.anim';
		const json = JSON.stringify( serialized, null, 2 );
		try {

			const ok = await pf.saveBlob( 'assets/animations', filename, json );
			if ( ok ) {

				const rel = 'assets/animations/' + filename;
				keptFiles.add( filename );
				if ( source ) {

					source._projectPath = rel;
					source._export = true;

				}
				result.saved ++;
				result.paths.push( rel );

			}

		} catch ( e ) {

			console.warn( '[FreeFilmCut] flush .anim failed', filename, e );

		}

	}

	// Remove orphan .anim files so reopen does not resurrect deleted controllers/clips.
	if ( typeof pf.listAssetFiles === 'function' && typeof pf.deleteFile === 'function' ) {

		try {

			const names = await pf.listAssetFiles( 'assets/animations' );
			for ( const name of names || [] ) {

				if ( ! /\.anim$/i.test( name ) ) continue;
				if ( keptFiles.has( name ) ) continue;
				const ok = await pf.deleteFile( 'assets/animations/' + name );
				if ( ok ) result.deleted ++;

			}

		} catch ( e ) {

			console.warn( '[FreeFilmCut] prune orphan .anim failed', e );

		}

	}

	return result;

}

/**
 * Load .anim files from project folder assets/animations/ into editor (merge by name).
 * @param {object} [opts]
 * @param {Set<string>|null} [opts.onlyPaths] If set, only load these pack-relative
 *   paths (or basenames). Empty set = load none (project.json already authoritative).
 *   Null/undefined = legacy full folder scan.
 */
export async function loadFreecapcutAnimsFromProjectFolder( editor, opts = {} ) {

	const pf = editor && editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) return 0;
	if ( typeof pf.listAssetFiles !== 'function' || typeof pf.readTextFile !== 'function' ) return 0;
	const onlyPaths = opts && opts.onlyPaths instanceof Set ? opts.onlyPaths : null;
	let added = 0;
	try {

		const names = await pf.listAssetFiles( 'assets/animations' );
		if ( ! editor.freecapcutAnims ) editor.freecapcutAnims = [];
		const byName = new Map( editor.freecapcutAnims.map( ( c ) => [ c.name, c ] ) );
		for ( const name of names || [] ) {

			if ( ! /\.anim$/i.test( name ) ) continue;
			if ( onlyPaths ) {

				const rel = 'assets/animations/' + name;
				if ( ! onlyPaths.has( rel ) && ! onlyPaths.has( name ) ) continue;

			}
			const text = await pf.readTextFile( 'assets/animations/' + name );
			if ( ! text ) continue;
			try {

				const clip = normalizeAnim( JSON.parse( text ) );
				if ( ! clip || ! clipHasAnyKeys( clip ) ) continue;
				clip._export = true;
				clip._projectPath = 'assets/animations/' + name;
				if ( ! byName.has( clip.name ) ) {

					editor.freecapcutAnims.push( clip );
					byName.set( clip.name, clip );
					added ++;

				} else {

					// Prefer disk if memory empty-ish
					const existing = byName.get( clip.name );
					if ( ! clipHasAnyKeys( existing ) ) {

						Object.assign( existing, clip );
						added ++;

					}

				}

			} catch ( e ) {

				console.warn( '[FreeFilmCut] load .anim failed', name, e );

			}

		}
		if ( ! editor.activeFreecapcutAnim || ! clipHasAnyKeys( editor.activeFreecapcutAnim ) ) {

			editor.activeFreecapcutAnim = editor.freecapcutAnims[ 0 ] || createEmptyAnim( 'Animation', 30 );

		}

	} catch ( e ) {

		console.warn( '[FreeFilmCut] loadFreecapcutAnimsFromProjectFolder', e );

	}
	return added;

}


/** True if object.userData.freecapcutAnimController is present and enabled. */
export function objectHasAnimController( object ) {

	const c = object && object.userData && object.userData.freecapcutAnimController;
	return !!( c && c.enabled !== false );

}

/** UUIDs that appear as clip targets (any loaded / active freecapcut clip). */
export function collectAnimTargetUuids( editor ) {

	const set = new Set();
	const pushClip = ( clip ) => {

		if ( ! clip || ! Array.isArray( clip.targets ) ) return;
		for ( const t of clip.targets ) {

			if ( t && t.objectUuid ) set.add( t.objectUuid );

		}

	};
	if ( editor && editor.activeFreecapcutAnim ) pushClip( editor.activeFreecapcutAnim );
	if ( editor && Array.isArray( editor.freecapcutAnims ) ) {

		for ( const a of editor.freecapcutAnims ) pushClip( a );

	}
	return set;

}

/** Marker: has controller flag OR is a target in any clip. */
export function objectShowsAnimMarker( editor, object ) {

	if ( ! object ) return false;
	if ( objectHasAnimController( object ) ) return true;
	return collectAnimTargetUuids( editor ).has( object.uuid );

}

/** Count keyframes for this uuid across editor clips. */
export function countObjectAnimKeys( editor, objectUuid ) {

	let n = 0;
	const visit = ( clip ) => {

		if ( ! clip || ! Array.isArray( clip.targets ) ) return;
		for ( const t of clip.targets ) {

			if ( ! t || t.objectUuid !== objectUuid ) continue;
			for ( const tr of ( t.tracks || [] ) ) {

				n += ( tr && tr.keys && tr.keys.length ) || 0;

			}

		}

	};
	if ( editor && editor.activeFreecapcutAnim ) visit( editor.activeFreecapcutAnim );
	if ( editor && Array.isArray( editor.freecapcutAnims ) ) {

		for ( const a of editor.freecapcutAnims ) visit( a );

	}
	return n;

}

/** List unique in-memory clip objects (active + freecapcutAnims). */
export function listEditorAnimClips( editor ) {

	const out = [];
	const push = ( c ) => {

		if ( c && ! out.includes( c ) ) out.push( c );

	};
	if ( editor ) {

		push( editor.activeFreecapcutAnim );
		if ( Array.isArray( editor.freecapcutAnims ) ) {

			for ( const a of editor.freecapcutAnims ) push( a );

		}

	}
	return out;

}

export function findClipByName( editor, name ) {

	const want = String( name || '' );
	if ( ! want ) return null;
	for ( const c of listEditorAnimClips( editor ) ) {

		if ( c && String( c.name || '' ) === want ) return c;

	}
	return null;

}

/** Sanitize + uniquify clip name among editor clips. */
export function uniqueAnimName( editor, baseName ) {

	const safe = String( baseName || 'Animation' ).replace( /[<>:"/\\|?*\s]+/g, '_' ).slice( 0, 40 ) || 'Animation';
	const taken = new Set( listEditorAnimClips( editor ).map( ( c ) => String( c && c.name || '' ) ) );
	if ( ! taken.has( safe ) ) return safe;
	for ( let i = 2; i < 9999; i ++ ) {

		const n = safe + '_' + i;
		if ( ! taken.has( n ) ) return n;

	}
	return safe + '_' + Date.now().toString( 36 );

}

function registerClipInEditor( editor, clip ) {

	if ( ! editor || ! clip ) return;
	if ( ! editor.freecapcutAnims ) editor.freecapcutAnims = [];
	const idx = editor.freecapcutAnims.findIndex( ( a ) => a === clip || ( a && a.name === clip.name ) );
	if ( idx >= 0 ) editor.freecapcutAnims[ idx ] = clip;
	else editor.freecapcutAnims.push( clip );
	clip._export = true;

}

/** Clip that already targets this uuid (prefer exclusive single-target clips). */
export function findClipContainingObject( editor, objectUuid ) {

	const uuid = String( objectUuid || '' );
	if ( ! uuid ) return null;
	let shared = null;
	for ( const clip of listEditorAnimClips( editor ) ) {

		if ( ! clip || ! Array.isArray( clip.targets ) ) continue;
		const hit = clip.targets.some( ( t ) => t && t.objectUuid === uuid );
		if ( ! hit ) continue;
		const only = clip.targets.filter( ( t ) => t && t.objectUuid ).length <= 1;
		if ( only ) return clip;
		if ( ! shared ) shared = clip;

	}
	return shared;

}

/**
 * Pull this object's target block out of any shared clips into a dedicated clip.
 * @returns {object|null} extracted target { objectUuid, tracks } or null
 */
export function extractObjectTargetFromClips( editor, objectUuid ) {

	const uuid = String( objectUuid || '' );
	let extracted = null;
	for ( const clip of listEditorAnimClips( editor ) ) {

		if ( ! clip || ! Array.isArray( clip.targets ) ) continue;
		const kept = [];
		for ( const t of clip.targets ) {

			if ( t && t.objectUuid === uuid ) {

				if ( ! extracted ) {

					extracted = {
						objectUuid: uuid,
						tracks: Array.isArray( t.tracks ) ? t.tracks.map( ( tr ) => ( {
							path: tr.path,
							interp: tr.interp === 'step' ? 'step' : 'linear',
							keys: Array.isArray( tr.keys ) ? tr.keys.map( normalizeKey ) : [],
						} ) ) : [],
					};

				}

			} else if ( t ) {

				kept.push( t );

			}

		}
		if ( kept.length !== clip.targets.length ) {

			clip.targets = kept;
			recomputeDuration( clip );

		}

	}
	return extracted;

}

/**
 * Ensure the object has its own independent animation clip and make it active.
 * - Uses controller.clipId when valid
 * - Or an exclusive clip that only targets this object
 * - Otherwise creates a uniquely named clip (extracting prior keys if shared)
 * @param {{ forceNew?: boolean }} opts forceNew: discard prior keys and start empty
 */
export function ensureObjectAnimClip( editor, object, opts = {} ) {

	if ( ! editor || ! object || object.isScene ) return null;
	if ( ! object.userData ) object.userData = {};
	isolateUserDataFromAncestors( object );
	if ( ! editor.freecapcutAnims ) editor.freecapcutAnims = [];

	const forceNew = !! opts.forceNew;
	const fps = ( editor.activeFreecapcutAnim && editor.activeFreecapcutAnim.fps ) || 30;
	const ctrl = object.userData.freecapcutAnimController;
	const wantId = ctrl && ctrl.clipId ? String( ctrl.clipId ) : '';

	let clip = null;
	if ( ! forceNew && wantId ) clip = findClipByName( editor, wantId );
	if ( ! forceNew && ! clip ) clip = findClipContainingObject( editor, object.uuid );

	// If the clip also targets other objects, split this object into its own clip
	if ( ! forceNew && clip ) {

		const others = ( clip.targets || [] ).filter( ( t ) => t && t.objectUuid && t.objectUuid !== object.uuid );
		if ( others.length > 0 ) {

			const extracted = extractObjectTargetFromClips( editor, object.uuid );
			clip = createEmptyAnim( uniqueAnimName( editor, object.name || 'Object' ), fps );
			if ( extracted ) clip.targets = [ extracted ];
			else ensureTarget( clip, object.uuid );
			recomputeDuration( clip );

		}

	}

	if ( forceNew ) {

		removeObjectFromAnimClips( editor, object.uuid );
		clip = createEmptyAnim( uniqueAnimName( editor, object.name || 'Object' ), fps );
		ensureTarget( clip, object.uuid );

	}

	if ( ! clip ) {

		clip = createEmptyAnim( uniqueAnimName( editor, object.name || 'Object' ), fps );
		ensureTarget( clip, object.uuid );

	}

	ensureTarget( clip, object.uuid );
	registerClipInEditor( editor, clip );
	editor.activeFreecapcutAnim = clip;
	object.userData.freecapcutAnimController = {
		enabled: true,
		clipId: String( clip.name || '' ),
	};
	if ( isUIAnimTarget( object ) ) clearEmptyCanvasAncestorControllers( editor, object );
	return clip;

}

/** Switch active clip to the one bound to this object (no create). @returns clip|null */
export function switchActiveAnimToObject( editor, object ) {

	if ( ! editor || ! object || object.isScene ) return null;
	const ctrl = object.userData && object.userData.freecapcutAnimController;
	let clip = null;
	if ( ctrl && ctrl.clipId ) clip = findClipByName( editor, ctrl.clipId );
	if ( ! clip ) clip = findClipContainingObject( editor, object.uuid );
	if ( ! clip ) return null;
	editor.activeFreecapcutAnim = clip;
	return clip;

}

/**
 * Sample every in-memory clip onto the scene graph (per-object independence).
 * Shared scrub time; each clip uses its own duration/loop.
 */
export function applyAllEditorAnims( editor, root, t, opts = {} ) {

	if ( ! root ) return;
	const clips = listEditorAnimClips( editor );
	if ( clips.length === 0 ) return;

	// Drop stale textAnim overrides on objects that no longer have any textAnim keys.
	const driven = new Set();
	const targeted = new Set();
	for ( const clip of clips ) {

		if ( ! clip || ! Array.isArray( clip.targets ) ) continue;
		for ( const tg of clip.targets ) {

			if ( ! tg || ! tg.objectUuid ) continue;
			const obj = root.getObjectByProperty( 'uuid', tg.objectUuid );
			if ( ! obj ) continue;
			targeted.add( obj );
			const hasText = ( tg.tracks || [] ).some( ( tr ) => tr && isTextAnimPath( tr.path ) && tr.keys && tr.keys.length );
			if ( hasText ) driven.add( obj );

		}

	}
	for ( const obj of targeted ) {

		if ( ! driven.has( obj ) ) clearTextAnimOverrides( obj );

	}

	for ( const clip of clips ) {

		if ( ! clip || ! Array.isArray( clip.targets ) || clip.targets.length === 0 ) continue;
		const hasKeys = clip.targets.some( ( tg ) =>
			tg && Array.isArray( tg.tracks ) && tg.tracks.some( ( tr ) => tr && tr.keys && tr.keys.length )
		);
		if ( ! hasKeys ) continue;
		const local = mapAnimTime( t, clip.duration, clip.loop );
		applyAnimToRoot( root, clip, local, opts );

	}

}

/**
 * Attach animation controller userData and ensure a dedicated per-object clip.
 * Persists via object.userData in scene JSON.
 */
export function attachAnimController( editor, object ) {

	if ( ! editor || ! object || object.isScene ) return null;
	ensureObjectAnimClip( editor, object );
	return object.userData.freecapcutAnimController;

}

/**
 * Remove controller userData; optionally strip this object's targets from clips.
 * @returns {{ removedKeys: number }}
 */
export function detachAnimController( editor, object, opts = {} ) {

	const result = { removedKeys: 0 };
	if ( ! editor || ! object ) return result;
	const uuid = object.uuid;
	if ( object.userData && object.userData.freecapcutAnimController ) {

		delete object.userData.freecapcutAnimController;

	}
	if ( opts.removeTracks !== false ) {

		result.removedKeys = removeObjectFromAnimClips( editor, uuid );

	}
	return result;

}

/** Remove all targets for objectUuid from active + freecapcutAnims clips. */
export function removeObjectFromAnimClips( editor, objectUuid ) {

	let removedKeys = 0;
	const clips = [];
	const push = ( c ) => {

		if ( c && ! clips.includes( c ) ) clips.push( c );

	};
	if ( editor ) {

		push( editor.activeFreecapcutAnim );
		if ( Array.isArray( editor.freecapcutAnims ) ) {

			for ( const a of editor.freecapcutAnims ) push( a );

		}

	}
	for ( const clip of clips ) {

		if ( ! clip || ! Array.isArray( clip.targets ) ) continue;
		const kept = [];
		for ( const t of clip.targets ) {

			if ( t && t.objectUuid === objectUuid ) {

				for ( const tr of ( t.tracks || [] ) ) {

					removedKeys += ( tr && tr.keys && tr.keys.length ) || 0;

				}

			} else if ( t ) {

				kept.push( t );

			}

		}
		clip.targets = kept;
		recomputeDuration( clip );

	}
	return removedKeys;

}
