/**
 * FreeFilmCut — Config-driven custom post-effect runtime (P1).
 *
 * A custom effect = one CustomEffectDefinition JSON:
 *   { id, name, version, params[], textures[], passes[] }
 *
 * The runtime validates the definition, builds a registry descriptor
 * ('custom:<id>') and instantiates ConfigurablePass per pass entry.
 * No hand-written Pass class is needed per effect.
 *
 * Conventions (shared with clip-side vfxpack):
 *   - Reserved inputs: uInput (chain input), uTransitionFrom / uTransitionTo
 *     (transition cut frames; 1x1 placeholders in editor camera preview).
 *   - Input sources: "uInput" | "uTransitionFrom" | "uTransitionTo" |
 *     "$prev" | "$prevN" | "$rt:<name>" | "$tex:<name>".
 *   - Shaders declaring a reserved sampler without an explicit inputs entry
 *     get it auto-bound (scene-builder parity).
 *   - Pass colorSpace: 'linear' (default, no conversion — engine-standard
 *     linear chain) | 'gamma' (porting-compat: inputs encoded to sRGB on
 *     read, output decoded back to linear, i.e. a local gamma space).
 *
 * P1 scope: runtime + validation + demos. Definition editor UI = P2,
 * vfxpack export / clip-side mirror = P3.
 */

import * as THREE from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { registerEffect, unregisterEffect, getEffectDescriptor } from './PostProcessRegistry.js?v=fcc-ui-124';
import { AddObjectCommand } from '../commands/AddObjectCommand.js';
import {
	VP_KEY,
	isFccVideoPlayer,
	isFccRenderTexture,
	createRenderTextureObject,
	createMediaPlayerObject,
	ensureRenderTarget,
	restoreFccVideosFromProject,
} from '../media/FccVideo.js?v=fcc-ui-207';
import { BOKEH_GLOW_CUSTOM } from './presets/BokehGlowCustomDefinition.js';

const CUSTOM_PREFIX = 'custom:';

// ---------------------------------------------------------------------------
// Defaults / fallbacks
// ---------------------------------------------------------------------------

const DEFAULT_VERTEX_SHADER = /* glsl */`
	varying vec2 vUv;
	void main() {
		vUv = uv;
		gl_Position = vec4( position.xy, 0.0, 1.0 );
	}
`;

/** Exported for the definition editor (textarea shows the real default source). */
const DEFAULT_VERTEX_SHADER_SRC = DEFAULT_VERTEX_SHADER;

const COPY_FRAGMENT_SHADER = /* glsl */`
	uniform sampler2D uInput;
	varying vec2 vUv;
	void main() {
		gl_FragColor = texture2D( uInput, vUv );
	}
`;

const COPY_FRAGMENT_SHADER_SRC = COPY_FRAGMENT_SHADER;

const VALID_PARAM_TYPES = [ 'float', 'int', 'boolean', 'color', 'vec2', 'vec3', 'vec4' ];
const VALID_DOWNSAMPLES = [ 1, 2, 4, 8 ];
const VALID_COLOR_SPACES = [ 'linear', 'gamma' ];

/**
 * Pass RT size from either classic integer downsample (1|2|4|8) or a fractional
 * resolutionScale (e.g. 0.55 for CapCut bokeh stages). Prefer resolutionScale
 * when both are present.
 */
function resolvePassRtSize( passDef, width, height ) {

	const scale = passDef && passDef.resolutionScale;
	if ( typeof scale === 'number' && isFinite( scale ) && scale > 0 && scale <= 1 ) {

		return {
			rtW: Math.max( 1, Math.floor( width * scale ) ),
			rtH: Math.max( 1, Math.floor( height * scale ) ),
			resolutionScale: scale,
			downsample: 1,
		};

	}

	const ds = ( passDef && passDef.downsample ) || 1;
	return {
		rtW: Math.max( 1, Math.floor( width / ds ) ),
		rtH: Math.max( 1, Math.floor( height / ds ) ),
		resolutionScale: 1 / ds,
		downsample: ds,
	};

}

// Reserved input uniforms (clip-side vfxpack conventions) + editor extras.
// '$camera' = the camera's raw beauty render, captured right after RenderPass
// (differs from uInput when the effect follows other effects in the stack).
const RESERVED_INPUT_SOURCES = [ 'uInput', 'uTransitionFrom', 'uTransitionTo', '$camera' ];

const RESERVED_SAMPLER_ALIASES = {
	uInput: 'uInput',
	belowInput: 'uInput',
	iChannel0: 'uInput',
	uTransitionFrom: 'uTransitionFrom',
	uFrom: 'uTransitionFrom',
	transitionFrom: 'uTransitionFrom',
	uTransitionTo: 'uTransitionTo',
	uTo: 'uTransitionTo',
	transitionTo: 'uTransitionTo',
};

const TRANSITION_SIZE_NAMES = [ 'uTransitionFromSize', 'uFromSize', 'uTransitionToSize', 'uToSize' ];

// Framework-managed uniforms that param keys must not shadow.
// uChainResolution / uChainTexel = effect chain size (pre-downsample);
// uResolution / uTexel = this pass's RT size.
const RESERVED_AUTO_UNIFORMS = [ 'uTexel', 'uResolution', 'uChainResolution', 'uChainTexel', 'uTime', 'uFrame' ];
const RESERVED_PARAM_KEYS = [
	...RESERVED_AUTO_UNIFORMS,
	...Object.keys( RESERVED_SAMPLER_ALIASES ),
	...TRANSITION_SIZE_NAMES,
];

let _fallbackTexture = null;

/** 1x1 transparent black placeholder for missing / not-ready inputs. */
function getFallbackTexture() {

	if ( _fallbackTexture ) return _fallbackTexture;
	const data = new Uint8Array( [ 0, 0, 0, 0 ] );
	_fallbackTexture = new THREE.DataTexture( data, 1, 1, THREE.RGBAFormat );
	_fallbackTexture.colorSpace = THREE.NoColorSpace;
	_fallbackTexture.magFilter = THREE.NearestFilter;
	_fallbackTexture.minFilter = THREE.NearestFilter;
	_fallbackTexture.needsUpdate = true;
	return _fallbackTexture;

}

// ---------------------------------------------------------------------------
// Definition validation
// ---------------------------------------------------------------------------

function isPlainObject( v ) {

	return !! v && typeof v === 'object' && ! Array.isArray( v );

}

function isValidId( id ) {

	return typeof id === 'string' && /^[a-zA-Z0-9_-]{1,64}$/.test( id );

}

/**
 * Validate a CustomEffectDefinition.
 * @param {object} def
 * @returns {{ ok: boolean, errors: string[] }}
 */
