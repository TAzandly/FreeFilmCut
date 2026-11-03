/**
 * FreeFilmCut global screen uniforms (Unity-like _ScreenParams).
 *
 * GLSL must declare what it uses, e.g.:
 *   uniform vec2 uResolution;
 *   uniform vec4 uScreenParams;
 *   uniform vec2 uScreenTexelSize;
 *   uniform vec4 _ScreenParams; // optional Unity-style alias
 *
 * Values are project / safe-frame pixels (not CSS letterbox size).
 *
 *   uResolution      = vec2( width, height )
 *   uScreenTexelSize = vec2( 1/width, 1/height )
 *   uScreenParams    = vec4( width, height, 1+1/width, 1+1/height )  // Unity _ScreenParams layout
 *   _ScreenParams    = same as uScreenParams
 */

import * as THREE from 'three';

export const GLOBAL_SCREEN_UNIFORM_NAMES = [
	'uResolution',
	'uScreenTexelSize',
	'uScreenParams',
	'_ScreenParams',
];

const DECL_RE = /\buniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(?:vec2|vec4)\s+(uResolution|uScreenTexelSize|uScreenParams|_ScreenParams)\b/g;

export function detectGlobalScreenUniformsInGlsl( ...sources ) {

	const found = new Set();
	for ( const src of sources ) {

		if ( ! src ) continue;
		DECL_RE.lastIndex = 0;
		let m;
		while ( ( m = DECL_RE.exec( src ) ) !== null ) {

			found.add( m[ 1 ] );

		}

	}
	return GLOBAL_SCREEN_UNIFORM_NAMES.filter( ( n ) => found.has( n ) );

}

/**
 * Ensure material.uniforms entries exist for screen params.
 * @param {THREE.Material} material
 * @param {{ forceAll?: boolean }} [opts] forceAll=true adds all four (FreeFilmCut defaults).
 */
export function ensureGlobalScreenUniforms( material, opts = {} ) {

	if ( ! material || ( ! material.isShaderMaterial && ! material.isRawShaderMaterial ) ) return [];
	if ( ! material.uniforms ) material.uniforms = {};

	const forceAll = !! opts.forceAll;
	const fromGlsl = detectGlobalScreenUniformsInGlsl( material.vertexShader, material.fragmentShader );
	const fromDict = GLOBAL_SCREEN_UNIFORM_NAMES.filter( ( n ) => n in material.uniforms );
	const names = forceAll
		? GLOBAL_SCREEN_UNIFORM_NAMES.slice()
		: GLOBAL_SCREEN_UNIFORM_NAMES.filter( ( n ) => fromGlsl.includes( n ) || fromDict.includes( n ) );

	for ( const name of names ) {

		if ( ! material.uniforms[ name ] ) {

			if ( name === 'uResolution' || name === 'uScreenTexelSize' ) {

				material.uniforms[ name ] = { value: new THREE.Vector2( 1, 1 ) };

			} else {

				material.uniforms[ name ] = { value: new THREE.Vector4( 1, 1, 2, 2 ) };

			}

		}

	}

	return names;

}

/**
 * Write width/height into screen uniforms on one material.
 */
export function applyGlobalScreenParams( material, width, height ) {

	const w = Math.max( 1, Math.floor( Number( width ) || 1 ) );
	const h = Math.max( 1, Math.floor( Number( height ) || 1 ) );
	const forceAll = !!( material.userData && material.userData.freecapcutGlobalScreen );
	ensureGlobalScreenUniforms( material, { forceAll } );
	if ( ! material.uniforms ) return false;
	const hasAny = GLOBAL_SCREEN_UNIFORM_NAMES.some( ( n ) => !! material.uniforms[ n ] );
	if ( ! hasAny ) return false;

	const u = material.uniforms;
	if ( u.uResolution && u.uResolution.value && u.uResolution.value.isVector2 ) {

		u.uResolution.value.set( w, h );

	}
	if ( u.uScreenTexelSize && u.uScreenTexelSize.value && u.uScreenTexelSize.value.isVector2 ) {

		u.uScreenTexelSize.value.set( 1 / w, 1 / h );

	}
	const sx = 1 + 1 / w;
	const sy = 1 + 1 / h;
	if ( u.uScreenParams && u.uScreenParams.value && u.uScreenParams.value.isVector4 ) {

		u.uScreenParams.value.set( w, h, sx, sy );

	}
	if ( u._ScreenParams && u._ScreenParams.value && u._ScreenParams.value.isVector4 ) {

		u._ScreenParams.value.set( w, h, sx, sy );

	}

	material.uniformsNeedUpdate = true;
	return true;

}

/**
 * Apply to every ShaderMaterial under a scene root OR an editor.materials map.
 */
export function applyGlobalScreenParamsToMaterials( materials, width, height ) {

	if ( ! materials ) return 0;
	let n = 0;
	const list = Array.isArray( materials )
		? materials
		: ( typeof materials === 'object' ? Object.values( materials ) : [] );
	for ( const mat of list ) {

		if ( applyGlobalScreenParams( mat, width, height ) ) n ++;

	}
	return n;

}

export function applyGlobalScreenParamsToObject3D( root, width, height ) {

	if ( ! root || ! root.traverse ) return 0;
	let n = 0;
	root.traverse( ( obj ) => {

		if ( ! obj.isMesh && ! obj.isSkinnedMesh && ! obj.isPoints && ! obj.isLine ) return;
		const mats = Array.isArray( obj.material ) ? obj.material : [ obj.material ];
		for ( const mat of mats ) {

			if ( applyGlobalScreenParams( mat, width, height ) ) n ++;

		}

	} );
	return n;

}