export function validateCustomEffectDefinition( def ) {

	const errors = [];
	const warnings = [];

	if ( ! isPlainObject( def ) ) {

		return { ok: false, errors: [ 'definition must be an object' ] };

	}

	if ( ! isValidId( def.id ) ) errors.push( 'id must match [a-zA-Z0-9_-]{1,64}' );
	if ( typeof def.name !== 'string' || def.name.length === 0 ) errors.push( 'name must be a non-empty string' );

	// ---- params ----
	const params = def.params || [];
	if ( ! Array.isArray( params ) ) errors.push( 'params must be an array' );
	const paramKeys = new Set();
	for ( const p of params ) {

		if ( ! isPlainObject( p ) ) {

			errors.push( 'params[] entries must be objects' );
			break;

		}

		if ( typeof p.key !== 'string' || ! /^[a-zA-Z_][a-zA-Z0-9_]*$/.test( p.key ) ) {

			errors.push( `param key invalid: ${ JSON.stringify( p.key ) }` );
			continue;

		}

		if ( paramKeys.has( p.key ) ) errors.push( `duplicate param key: ${ p.key }` );
		paramKeys.add( p.key );

		if ( VALID_PARAM_TYPES.indexOf( p.type ) === - 1 ) errors.push( `param "${ p.key }" type must be one of ${ VALID_PARAM_TYPES.join( '|' ) }` );
		if ( p.default === undefined ) errors.push( `param "${ p.key }" missing default` );
		if ( RESERVED_PARAM_KEYS.indexOf( p.key ) !== - 1 ) errors.push( `param "${ p.key }" uses a reserved framework uniform name` );

	}

	// ---- textures ----
	const textures = def.textures || [];
	if ( ! Array.isArray( textures ) ) errors.push( 'textures must be an array' );
	const texNames = new Set();
	for ( const t of textures ) {

		if ( ! isPlainObject( t ) ) {

			errors.push( 'textures[] entries must be objects' );
			break;

		}

		if ( typeof t.name !== 'string' || ! /^[a-zA-Z_][a-zA-Z0-9_]*$/.test( t.name ) ) {

			errors.push( `texture name invalid: ${ JSON.stringify( t.name ) }` );
			continue;

		}

		if ( texNames.has( t.name ) ) errors.push( `duplicate texture name: ${ t.name }` );
		texNames.add( t.name );

		if ( t.source === 'rt' ) {

			// MediaPlay RT slot — scene-instance binding lives in
			// entry.textureBindings (NOT in the definition; uuid is per-scene).
			if ( t.autoCreate ) {

				const m = t.media;
				if ( ! isPlainObject( m ) || ! ( m.projectPath || m.sequenceDir ) ) {

					errors.push( `texture "${ t.name }" (autoCreate) needs a media description (projectPath or sequenceDir)` );

				}

			}

			continue;

		}

		if ( t.source !== 'image' ) errors.push( `texture "${ t.name }" source must be "image" or "rt"` );
		const hasData = typeof t.dataUrl === 'string' && t.dataUrl.startsWith( 'data:' );
		if ( ! hasData && ( typeof t.path !== 'string' || t.path.length === 0 ) ) {

			// Warning (not error): empty slot samples black — must not block live
			// preview of shaders/params while the author is still picking a file.
			warnings.push( `texture "${ t.name }" has no image yet (samples black until set)` );

		}

	}

	// ---- passes ----
	const passes = def.passes || [];
	if ( ! Array.isArray( passes ) || passes.length === 0 ) errors.push( 'passes must be a non-empty array' );

	const rtNames = new Set();
	const passNames = new Set();
	passes.forEach( ( pass, index ) => {

		const label = `passes[${ index }]`;
		if ( ! isPlainObject( pass ) ) {

			errors.push( `${ label } must be an object` );
			return;

		}

		if ( typeof pass.name !== 'string' || ! /^[a-zA-Z_][a-zA-Z0-9_]*$/.test( pass.name ) ) {

			errors.push( `${ label }.name invalid` );
			return;

		}

		if ( passNames.has( pass.name ) ) errors.push( `duplicate pass name: ${ pass.name }` );
		passNames.add( pass.name );

		if ( typeof pass.fragmentShader !== 'string' || pass.fragmentShader.trim().length === 0 ) {

			errors.push( `${ label } ("${ pass.name }") missing fragmentShader` );

		}

		if ( pass.vertexShader !== undefined && pass.vertexShader !== 'default' &&
			( typeof pass.vertexShader !== 'string' || pass.vertexShader.trim().length === 0 ) ) {

			errors.push( `${ label } ("${ pass.name }") vertexShader must be "default" or GLSL source` );

		}

		if ( pass.downsample !== undefined && VALID_DOWNSAMPLES.indexOf( pass.downsample ) === - 1 ) {

			errors.push( `${ label } ("${ pass.name }") downsample must be one of ${ VALID_DOWNSAMPLES.join( '|' ) }` );

		}

		if ( pass.resolutionScale !== undefined ) {

			const s = pass.resolutionScale;
			if ( typeof s !== 'number' || ! isFinite( s ) || s <= 0 || s > 1 ) {

				errors.push( `${ label } ("${ pass.name }") resolutionScale must be a number in (0, 1]` );

			}

		}

		if ( pass.colorSpace !== undefined && VALID_COLOR_SPACES.indexOf( pass.colorSpace ) === - 1 ) {

			errors.push( `${ label } ("${ pass.name }") colorSpace must be linear|gamma` );

		}

		if ( pass.output !== undefined ) {

			if ( ! isPlainObject( pass.output ) || typeof pass.output.rt !== 'string' || ! /^[a-zA-Z_][a-zA-Z0-9_]*$/.test( pass.output.rt ) ) {

				errors.push( `${ label } ("${ pass.name }") output.rt invalid` );

			} else {

				if ( rtNames.has( pass.output.rt ) ) errors.push( `duplicate output rt name: ${ pass.output.rt }` );
				rtNames.add( pass.output.rt );
				if ( index === passes.length - 1 ) {

					errors.push( `${ label } ("${ pass.name }") is the last pass — it must not declare output.rt (it IS the effect output)` );

				}

			}

		}

		// ---- inputs ----
		if ( pass.inputs !== undefined && ! isPlainObject( pass.inputs ) ) {

			errors.push( `${ label } ("${ pass.name }") inputs must be an object` );

		} else if ( isPlainObject( pass.inputs ) ) {

			for ( const uniformName of Object.keys( pass.inputs ) ) {

				if ( ! /^[a-zA-Z_][a-zA-Z0-9_]*$/.test( uniformName ) ) {

					errors.push( `${ label } ("${ pass.name }") input uniform name invalid: ${ uniformName }` );
					continue;

				}

				if ( paramKeys.has( uniformName ) ) {

					errors.push( `${ label } ("${ pass.name }") input "${ uniformName }" collides with a param key` );

				}

				const src = pass.inputs[ uniformName ];
				if ( typeof src !== 'string' ) {

					errors.push( `${ label } ("${ pass.name }") input "${ uniformName }" source must be a string` );

				} else if ( RESERVED_INPUT_SOURCES.indexOf( src ) !== - 1 ) {

					// ok — reserved pipeline source

				} else if ( src === '$prev' || /^\$prev\d+$/.test( src ) ) {

					const n = src === '$prev' ? 1 : parseInt( src.slice( 5 ), 10 );
					if ( ! ( n >= 1 && index - n >= 0 ) ) errors.push( `${ label } ("${ pass.name }") ${ src } has no earlier pass to reference` );

				} else if ( src.startsWith( '$rt:' ) ) {

					const rt = src.slice( 4 );
					if ( ! rtNames.has( rt ) ) errors.push( `${ label } ("${ pass.name }") ${ src } references a later/unknown rt (only earlier pass outputs allowed)` );

				} else if ( src.startsWith( '$tex:' ) ) {

					if ( ! texNames.has( src.slice( 5 ) ) ) errors.push( `${ label } ("${ pass.name }") ${ src } references an unknown texture` );

				} else {

					errors.push( `${ label } ("${ pass.name }") input "${ uniformName }" unknown source: ${ src }` );

				}

			}

		}

		// Warnings — declared samplers with no input mapping at all are the
		// classic "texture has no effect" bug (unbound sampler = unit 0 garbage).
		const declaredScan = scanDeclaredReserved( pass );
		for ( const samplerName of declaredScan.allSamplers ) {

			const mapped = pass.inputs && Object.prototype.hasOwnProperty.call( pass.inputs, samplerName );
			if ( mapped ) continue;
			if ( RESERVED_SAMPLER_ALIASES[ samplerName ] ) continue;
			if ( texNames.has( samplerName ) ) continue; // auto-bound by texture name
			warnings.push( `${ label } ("${ pass.name }") 声明了 sampler "${ samplerName }" 但没有输入映射 — 请在 inputs 加 "${ samplerName } → $tex:<贴图名> / uInput / $rt:<RT名>"，或让采样器与贴图同名以自动绑定` );

		}

	} );

	return { ok: errors.length === 0, errors, warnings };

}

// ---------------------------------------------------------------------------
// GLSL composition
// ---------------------------------------------------------------------------

function gammaPrelude() {

	// Local gamma space: every texture2D read is encoded to sRGB, and the
	// framework main() decodes the final write back to linear. Shader math
	// (pow / LUT / per-channel weights) then runs on sRGB-encoded values —
	// required by shaders ported from gamma-space pipelines (e.g. CapCut GLES2).
	//
	// WebGL2 / Three already `#define texture2D texture` in the program
	// preamble — `#undef` before rebinding, and call `texture` inside the
	// helper so the body is not rewritten into a recursive macro.
	return /* glsl */`
		vec3 fccLinearToSRGB( vec3 c ) {
			return mix( c * 12.92, pow( max( c, vec3( 0.0 ) ), vec3( 0.4166666666666667 ) ) * 1.055 - 0.055, step( vec3( 0.0031308 ), c ) );
		}
		vec3 fccSRGBToLinear( vec3 c ) {
			return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( vec3( 0.04045 ), c ) );
		}
		vec4 fccGammaTex( sampler2D s, vec2 uv ) {
			vec4 c = texture( s, uv );
			return vec4( fccLinearToSRGB( c.rgb ), c.a );
		}
		#undef texture2D
		#define texture2D fccGammaTex
		#define main fccUserMain
	`;

}

function gammaPostlude() {

	return /* glsl */`
		void main() {
			fccUserMain();
			gl_FragColor = vec4( fccSRGBToLinear( max( gl_FragColor.rgb, vec3( 0.0 ) ) ), gl_FragColor.a );
		}
	`;

}

function composeFragmentShader( passDef ) {

	const gamma = passDef.colorSpace === 'gamma';
	if ( gamma ) return gammaPrelude() + '\n' + passDef.fragmentShader + '\n' + gammaPostlude();
	return passDef.fragmentShader;

}

function composeVertexShader( passDef ) {

	if ( ! passDef.vertexShader || passDef.vertexShader === 'default' ) return DEFAULT_VERTEX_SHADER;
	return passDef.vertexShader;

}

/** Scan shader source for declared reserved samplers / size uniforms. */
function scanDeclaredReserved( passDef ) {

	const src = ( passDef.fragmentShader || '' ) + '\n' + ( passDef.vertexShader || '' );
	const samplers = []; // { declared, canonical } — uniform key must be the DECLARED name
	const allSamplers = new Set(); // every declared sampler2D name
	const sizes = new Set();

	const samplerRe = /\buniform\s+sampler2D\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g;
	let m;
	while ( ( m = samplerRe.exec( src ) ) !== null ) {

		allSamplers.add( m[ 1 ] );
		const canonical = RESERVED_SAMPLER_ALIASES[ m[ 1 ] ];
		if ( canonical && ! samplers.some( ( s ) => s.declared === m[ 1 ] ) ) {

			samplers.push( { declared: m[ 1 ], canonical } );

		}

	}

	const sizeRe = /\buniform\s+vec2\s+([a-zA-Z_][a-zA-Z0-9_]*)\s*;/g;
	while ( ( m = sizeRe.exec( src ) ) !== null ) {

		if ( TRANSITION_SIZE_NAMES.indexOf( m[ 1 ] ) !== - 1 ) sizes.add( m[ 1 ] );

	}

	return { samplers, allSamplers, sizes };

}

// ---------------------------------------------------------------------------
// Uniform value helpers
// ---------------------------------------------------------------------------

/** NLE ColorPicker may emit #RRGGBBAA; THREE.Color only takes #RGB/#RRGGBB. */
function normalizeHexRgb( input ) {

	const s = String( input || '' ).trim();
	const m = s.match( /^#?([0-9a-fA-F]{3}|[0-9a-fA-F]{6}|[0-9a-fA-F]{8})$/ );
	if ( ! m ) return '#ffffff';
	let h = m[ 1 ];
	if ( h.length === 3 ) h = h[ 0 ] + h[ 0 ] + h[ 1 ] + h[ 1 ] + h[ 2 ] + h[ 2 ];
	else if ( h.length === 8 ) h = h.slice( 0, 6 );
	return '#' + h.toLowerCase();

}

function makeParamUniform( p ) {

	const d = p.default;
	switch ( p.type ) {

		case 'float': return { value: Number( d ) || 0 };
		case 'int': return { value: Math.round( Number( d ) || 0 ) };
		case 'boolean': return { value: !! d };
		case 'color': return { value: new THREE.Color( normalizeHexRgb( typeof d === 'string' ? d : '#ffffff' ) ) };
		case 'vec2': return { value: new THREE.Vector2( d[ 0 ] || 0, d[ 1 ] || 0 ) };
		case 'vec3': return { value: new THREE.Vector3( d[ 0 ] || 0, d[ 1 ] || 0, d[ 2 ] || 0 ) };
		case 'vec4': return { value: new THREE.Vector4( d[ 0 ] || 0, d[ 1 ] || 0, d[ 2 ] || 0, d[ 3 ] === undefined ? 1 : d[ 3 ] ) };
		default: return { value: 0 };

	}

}

function setParamUniform( uniform, type, v ) {

	if ( uniform === undefined ) return;
	switch ( type ) {

		case 'float':
			uniform.value = Number( v ) || 0;
			break;
		case 'int':
			uniform.value = Math.round( Number( v ) || 0 );
			break;
		case 'boolean':
			uniform.value = !! v;
			break;
			case 'color':
				try {

					if ( typeof v === 'string' ) uniform.value.set( normalizeHexRgb( v ) );
					else if ( Array.isArray( v ) && v.length >= 3 ) uniform.value.setRGB( Number( v[ 0 ] ) || 0, Number( v[ 1 ] ) || 0, Number( v[ 2 ] ) || 0 );
					else if ( v && typeof v === 'object' && v.r !== undefined ) uniform.value.setRGB( Number( v.r ) || 0, Number( v.g ) || 0, Number( v.b ) || 0 );

				} catch ( e ) { /* keep previous */ }

				break;
		case 'vec2':
		case 'vec3':
		case 'vec4': {

			const t = uniform.value;
			if ( Array.isArray( v ) ) {

				// Pad to 4 — Vector2/3/4.fromArray read what they need and a
				// short array would inject NaN into the trailing components.
				const padded = [ Number( v[ 0 ] ) || 0, Number( v[ 1 ] ) || 0, Number( v[ 2 ] ) || 0, v[ 3 ] === undefined ? 1 : ( Number( v[ 3 ] ) || 0 ) ];
				if ( 'fromArray' in t ) t.fromArray( padded );

			} else if ( v && typeof v === 'object' && 'x' in v ) {

				t.x = Number( v.x ) || 0;
				t.y = Number( v.y ) || 0;
				if ( 'z' in t ) t.z = Number( v.z ) || 0;
				if ( 'w' in t ) t.w = Number( v.w !== undefined ? v.w : 1 );

			}

			break;

		}

	}

}

// ---------------------------------------------------------------------------
// ConfigurablePass
// ---------------------------------------------------------------------------

/**
 * One pass of a custom effect. Intermediate passes render into their own
 * downsampled RT (needsSwap = false); the last pass writes the chain buffer.
 */
class ConfigurablePass extends Pass {

	/**
	 * @param {object} options
	 * @param {object} options.passDef        — one entry of def.passes
	 * @param {Array}  options.paramDefs      — def.params
	 * @param {Set}    options.textureNames   — effect texture names (auto-bind by name)
	 * @param {Function} options.resolveInput — ( source, readBuffer ) => THREE.Texture|null
	 * @param {number} options.width  — chain width
	 * @param {number} options.height — chain height
	 * @param {boolean} options.isFinal — true when this pass writes the chain
	 */
	constructor( { passDef, paramDefs, textureNames, resolveInput, width, height, isFinal } ) {

		super();
		this.passDef = passDef;
		this._paramDefs = paramDefs;
		this.isFinalPass = isFinal;
		this.needsSwap = isFinal;
		this._resolveInput = resolveInput;

		const rtSize = resolvePassRtSize( passDef, width, height );
		this._downsample = rtSize.downsample;
		this._resolutionScale = rtSize.resolutionScale;
		this._chainW = Math.max( 1, Math.floor( width ) );
		this._chainH = Math.max( 1, Math.floor( height ) );
		const rtW = rtSize.rtW;
		const rtH = rtSize.rtH;

		// ---- uniforms ----
		const uniforms = {};

		// Params
		for ( const p of paramDefs ) {

			uniforms[ p.key ] = makeParamUniform( p );

		}

		// Inputs (explicit + reserved auto-bind + texture-name auto-bind)
		const { samplers: declaredSamplers, allSamplers, sizes: declaredSizes } = scanDeclaredReserved( passDef );
		const inputs = passDef.inputs || {};
		this._inputBindings = []; // { uniform, source }

		const explicitNames = new Set( Object.keys( inputs ) );
		for ( const uniformName of Object.keys( inputs ) ) {

			// Bind the fallback, never null — a null sampler can leak unit 0
			// garbage into shaders that sample an unbound texture.
			uniforms[ uniformName ] = { value: getFallbackTexture() };
			this._inputBindings.push( { uniform: uniformName, source: inputs[ uniformName ] } );

		}

		// Reserved samplers declared in GLSL but not explicitly mapped.
		// Uniform key = DECLARED name (alias-aware), source = canonical reserved.
		for ( const { declared, canonical } of declaredSamplers ) {

			if ( explicitNames.has( declared ) ) continue;
			uniforms[ declared ] = { value: getFallbackTexture() };
			this._inputBindings.push( { uniform: declared, source: canonical } );

		}

		// Texture-name auto-bind: a sampler whose name matches an effect
		// texture is bound to it without an explicit inputs entry — the
		// intuitive authoring flow (declare `uniform sampler2D tex1;` after
		// uploading a texture named tex1 and it just works).
		if ( textureNames ) {

			for ( const samplerName of allSamplers ) {

				if ( explicitNames.has( samplerName ) ) continue;
				if ( RESERVED_SAMPLER_ALIASES[ samplerName ] ) continue;
				if ( ! textureNames.has( samplerName ) ) continue;
				uniforms[ samplerName ] = { value: getFallbackTexture() };
				this._inputBindings.push( { uniform: samplerName, source: '$tex:' + samplerName } );

			}

		}

		// Transition size uniforms (placeholders in editor — no transition context)
		for ( const sizeName of declaredSizes ) {

			if ( uniforms[ sizeName ] ) continue;
			uniforms[ sizeName ] = { value: new THREE.Vector2( 1, 1 ) };

		}

		// Auto uniforms — pass RT vs full chain (bokeh unit math needs chain size)
		uniforms.uTexel = { value: new THREE.Vector2( 1 / rtW, 1 / rtH ) };
		uniforms.uResolution = { value: new THREE.Vector2( rtW, rtH ) };
		uniforms.uChainTexel = { value: new THREE.Vector2( 1 / this._chainW, 1 / this._chainH ) };
		uniforms.uChainResolution = { value: new THREE.Vector2( this._chainW, this._chainH ) };
		uniforms.uTime = { value: 0 };
		uniforms.uFrame = { value: 0 };

		this.uniforms = uniforms;
		this._timeAcc = 0;
		this._compileChecked = false;
		this._compileFailed = false;
		this.compileError = '';

		this.material = new THREE.ShaderMaterial( {
			name: 'FccCustom:' + ( passDef.name || 'pass' ),
			uniforms,
			vertexShader: composeVertexShader( passDef ),
			fragmentShader: composeFragmentShader( passDef ),
			depthTest: false,
			depthWrite: false,
			transparent: false,
			blending: THREE.NoBlending,
			toneMapped: false,
		} );

		// Passthrough for texture-pending / compile-fail (bokeh-glow lesson).
		this._copyUniforms = { tDiffuse: { value: getFallbackTexture() } };
		this._copyMaterial = new THREE.ShaderMaterial( {
			name: 'FccCustomCopy:' + ( passDef.name || 'pass' ),
			uniforms: this._copyUniforms,
			vertexShader: DEFAULT_VERTEX_SHADER,
			fragmentShader: /* glsl */`
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					gl_FragColor = texture2D( tDiffuse, vUv );
				}
			`,
			depthTest: false,
			depthWrite: false,
			transparent: false,
			blending: THREE.NoBlending,
		} );

		this._fsQuad = new FullScreenQuad( this.material );

		// Named output RT (intermediate passes only)
		if ( passDef.output && passDef.output.rt ) {

			this.outputName = passDef.output.rt;
			this.outputRT = new THREE.WebGLRenderTarget( rtW, rtH, {
				type: THREE.HalfFloatType,
				format: THREE.RGBAFormat,
				minFilter: THREE.LinearFilter,
				magFilter: THREE.LinearFilter,
				depthBuffer: false,
				stencilBuffer: false,
			} );
			this.outputRT.texture.colorSpace = THREE.NoColorSpace;
			this.outputRT.texture.generateMipmaps = false;

		}

	}

	setParamValues( params ) {

		for ( const p of this._paramDefs || [] ) {

			if ( params[ p.key ] !== undefined ) setParamUniform( this.uniforms[ p.key ], p.type, params[ p.key ] );

		}

	}

	_applyInput( source, readBuffer ) {

		if ( source === 'uInput' ) return readBuffer ? readBuffer.texture : getFallbackTexture();
		return this._resolveInput( source );

	}

	_texturesPending() {

		const textures = this.__effectTextures;
		if ( ! textures || typeof textures.values !== 'function' ) return false;
		for ( const entry of textures.values() ) {

			if ( entry && entry.pending ) return true;

		}

		return false;

	}

	/** After first draw: read WebGLProgram.diagnostics (needs checkShaderErrors). */
	_probeCompile( renderer ) {

		if ( this._compileChecked ) return;
		this._compileChecked = true;
		try {

			const props = renderer.properties && renderer.properties.get( this.material );
			const programs = props && props.programs;
			if ( ! programs ) return;
			const list = typeof programs.values === 'function'
				? Array.from( programs.values() )
				: ( Array.isArray( programs ) ? programs : [] );
			for ( const prog of list ) {

				if ( ! prog || ! prog.diagnostics ) continue;
				if ( prog.diagnostics.runnable === false ) {

					this._compileFailed = true;
					const parts = [
						prog.diagnostics.programLog,
						prog.diagnostics.vertexShader && prog.diagnostics.vertexShader.log,
						prog.diagnostics.fragmentShader && prog.diagnostics.fragmentShader.log,
					].filter( ( s ) => typeof s === 'string' && s.trim() );
					this.compileError = parts.join( '\n' ) || 'shader link failed';
					console.error(
						`[FreeFilmCut custom-effect] shader compile failed ("${ this.passDef && this.passDef.name }") — passthrough until fixed`,
						this.compileError
					);
					break;

				}

			}

		} catch ( e ) {

			/* probe is best-effort */

		}

	}

	_blitPassthrough( renderer, writeBuffer, readBuffer ) {

		const src = readBuffer && readBuffer.texture ? readBuffer.texture : getFallbackTexture();
		this._copyUniforms.tDiffuse.value = src;
		this._fsQuad.material = this._copyMaterial;

		const target = this.outputRT
			? this.outputRT
			: ( this.renderToScreen ? null : writeBuffer );

		const prevRT = renderer.getRenderTarget();
		renderer.setRenderTarget( target );
		const prevClear = new THREE.Color();
		renderer.getClearColor( prevClear );
		const prevAlpha = renderer.getClearAlpha();
		renderer.setClearColor( 0x000000, 0 );
		renderer.clear( true, true, true );
		this._fsQuad.render( renderer );
		renderer.setClearColor( prevClear, prevAlpha );
		renderer.setRenderTarget( prevRT );
		this._fsQuad.material = this.material;

	}

	render( renderer, writeBuffer, readBuffer, deltaTime /*, maskActive */ ) {

		// Texture gate: identity until image assets resolve (fail also clears pending).
		if ( this._texturesPending() || this._compileFailed ) {

			this._blitPassthrough( renderer, writeBuffer, readBuffer );
			return;

		}

		// Bind inputs
		for ( const binding of this._inputBindings ) {

			const tex = this._applyInput( binding.source, readBuffer );
			const u = this.uniforms[ binding.uniform ];
			if ( u ) u.value = tex || getFallbackTexture();

		}

		// Auto uniforms — composer delta (not wall clock). Optional absolute override.
		if ( typeof this.__fccEffectTime === 'number' && isFinite( this.__fccEffectTime ) ) {

			this.uniforms.uTime.value = this.__fccEffectTime;

		} else {

			const dt = ( typeof deltaTime === 'number' && isFinite( deltaTime ) ) ? Math.max( 0, deltaTime ) : 0;
			this._timeAcc += dt;
			this.uniforms.uTime.value = this._timeAcc;

		}

		this.uniforms.uFrame.value = ( this.uniforms.uFrame.value + 1 ) % 65536;

		const target = this.outputRT
			? this.outputRT
			: ( this.renderToScreen ? null : writeBuffer );

		const prevRT = renderer.getRenderTarget();
		renderer.setRenderTarget( target );
		const prevClear = new THREE.Color();
		renderer.getClearColor( prevClear );
		const prevAlpha = renderer.getClearAlpha();
		renderer.setClearColor( 0x000000, 0 );
		renderer.clear( true, true, true );

		this._fsQuad.material = this.material;
		this._fsQuad.render( renderer );
		this._probeCompile( renderer );

		renderer.setClearColor( prevClear, prevAlpha );
		renderer.setRenderTarget( prevRT );

		// Bad shader: this frame may be garbage; next frames stay on passthrough.
		if ( this._compileFailed ) {

			this._blitPassthrough( renderer, writeBuffer, readBuffer );

		}

	}

	setSize( width, height ) {

		this._chainW = Math.max( 1, Math.floor( width ) );
		this._chainH = Math.max( 1, Math.floor( height ) );
		const rtSize = resolvePassRtSize( this.passDef, this._chainW, this._chainH );
		this._downsample = rtSize.downsample;
		this._resolutionScale = rtSize.resolutionScale;
		const { rtW, rtH } = rtSize;
		if ( this.outputRT ) this.outputRT.setSize( rtW, rtH );
		this.uniforms.uTexel.value.set( 1 / rtW, 1 / rtH );
		this.uniforms.uResolution.value.set( rtW, rtH );
		this.uniforms.uChainTexel.value.set( 1 / this._chainW, 1 / this._chainH );
		this.uniforms.uChainResolution.value.set( this._chainW, this._chainH );

	}

	dispose() {

		this.material.dispose();
		if ( this._copyMaterial ) this._copyMaterial.dispose();
		this._fsQuad.dispose();
		if ( this.outputRT ) this.outputRT.dispose();

	}

}

// ---------------------------------------------------------------------------
// Texture loading (per effect-build)
// ---------------------------------------------------------------------------

const _textureLoader = typeof window !== 'undefined' ? new THREE.TextureLoader() : null;

// Project-file resolver — injected by the sidebar (has editor.projectFolder).
// ( path ) => Promise<{ blobUrl }|null>; paths are project-relative.
let _assetResolver = null;

/** Fired when a custom-effect texture finishes loading (or fails). Editor
 *  render is on-demand — without this, async tex leave the pass stuck on
 *  passthrough after scene refresh. */
let _onEffectTextureUpdated = null;

/** Register the project-file → blob-URL resolver (idempotent, last wins). */
export function registerCustomEffectAssetResolver( fn ) {

	_assetResolver = fn;

}

/** Register a listener to request a viewport re-render after tex resolve. */
export function registerCustomEffectTextureUpdateListener( fn ) {

	_onEffectTextureUpdated = typeof fn === 'function' ? fn : null;

}

function notifyTextureUpdated() {

	if ( typeof _onEffectTextureUpdated === 'function' ) {

		try {

			_onEffectTextureUpdated();

		} catch ( e ) { /* ignore */ }

	}

}

async function resolveAssetPath( path ) {

	if ( ! _assetResolver ) return null;
	try {

		return await _assetResolver( path );

	} catch ( e ) {

		console.warn( `[FreeFilmCut custom-effect] asset resolve failed: ${ path }`, e );
		return null;

	}

}

/** UI helper — blob URL for a project-relative asset path (thumbnails). */
export function resolveCustomEffectAssetUrl( path ) {

	return resolveAssetPath( path );

}

function loadEffectTextures( def ) {

	const map = new Map(); // name -> { texture, resolved, pending }

	for ( const t of def.textures || [] ) {

		// MediaPlay RT slot — the uuid comes from entry.textureBindings
		// (scene-instance data, passed via ctx.__fccTextureBindings), NOT
		// from the definition. Resolved fresh every frame in resolveInput.
		if ( t.source === 'rt' ) {

			map.set( t.name, { dynamic: 'scene', texName: t.name, texture: getFallbackTexture(), resolved: true, pending: false } );
			continue;

		}

		const entry = { texture: getFallbackTexture(), resolved: false, pending: true };
		map.set( t.name, entry );

		const applyTex = ( tex ) => {

			tex.colorSpace = t.colorSpace === 'srgb' ? THREE.SRGBColorSpace : THREE.NoColorSpace;
			tex.flipY = t.flipY !== false;
			tex.generateMipmaps = false;
			tex.minFilter = THREE.LinearFilter;
			tex.magFilter = THREE.LinearFilter;
			entry.texture = tex;
			entry.resolved = true;
			entry.pending = false;
			notifyTextureUpdated();

		};

		const fail = ( why ) => {

			console.error( `[FreeFilmCut custom-effect] texture "${ t.name }" failed to load (${ why }) — black fallback bound` );
			entry.resolved = true; // failure also lifts the gate (bokeh-glow lesson)
			entry.pending = false;
			notifyTextureUpdated();

		};

		if ( t.path ) {

			// Absolute / module URLs (http(s), blob, data, file, or leading /)
			// load directly — used by builtin presets (import.meta.url).
			// Project-relative paths go through the injected projectFolder resolver.
			const isAbsolute = /^(?:https?:|blob:|data:|file:|\/)/i.test( t.path )
				|| /^[a-zA-Z]:[\\/]/.test( t.path );
			if ( isAbsolute ) {

				if ( ! _textureLoader ) {

					fail( 'no texture loader' );
					continue;

				}

				_textureLoader.load( t.path, applyTex, undefined, () => fail( 'decode error' ) );

			} else if ( ! _assetResolver ) {

				// Usually means two CustomEffectRuntime module instances (mismatched
				// ?v= cache-bust imports): sidebar registered on one, composer on another.
				fail( 'no asset resolver (bind a project folder; hard-refresh if sidebar already open)' );
				continue;

			} else if ( ! _textureLoader ) {

				fail( 'no texture loader' );
				continue;

			} else {

				resolveAssetPath( t.path ).then( ( blobUrl ) => {

					if ( ! blobUrl ) {

						fail( `path not found: ${ t.path }` );
						return;

					}

					_textureLoader.load( blobUrl, applyTex, undefined, () => fail( 'decode error' ) );

				} );

			}

		} else if ( t.dataUrl && _textureLoader ) {

			// Legacy inline dataUrl (pre-path model) — still supported.
			_textureLoader.load( t.dataUrl, applyTex, undefined, () => fail( 'decode error' ) );

		} else {

			entry.pending = false;

		}

	}

	return map;

}

// ---------------------------------------------------------------------------
// Descriptor builder
// ---------------------------------------------------------------------------

/** UI-facing param schema (vec types are k-frame-only in P1). */
function buildParamSchema( params ) {

	const schema = [];
	for ( const p of params || [] ) {

		if ( p.type === 'float' || p.type === 'int' ) {

			schema.push( {
				key: p.key,
				type: p.type,
				label: p.label || p.key,
				labelZh: p.labelZh,
				min: p.min !== undefined ? p.min : 0,
				max: p.max !== undefined ? p.max : ( p.type === 'int' ? 100 : 1 ),
				step: p.step !== undefined ? p.step : ( p.type === 'int' ? 1 : 0.01 ),
			} );

		} else if ( p.type === 'boolean' ) {

			schema.push( { key: p.key, type: 'boolean', label: p.label || p.key, labelZh: p.labelZh } );

		} else if ( p.type === 'color' ) {

			schema.push( { key: p.key, type: 'color', label: p.label || p.key, labelZh: p.labelZh } );

		} else if ( p.type === 'vec2' || p.type === 'vec3' || p.type === 'vec4' ) {

			schema.push( { key: p.key, type: p.type, label: p.label || p.key, labelZh: p.labelZh, size: Number( p.type.slice( 3 ) ) } );

		}

	}

	return schema;

}

function buildCustomEffectDescriptor( def ) {

	const paramDefs = ( def.params || [] ).map( ( p ) => ( { ...p } ) );
	const paramTypes = {};
	for ( const p of paramDefs ) paramTypes[ p.key ] = p.type;

	return {
		type: CUSTOM_PREFIX + def.id,
		label: def.name,
		labelZh: def.name,
		__customDefinition: def,

		createDefaultParams() {

			const out = {};
			for ( const p of paramDefs ) {

				if ( p.type === 'vec2' || p.type === 'vec3' || p.type === 'vec4' ) {

					const size = Number( p.type.slice( 3 ) );
					out[ p.key ] = Array.isArray( p.default )
						? p.default.slice()
						: new Array( size ).fill( 0 );

				} else if ( p.type === 'color' ) out[ p.key ] = typeof p.default === 'string' ? p.default : '#ffffff';
				else out[ p.key ] = p.default;

			}

			return out;

		},

		paramSchema: buildParamSchema( paramDefs ),

		createPasses( ctx ) {

			const textures = loadEffectTextures( def );
			const textureNames = new Set( ( def.textures || [] ).map( ( t ) => t.name ) );
			const rtMap = new Map(); // rt name -> ConfigurablePass (has .outputRT)
			const passes = [];

			const resolveInput = ( source ) => {

				if ( source === '$camera' ) {

					// Raw camera beauty — provided by PostProcessStack when any
					// enabled custom effect references '$camera'.
					return ctx.__fccBeautyTexture || getFallbackTexture();

				}

				if ( source === 'uTransitionFrom' || source === 'uTransitionTo' ) {

					// No transition context in editor camera preview — placeholder.
					return getFallbackTexture();

				}

				if ( source.startsWith( '$rt:' ) ) {

					const upstream = rtMap.get( source.slice( 4 ) );
					return upstream && upstream.outputRT ? upstream.outputRT.texture : getFallbackTexture();

				}

				if ( source.startsWith( '$tex:' ) ) {

					const t = textures.get( source.slice( 5 ) );
					if ( ! t ) return getFallbackTexture();
					if ( t.dynamic === 'scene' ) {

						// MediaPlay RT: uuid from entry.textureBindings (scene
						// instance data), RT texture looked up fresh every frame
						// so video playback follows live. Mutating the bindings
						// object in place keeps this closure current.
						const bindings = ctx.__fccTextureBindings || {};
						const b = bindings[ t.texName ];
						const obj = ( b && b.rtUuid && ctx.scene ) ? ctx.scene.getObjectByProperty( 'uuid', b.rtUuid ) : null;
						const rt = obj && obj.__fccRT;
						return rt && rt.texture ? rt.texture : getFallbackTexture();

					}

					return t.texture;

				}

				return getFallbackTexture();

			};

			def.passes.forEach( ( passDef, index ) => {

				const isFinal = index === def.passes.length - 1;
				const pass = new ConfigurablePass( {
					passDef,
					paramDefs,
					textureNames,
					resolveInput,
					width: ctx.width,
					height: ctx.height,
					isFinal,
				} );
				pass.__effectTextures = textures;
				if ( pass.outputName ) rtMap.set( pass.outputName, pass );
				passes.push( pass );

			} );

			return passes;

		},

		applyParams( passes, params ) {

			for ( const pass of passes ) {

				if ( ! ( pass instanceof ConfigurablePass ) ) continue;
				for ( const key of Object.keys( params || {} ) ) {

					const u = pass.uniforms[ key ];
					if ( ! u ) continue;
					setParamUniform( u, paramTypes[ key ], params[ key ] );

				}

			}

		},
	};

}

// ---------------------------------------------------------------------------
// Registry wiring
// ---------------------------------------------------------------------------

const _registeredFingerprints = new Map(); // custom id -> fingerprint

/**
 * Structure-only fingerprint — shaders / param keys+types / textures / passes.
 * Param *values* (default) and labels are live UI state in entry.params; including
 * them forced a full composer rebuild on every color drag (felt like needing Apply).
 */
export function definitionFingerprint( def ) {

	if ( ! def || typeof def !== 'object' ) return '0';

	const params = ( def.params || [] ).map( ( p ) => ( p ? {
		key: p.key, type: p.type, min: p.min, max: p.max, step: p.step,
	} : null ) );

	const textures = ( def.textures || [] ).map( ( t ) => ( t ? {
		name: t.name, source: t.source, path: t.path,
		dataUrl: t.dataUrl ? '[data]' : undefined,
		colorSpace: t.colorSpace, flipY: t.flipY,
		autoCreate: t.autoCreate, media: t.media,
	} : null ) );

	const passes = ( def.passes || [] ).map( ( p ) => ( p ? {
		name: p.name, inputs: p.inputs,
		fragmentShader: p.fragmentShader, vertexShader: p.vertexShader,
		downsample: p.downsample, resolutionScale: p.resolutionScale,
		colorSpace: p.colorSpace, output: p.output,
	} : null ) );

	const s = JSON.stringify( {
		id: def.id, name: def.name, version: def.version,
		params, textures, passes,
	} );

	let hash = 5381;
	for ( let i = 0; i < s.length; i ++ ) {

		hash = ( ( hash << 5 ) + hash + s.charCodeAt( i ) ) | 0;

	}

	return String( hash );

}

/**
 * Register (or refresh) one custom effect. Re-registering an id with a changed
 * definition replaces the descriptor and bumps its fingerprint.
 * @param {object} def CustomEffectDefinition
 * @returns {{ ok: boolean, errors?: string[], type?: string }}
 */
export function registerCustomEffect( def ) {

	const v = validateCustomEffectDefinition( def );
	if ( ! v.ok ) {

		console.error( '[FreeFilmCut custom-effect] invalid definition:', def && def.id, v.errors );
		return { ok: false, errors: v.errors };

	}

	const fp = definitionFingerprint( def );
	const prev = _registeredFingerprints.get( def.id );
	if ( prev !== undefined && prev !== fp ) {

		// debug (not warn): live editing re-registers every few hundred ms.
		console.debug( `[FreeFilmCut custom-effect] definition "${ def.id }" changed — re-registering` );

	}

	_registeredFingerprints.set( def.id, fp );
	registerEffect( CUSTOM_PREFIX + def.id, buildCustomEffectDescriptor( def ) );
	return { ok: true, type: CUSTOM_PREFIX + def.id };

}

export function unregisterCustomEffect( id ) {

	unregisterEffect( CUSTOM_PREFIX + id );
	_registeredFingerprints.delete( id );

}

/**
 * Scan a stack ({ enabled, effects[] }) and register any entry carrying a
 * `definition` — called before composer build so saved projects restore
 * their custom effects without extra setup.
 * @param {object} stack
 */
export function registerCustomEffectsFromStackData( stack ) {

	if ( ! stack || ! Array.isArray( stack.effects ) ) return;
	for ( const entry of stack.effects ) {

		if ( ! entry || ! entry.definition || ! isPlainObject( entry.definition ) ) continue;
		const def = entry.definition;
		const type = CUSTOM_PREFIX + def.id;
		const fp = definitionFingerprint( def );
		if ( _registeredFingerprints.get( def.id ) === fp && getEffectDescriptor( type ) ) continue;
		registerCustomEffect( def );

	}

}

/** Create a stack entry ({ id, type, enabled, params, definition }) for a def. */
export function createCustomEffectEntry( def ) {

	const desc = getEffectDescriptor( CUSTOM_PREFIX + def.id );
	if ( ! desc ) return null;
	return {
		id: ( typeof crypto !== 'undefined' && crypto.randomUUID )
			? crypto.randomUUID()
			: ( 'pp_' + Math.random().toString( 36 ).slice( 2, 10 ) ),
		type: CUSTOM_PREFIX + def.id,
		enabled: true,
		params: desc.createDefaultParams(),
		definition: def,
	};

}

/**
 * Blank one-pass definition (uInput → copy through) for the "new effect" UI.
 * @param {string} name
 * @returns {object} CustomEffectDefinition
 */
export function createBlankCustomEffectDefinition( name ) {

	const id = 'effect-' + Date.now().toString( 36 ) + Math.random().toString( 36 ).slice( 2, 6 );
	return {
		id,
		name: name || ( '自定义效果 ' + id.slice( - 4 ) ),
		version: 1,
		params: [],
		textures: [],
		passes: [
			{
				name: 'pass0',
				inputs: { uInput: 'uInput' },
				fragmentShader: COPY_FRAGMENT_SHADER,
			},
		],
	};

}

// ---------------------------------------------------------------------------
// Effects library (project folder: custom-effects/*.json)
// ---------------------------------------------------------------------------

const _scannedFolders = new WeakSet();

/**
 * Scan <projectFolder>/custom-effects/*.json and register every definition.
 * Idempotent per folder handle; call from sidebar refresh.
 * @param {object} projectFolder editor.projectFolder (duck-typed)
 */
export async function scanCustomEffectsLibrary( projectFolder ) {

	if ( ! projectFolder
		|| typeof projectFolder.listAssetFiles !== 'function'
		|| typeof projectFolder.readTextFile !== 'function'
		|| typeof projectFolder.hasFolder !== 'function'
		|| ! projectFolder.hasFolder() ) {

		return;

	}

	const handle = projectFolder.getHandle ? projectFolder.getHandle() : projectFolder;
	if ( _scannedFolders.has( handle ) ) return;
	_scannedFolders.add( handle );

	let names = [];
	try {

		names = await projectFolder.listAssetFiles( 'custom-effects' );

	} catch ( e ) {

		return;

	}

	let registeredCount = 0;
	for ( const name of names || [] ) {

		if ( ! String( name ).endsWith( '.json' ) ) continue;
		const text = await projectFolder.readTextFile( 'custom-effects/' + name );
		if ( ! text ) continue;
		try {

			const def = JSON.parse( text );
			const r = registerCustomEffect( def );
			if ( r.ok ) registeredCount ++;

		} catch ( e ) {

			console.warn( '[FreeFilmCut custom-effect] library file skipped:', name, e );

		}

	}

	if ( registeredCount > 0 && typeof console !== 'undefined' ) {

		console.info( `[FreeFilmCut custom-effect] ${ registeredCount } effect(s) restored from library` );

	}

	return registeredCount;

}

/**
 * Safe folder / file stem from the effect display name (not the id).
 * Strips path-illegal characters; falls back to id when the name is empty.
 */
export function customEffectSafeBaseName( def ) {

	const raw = String( ( def && ( def.name || def.title ) ) || '' ).trim();
	const safe = raw
		.replace( /[<>:"/\\|?*\u0000-\u001f]+/g, '_' )
		.replace( /\s+/g, ' ' )
		.replace( /^[. ]+|[. ]+$/g, '' )
		.slice( 0, 80 );
	return safe || String( ( def && def.id ) || 'effect' );

}

/** Library / export JSON basename, e.g. `超级大光斑.json`. */
export function customEffectJsonFileName( def ) {

	return customEffectSafeBaseName( def ) + '.json';

}

/** Project-relative texture dir, e.g. `custom-effects/超级大光斑/assets`. */
export function customEffectAssetDir( def ) {

	return 'custom-effects/' + customEffectSafeBaseName( def ) + '/assets';

}

/**
 * Save a definition into the project library as custom-effects/<效果名>.json.
 * @param {object} projectFolder editor.projectFolder
 * @param {object} def
 * @returns {Promise<boolean>}
 */
export async function saveCustomEffectToLibrary( projectFolder, def ) {

	if ( ! projectFolder || typeof projectFolder.saveBlob !== 'function' ) return false;
	const json = JSON.stringify( def, null, '\t' );
	const blob = new Blob( [ json ], { type: 'application/json' } );
	return projectFolder.saveBlob( 'custom-effects', customEffectJsonFileName( def ), blob );

}

// ---------------------------------------------------------------------------
// Demo effects (P1 acceptance — delete or keep as presets later)
// ---------------------------------------------------------------------------

const DEMO_TINT = {
	id: 'demo-tint',
	name: '自定义·染色示例',
	version: 1,
	params: [
		{ key: 'amount', type: 'float', default: 0.5, min: 0, max: 1, step: 0.01, label: '强度', labelZh: '强度' },
		{ key: 'tint', type: 'color', default: '#c9a227', label: '染色', labelZh: '染色' },
	],
	textures: [],
	passes: [
		{
			name: 'tint',
			inputs: { uInput: 'uInput' },
			fragmentShader: /* glsl */`
				uniform sampler2D uInput;
				uniform float amount;
				uniform vec3 tint;
				varying vec2 vUv;
				void main() {
					vec4 c = texture2D( uInput, vUv );
					vec3 g = vec3( dot( c.rgb, vec3( 0.299, 0.587, 0.114 ) ) );
					gl_FragColor = vec4( mix( c.rgb, g * tint * 1.6, amount ), c.a );
				}
			`,
		},
	],
};

const DEMO_BLUR = {
	id: 'demo-blur',
	name: '自定义·两通道模糊示例',
	version: 1,
	params: [
		{ key: 'radius', type: 'float', default: 1.5, min: 0, max: 5, step: 0.05, label: '半径', labelZh: '半径' },
	],
	textures: [],
	passes: [
		{
			name: 'horz',
			downsample: 2,
			inputs: { uInput: 'uInput' },
			fragmentShader: /* glsl */`
				uniform sampler2D uInput;
				uniform float radius;
				uniform vec2 uTexel;
				varying vec2 vUv;
				void main() {
					vec4 sum = vec4( 0.0 );
					float weights[ 5 ];
					weights[ 0 ] = 0.227027; weights[ 1 ] = 0.194594; weights[ 2 ] = 0.121621; weights[ 3 ] = 0.054054; weights[ 4 ] = 0.016216;
					sum += texture2D( uInput, vUv ) * weights[ 0 ];
					for ( int i = 1; i < 5; i ++ ) {
						vec2 off = vec2( float( i ) * radius, 0.0 ) * uTexel;
						sum += texture2D( uInput, vUv + off ) * weights[ i ];
						sum += texture2D( uInput, vUv - off ) * weights[ i ];
					}
					gl_FragColor = sum;
				}
			`,
			output: { rt: 'blurH' },
		},
		{
			name: 'vert',
			downsample: 2,
			inputs: { uInput: '$rt:blurH' },
			fragmentShader: /* glsl */`
				uniform sampler2D uInput;
				uniform float radius;
				uniform vec2 uTexel;
				varying vec2 vUv;
				void main() {
					vec4 sum = vec4( 0.0 );
					float weights[ 5 ];
					weights[ 0 ] = 0.227027; weights[ 1 ] = 0.194594; weights[ 2 ] = 0.121621; weights[ 3 ] = 0.054054; weights[ 4 ] = 0.016216;
					sum += texture2D( uInput, vUv ) * weights[ 0 ];
					for ( int i = 1; i < 5; i ++ ) {
						vec2 off = vec2( 0.0, float( i ) * radius ) * uTexel;
						sum += texture2D( uInput, vUv + off ) * weights[ i ];
						sum += texture2D( uInput, vUv - off ) * weights[ i ];
					}
					gl_FragColor = sum;
				}
			`,
		},
	],
};

let _demosRegistered = false;

function registerDemoEffects() {

	if ( _demosRegistered ) return;
	_demosRegistered = true;
	registerCustomEffect( DEMO_TINT );
	registerCustomEffect( DEMO_BLUR );
	// P4 acceptance preset — config twin of BuiltinEffects `bokehGlow`.
	registerCustomEffect( BOKEH_GLOW_CUSTOM );

}

registerDemoEffects();

// Console API for P1 testing:
//   __fccCustomPostEffects.register(definition)
//   __fccCustomPostEffects.list()
if ( typeof window !== 'undefined' ) {

	window.__fccCustomPostEffects = {
		register: registerCustomEffect,
		validate: validateCustomEffectDefinition,
		list() {

			return Array.from( _registeredFingerprints.keys() ).map( ( id ) => CUSTOM_PREFIX + id );

		},
	};

}

// Named exports for constants only — the P2 factory / library functions
// above already use inline `export function`, and re-listing them here
// throws "Duplicate export" at module link time.
export {
	DEFAULT_VERTEX_SHADER_SRC,
	COPY_FRAGMENT_SHADER_SRC,
};

// ---------------------------------------------------------------------------
// MediaPlay RT bindings: definition/instance separation + autoCreate
// ---------------------------------------------------------------------------
// Definition texture slot (source:'rt') declares intent only — no uuid.
// Scene-instance bindings live on the stack entry:
//   entry.textureBindings = { <texName>: { rtUuid } }  (RT object node uuid)
// Resolution order: entry binding (manual or auto-created) → fallback.

/**
 * One-time migration: old definitions stored the RT uuid inline
 * (texture.rtUuid). Move it into entry.textureBindings and strip the def.
 * Idempotent; keeps the bindings object identity (per-frame closure reads it).
 */
export function migrateEntryTextureBindings( entry ) {

	const def = entry && entry.definition;
	if ( ! def || ! Array.isArray( def.textures ) ) return;
	if ( ! isPlainObject( entry.textureBindings ) ) entry.textureBindings = {};
	for ( const t of def.textures ) {

		if ( t.source === 'rt' && typeof t.rtUuid === 'string' && t.rtUuid ) {

			if ( ! entry.textureBindings[ t.name ] ) {

				entry.textureBindings[ t.name ] = { rtUuid: t.rtUuid };

			}

			delete t.rtUuid;

		}

	}

}

/** Stable media key for cross-scene player matching. */
function mediaStableKey( m ) {

	if ( ! isPlainObject( m ) ) return '';
	return m.kind === 'imageSequence'
		? String( m.sequenceDir || '' )
		: String( m.projectPath || '' );

}

function playerMatchesMedia( object, m ) {

	if ( ! isFccVideoPlayer( object ) ) return false;
	const vp = object.userData[ VP_KEY ];
	if ( ! vp ) return false;
	if ( m.kind === 'imageSequence' ) return !! m.sequenceDir && vp.sequenceDir === m.sequenceDir;
	return !! m.projectPath && vp.projectPath === m.projectPath && vp.fileName === ( m.fileName || '' );

}

function addObjectToScene( editor, object ) {

	try {

		editor.execute( new AddObjectCommand( editor, object ) );
		return true;

	} catch ( e ) {

		console.warn( '[FreeFilmCut custom-effect] AddObjectCommand failed, adding directly', e );
		editor.scene.add( object );
		editor.signals.sceneGraphChanged.dispatch();
		return true;

	}

}

/** Ownership marker: one RT+MediaPlay pair per effect slot across imports. */
function autoOwnKey( defId, texName ) {

	return 'custom:' + defId + ':' + texName;

}

function findSceneObjectByAutoOwn( scene, key, predicate ) {

	if ( ! key ) return null;
	let hit = null;
	scene.traverse( ( o ) => {

		if ( hit ) return;
		if ( o.userData && o.userData.fccAutoOwnedBy === key && predicate( o ) ) hit = o;

	} );
	return hit;

}

/**
 * Import / library restore: mark every RT texture slot as autoCreate so
 * ensureCustomEffectMediaBindings will materialize MediaPlay+RT (idempotent).
 * Mutates def in place; returns the number of RT slots touched.
 */
export function markCustomEffectRtSlotsForAutoCreate( def ) {

	if ( ! def || ! Array.isArray( def.textures ) ) return 0;
	let n = 0;
	for ( const t of def.textures ) {

		if ( ! t || t.source !== 'rt' ) continue;
		t.autoCreate = true;
		if ( ! isPlainObject( t.media ) ) {

			t.media = { kind: 'video', fileName: '', projectPath: '' };

		}
		n ++;

	}
	return n;

}

/**
 * Make sure every autoCreate RT slot of this entry has a live binding:
 * reuse by (1) alive binding, (2) fccAutoOwnedBy marker, (3) media stable key,
 * else create RT + player. Idempotent — never doubles nodes for the same slot.
 * Returns true when the scene or bindings changed.
 */
export async function ensureCustomEffectMediaBindings( editor, entry ) {

	const def = entry && entry.definition;
	if ( ! editor || ! def || ! Array.isArray( def.textures ) ) return false;
	const scene = editor.scene;
	if ( ! scene ) return false;

	let changed = false;
	for ( const t of def.textures ) {

		if ( t.source !== 'rt' || ! t.autoCreate ) continue;
		if ( ! isPlainObject( t.media ) ) t.media = { kind: 'video', fileName: '', projectPath: '' };
		const m = t.media;
		const key = mediaStableKey( m );
		const own = autoOwnKey( def.id, t.name );

		if ( ! isPlainObject( entry.textureBindings ) ) entry.textureBindings = {};
		const binding = entry.textureBindings[ t.name ];

		// Alive binding → nothing to do.
		const boundObj = ( binding && binding.rtUuid ) ? scene.getObjectByProperty( 'uuid', binding.rtUuid ) : null;
		if ( boundObj && isFccRenderTexture( boundObj ) ) continue;

		// Prefer a previously auto-created RT for this effect·slot (import twice → reuse).
		let rtObj = findSceneObjectByAutoOwn( scene, own, isFccRenderTexture );
		let player = findSceneObjectByAutoOwn( scene, own, isFccVideoPlayer );

		// Media stable-key scan (same video / sequence already in the scene).
		if ( ! player && key ) {

			scene.traverse( ( o ) => {

				if ( ! player && playerMatchesMedia( o, m ) ) player = o;

			} );

		}

		if ( ! rtObj && player ) {

			const targetUuid = player.userData[ VP_KEY ].targetUuid;
			rtObj = targetUuid ? scene.getObjectByProperty( 'uuid', targetUuid ) : null;
			if ( rtObj && ! isFccRenderTexture( rtObj ) ) rtObj = null;

		}

		if ( ! rtObj ) {

			rtObj = createRenderTextureObject( scene );
			rtObj.name = 'RT·' + ( def.title || def.name || def.id ) + '·' + t.name;
			ensureRenderTarget( rtObj );
			rtObj.userData.fccAutoOwnedBy = own;
			addObjectToScene( editor, rtObj );
			changed = true;

		} else if ( rtObj.userData.fccAutoOwnedBy !== own ) {

			rtObj.userData.fccAutoOwnedBy = own;

		}

		if ( ! player ) {

			player = createMediaPlayerObject( scene );
			const vp = player.userData[ VP_KEY ];
			vp.kind = ( m.kind === 'gif' ) ? 'gif' : ( ( m.kind === 'imageSequence' ) ? 'imageSequence' : 'video' );
			vp.fileName = String( m.fileName || '' );
			vp.projectPath = String( m.projectPath || '' );
			vp.sequenceDir = String( m.sequenceDir || '' );
			vp.sequenceFps = Number( m.sequenceFps ) || 30;
			vp.sequenceStart = Number( m.sequenceStart ) || 0;
			vp.sequenceEnd = ( m.sequenceEnd === undefined ) ? - 1 : Number( m.sequenceEnd );
			vp.targetUuid = rtObj.uuid;
			vp.playing = true;
			vp.loop = true;
			vp.muted = true; // effect assets stay silent
			player.name = 'MediaPlay·' + ( def.title || def.name || def.id ) + '·' + t.name;
			player.userData.fccAutoOwnedBy = own;
			addObjectToScene( editor, player );
			changed = true;

		} else {

			const vp = player.userData[ VP_KEY ];
			if ( vp.targetUuid !== rtObj.uuid ) {

				vp.targetUuid = rtObj.uuid;
				changed = true;

			}
			player.userData.fccAutoOwnedBy = own;
			// Fill empty media fields from the definition without wiping a live path.
			if ( key ) {

				if ( ! vp.projectPath && m.projectPath ) vp.projectPath = String( m.projectPath );
				if ( ! vp.fileName && m.fileName ) vp.fileName = String( m.fileName );
				if ( ! vp.sequenceDir && m.sequenceDir ) vp.sequenceDir = String( m.sequenceDir );

			}

		}

		// Mutate in place — the composer's per-frame closure holds this object.
		const prevUuid = binding && binding.rtUuid;
		entry.textureBindings[ t.name ] = { rtUuid: rtObj.uuid };
		if ( prevUuid !== rtObj.uuid ) changed = true;

	}

	if ( changed && editor.projectFolder ) {

		// Attach media buffers for newly created players (skips loaded ones).
		try {

			await restoreFccVideosFromProject( editor );

		} catch ( e ) {

			console.warn( '[FreeFilmCut custom-effect] media restore failed', e );

		}

	}

	return changed;

}
