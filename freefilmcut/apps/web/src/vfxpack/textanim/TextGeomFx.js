/**
 * Text-scope textanim fx rendered inside the Troika materials themselves:
 *   - bend: vertex displacement (rotZ → rotY/rotX into depth → pseudo-perspective)
 *   - wipeReveal: fragment mask + edge glint (刃光)
 *
 * Both are evaluated in the **text root's local space** (the fccUI text group),
 * so they compose with per-char poses (wave / charIn clones move first, bend
 * deforms the result) and the wipe blade follows the bent glyphs. Every Troika
 * mesh under the text (all flower layers, outline materials, per-char clones)
 * gets the same uniforms, so the whole Effect stack bends / reveals as one.
 *
 * Bounds prefer Troika layout (`textRenderInfo.visibleBounds`), falling back
 * to drawn-mesh AABB and a sticky last-good box. Scrub/seek can briefly clear
 * Troika layout info; we must NOT turn wipe off on those frames (flicker).
 */

import * as THREE from 'three';
import { Text } from 'troika-three-text';
import { getFccUI, isUIText } from '@/vfxpack/ui-overlay';
import { FCC_FLOWER_FACE, FCC_TEXT_MESH } from './clip-char-sync';
import { FCC_TEXTANIM_ROOT, FCC_TEXTANIM_LAYOUT, FCC_TEXTANIM_PARK } from './TextAnimRuntime.js';
import {
	ensureTextAnimOnUI,
	sampleWipeRevealProgress,
	sampleBendProgress,
} from './TextAnim.js';
import { getTextAnimSampleOpts } from './TextAnimOverrides.js';

/** Glyph quad subdivision while bending (4 verts/glyph at 1, 49 at 6). */
const BEND_GLYPH_DETAIL = 6;
const PROGRAM_KEY_SUFFIX = '|fccGeomFx1';

const WIPE_DIR_INDEX = { ltr: 0, rtl: 1, ttb: 2, btt: 3 };
const WIPE_BLEND_INDEX = { normal: 0, add: 1, screen: 2, multiply: 3, multi: 3 };

const VS_DEFS = /* glsl */`
uniform mat4 uFccToRoot;
uniform mat4 uFccFromRoot;
uniform float uFccBendOn;
uniform float uFccBendX;
uniform float uFccBendY;
uniform float uFccBendRotZ;
uniform float uFccBendStrength;
uniform vec2 uFccBendCenter;
uniform vec2 uFccBendHalf;
uniform float uFccBendFocal;
varying vec2 vFccRootPos;

// Text-root XY → bent XY (same units). Depth only drives the perspective scale.
vec2 fccBendForward( vec2 src ) {
	float s = uFccBendStrength;
	vec2 c = uFccBendCenter;
	vec2 d = src - c;
	float ang = uFccBendRotZ * s;
	float ca = cos( ang );
	float sa = sin( ang );
	vec3 q = vec3( d.x * ca - d.y * sa, d.x * sa + d.y * ca, 0.0 );
	float hx = max( uFccBendHalf.x, 1.0 );
	float hy = max( uFccBendHalf.y, 1.0 );
	// ±1 ≈ 57° at the half-extent edge; clamp keeps cos/sin stable for huge values.
	float ay = clamp( uFccBendY * s * ( q.x / hx ), - 1.55, 1.55 );
	float ax = clamp( uFccBendX * s * ( q.y / hy ), - 1.55, 1.55 );
	float cy = cos( ay );
	float sy = sin( ay );
	q = vec3( q.x * cy + q.z * sy, q.y, - q.x * sy + q.z * cy );
	float cx = cos( ax );
	float sx = sin( ax );
	q = vec3( q.x, q.y * cx - q.z * sx, q.y * sx + q.z * cx );
	float F = max( uFccBendFocal, 1.0 );
	float w = max( F - q.z, F * 0.12 );
	return c + q.xy * ( F / w );
}
`;

const VS_BODY = /* glsl */`
{
	vec4 fccRoot = uFccToRoot * vec4( transformed, 1.0 );
	vFccRootPos = fccRoot.xy;
	if ( uFccBendOn > 0.5 ) {
		fccRoot.xy = fccBendForward( fccRoot.xy );
		transformed = ( uFccFromRoot * fccRoot ).xyz;
	}
}
`;

const FS_DEFS = /* glsl */`
uniform float uFccWipeOn;
uniform float uFccWipeProgress;
uniform float uFccWipeSoft;
uniform float uFccWipeDir;
uniform vec4 uFccWipeBounds;
uniform float uFccWipeEdgeIntensity;
uniform float uFccWipeEdgeWidth;
uniform float uFccWipeBlend;
uniform float uFccWipeFillDim;
uniform float uFccWipeFillRange;
uniform float uFccWipeFillPower;
uniform float uFccWipeDebug;
varying vec2 vFccRootPos;
`;

const FS_TAIL = /* glsl */`
void fccApplyWipe() {
	if ( uFccWipeOn < 0.5 ) return;
	vec4 c = gl_FragColor;

	// Pre-bend text-root position → 0..1 across the layout ink box. Clamp so
	// strokes / shadows outside the box share the box edge's reveal time.
	vec4 b = uFccWipeBounds;
	float u = clamp( ( vFccRootPos.x - b.x ) / max( b.z - b.x, 1e-5 ), 0.0, 1.0 );
	float v = clamp( ( vFccRootPos.y - b.y ) / max( b.w - b.y, 1e-5 ), 0.0, 1.0 );

	// 1 at wipe-start … 0 at end (LTR: left first).
	float mask = 1.0 - u;
	if ( uFccWipeDir > 0.5 && uFccWipeDir < 1.5 ) mask = u;
	else if ( uFccWipeDir > 1.5 && uFccWipeDir < 2.5 ) mask = v;
	else if ( uFccWipeDir > 2.5 ) mask = 1.0 - v;

	float soft = max( uFccWipeSoft, 1e-4 );
	float pExp = uFccWipeProgress * ( 1.0 + 2.0 * soft ) - soft;
	float thresh = 1.0 - pExp;
	// Hard coverage: soft only widens the fill falloff, never punches glyph holes.
	float reveal = step( thresh, mask );

	float ew = max( uFccWipeEdgeWidth, 1e-4 );
	float edge = reveal * ( 1.0 - smoothstep( thresh, thresh + ew, mask ) )
		* smoothstep( thresh - 1e-4, thresh + ew * 0.25, mask );

	float dRev = max( 0.0, mask - thresh );
	float fallW = max( uFccWipeFillRange, max( ew * 3.0, soft * 2.0 ) );
	float tFill = clamp( dRev / max( fallW, 1e-4 ), 0.0, 1.0 );
	float bladeProx = pow( max( 1.0 - tFill, 0.0 ), max( uFccWipeFillPower, 0.01 ) );
	float fillMod = mix( clamp( uFccWipeFillDim, 0.0, 1.0 ), 1.0, bladeProx );
	fillMod = mix( fillMod, 1.0, smoothstep( 0.92, 1.0, uFccWipeProgress ) );

	float ink = smoothstep( 0.02, 0.18, c.a );
	edge *= ink;

	if ( uFccWipeDebug > 0.5 ) {
		vec3 dbg = vec3( reveal * fillMod );
		dbg = mix( dbg, mix( dbg, c.rgb, 0.55 ), ink * 0.45 );
		dbg = mix( dbg, vec3( 0.0, 1.0, 1.0 ), clamp( edge, 0.0, 1.0 ) );
		gl_FragColor = vec4( dbg, max( c.a, edge ) );
		return;
	}

	vec3 text = c.rgb * reveal;
	vec3 blade = edge * uFccWipeEdgeIntensity * vec3( 1.0 );
	vec3 fillGlow = text * fillMod;
	float boost = max( uFccWipeEdgeIntensity, 1.0 );
	vec3 rgb;
	if ( uFccWipeBlend < 0.5 ) {
		rgb = text + blade;
	} else if ( uFccWipeBlend < 1.5 ) {
		rgb = text + blade * 1.35 + fillGlow * 0.75 * boost;
	} else if ( uFccWipeBlend < 2.5 ) {
		vec3 aCol = clamp( fillGlow, 0.0, 1.0 );
		vec3 bCol = clamp( blade + vec3( reveal * fillMod * 0.55 * boost ), 0.0, 1.0 );
		rgb = vec3( 1.0 ) - ( vec3( 1.0 ) - aCol ) * ( vec3( 1.0 ) - bCol );
	} else {
		rgb = text * ( 0.18 + 0.82 * fillMod ) * vec3( 0.45 + 0.55 * reveal );
		rgb += blade * 0.9;
	}
	float a = max( c.a * reveal, edge * c.a ) * max( ink, reveal );
	gl_FragColor = vec4( rgb, a );
}

void main() {
	fccGeomMainInner();
	fccApplyWipe();
}
`;

// Troika derived vertex shaders have includes expanded; plain ones keep the include.
const VS_ANCHOR = /vec4\s+mvPosition\s*=\s*vec4\(\s*transformed\s*,\s*1\.0\s*\)\s*;/;
const FS_MAIN = /\bvoid\s+main\s*\(\s*\)/;

const uniformsByMaterial = new WeakMap();
const patchedMaterials = new WeakSet();
/** Text groups that had fx last frame — turned off once when fx stops. */
const activeGroups = new Set();

let warnedPatch = false;

const _toRoot = new THREE.Matrix4();
const _corner = new THREE.Vector3();

function makeUniforms() {

	return {
		uFccToRoot: { value: new THREE.Matrix4() },
		uFccFromRoot: { value: new THREE.Matrix4() },
		uFccBendOn: { value: 0 },
		uFccBendX: { value: 0 },
		uFccBendY: { value: 0 },
		uFccBendRotZ: { value: 0 },
		uFccBendStrength: { value: 0 },
		uFccBendCenter: { value: new THREE.Vector2() },
		uFccBendHalf: { value: new THREE.Vector2( 1, 1 ) },
		uFccBendFocal: { value: 400 },
		uFccWipeOn: { value: 0 },
		uFccWipeProgress: { value: 1 },
		uFccWipeSoft: { value: 0.12 },
		uFccWipeDir: { value: 0 },
		uFccWipeBounds: { value: new THREE.Vector4( 0, 0, 1, 1 ) },
		uFccWipeEdgeIntensity: { value: 0 },
		uFccWipeEdgeWidth: { value: 0.04 },
		uFccWipeBlend: { value: 0 },
		uFccWipeFillDim: { value: 1 },
		uFccWipeFillRange: { value: 0.12 },
		uFccWipeFillPower: { value: 2.5 },
		uFccWipeDebug: { value: 0 },
	};

}

// Keyed per material object: Troika's outline material is Object.create(face)
// and must still get its own uniform values.
function uniformsFor( material ) {

	let u = uniformsByMaterial.get( material );
	if ( ! u ) {

		u = makeUniforms();
		uniformsByMaterial.set( material, u );

	}
	return u;

}

function patchShaders( shader ) {

	let vs = shader.vertexShader;
	let fs = shader.fragmentShader;
	if ( vs.indexOf( 'fccBendForward' ) !== - 1 ) return;

	if ( vs.indexOf( '#include <project_vertex>' ) !== - 1 ) {

		vs = vs.replace( '#include <project_vertex>', VS_BODY + '\n#include <project_vertex>' );

	} else if ( VS_ANCHOR.test( vs ) ) {

		vs = vs.replace( VS_ANCHOR, ( m ) => VS_BODY + '\n' + m );

	} else {

		vs = null;

	}

	if ( ! vs || ! FS_MAIN.test( fs ) ) {

		if ( ! warnedPatch ) {

			warnedPatch = true;
			console.warn( '[FreeFilmCut] TextGeomFx: shader anchor missing; bend / wipe skipped for this material' );

		}
		return;

	}

	shader.vertexShader = VS_DEFS + vs;
	shader.fragmentShader = FS_DEFS + fs.replace( FS_MAIN, 'void fccGeomMainInner()' ) + FS_TAIL;

}

// Troika DerivedMaterial runs a user-assigned onBeforeCompile AFTER injecting
// its own shaders, so this sees the final Troika SDF source.
function geomFxOnBeforeCompile( shader ) {

	Object.assign( shader.uniforms, uniformsFor( this ) );
	patchShaders( shader );

}

function withGeomProgramKey( prev ) {

	const fn = function () {

		return prev.call( this ) + PROGRAM_KEY_SUFFIX;

	};
	fn.__fccGeomFx = true;
	return fn;

}

function ensurePatched( material ) {

	if ( ! material || ! material.isDerivedMaterial ) return false;
	if ( patchedMaterials.has( material ) ) return true;
	patchedMaterials.add( material );
	uniformsFor( material );
	material.onBeforeCompile = geomFxOnBeforeCompile;
	const prevKey = material.customProgramCacheKey;
	if ( typeof prevKey === 'function' && ! prevKey.__fccGeomFx ) {

		material.customProgramCacheKey = withGeomProgramKey( prevKey );

	}
	material.needsUpdate = true;
	return true;

}

function clamp01( v ) {

	const n = Number( v );
	return Number.isFinite( n ) ? Math.max( 0, Math.min( 1, n ) ) : 0;

}

function clampNum( v, lo, hi, fallback ) {

	const n = Number( v );
	if ( ! Number.isFinite( n ) || n === 0 ) return fallback;
	return Math.max( lo, Math.min( hi, n ) );

}

/** Local-matrix chain obj → root (excludes root). matrixWorld may be stale here. */
function matrixToRoot( obj, root, out ) {

	out.identity();
	for ( let o = obj; o && o !== root; o = o.parent ) {

		if ( o.matrixAutoUpdate ) o.updateMatrix();
		out.premultiply( o.matrix );

	}
	return out;

}

function validBounds( b ) {

	return !! ( b && b.length >= 4
		&& Number.isFinite( b[ 0 ] ) && Number.isFinite( b[ 1 ] )
		&& Number.isFinite( b[ 2 ] ) && Number.isFinite( b[ 3 ] )
		&& b[ 2 ] - b[ 0 ] > 1e-4 && b[ 3 ] - b[ 1 ] > 1e-4 );

}

function boundsFromTroika( troika, root ) {

	const info = troika && troika.textRenderInfo;
	if ( ! info ) return null;
	let b = info.visibleBounds;
	if ( ! validBounds( b ) ) b = info.blockBounds;
	if ( ! validBounds( b ) ) return null;

	matrixToRoot( troika, root, _toRoot );
	let minX = Infinity;
	let minY = Infinity;
	let maxX = - Infinity;
	let maxY = - Infinity;
	for ( let i = 0; i < 4; i ++ ) {

		_corner.set( i & 1 ? b[ 2 ] : b[ 0 ], i & 2 ? b[ 3 ] : b[ 1 ], 0 ).applyMatrix4( _toRoot );
		minX = Math.min( minX, _corner.x );
		minY = Math.min( minY, _corner.y );
		maxX = Math.max( maxX, _corner.x );
		maxY = Math.max( maxY, _corner.y );

	}
	const pad = Math.max( 2, Math.max( maxX - minX, maxY - minY ) * 0.06 );
	return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };

}

function childByName( parent, name ) {

	if ( ! parent ) return null;
	for ( let i = 0; i < parent.children.length; i ++ ) {

		if ( parent.children[ i ] && parent.children[ i ].name === name ) return parent.children[ i ];

	}
	return null;

}

/** Rest-pose ink box of the whole string in text-root space. */
function textRootBounds( group ) {

	// Char split: the hidden layout Troika holds the full-string layout.
	const animRoot = childByName( group, FCC_TEXTANIM_ROOT );
	if ( animRoot ) {

		const b = boundsFromTroika( childByName( animRoot, FCC_TEXTANIM_LAYOUT ), group );
		if ( b ) return b;

	}
	for ( const name of [ FCC_FLOWER_FACE, FCC_TEXT_MESH ] ) {

		const b = boundsFromTroika( childByName( group, name ), group );
		if ( b ) return b;

	}
	for ( let i = 0; i < group.children.length; i ++ ) {

		const c = group.children[ i ];
		if ( c instanceof Text ) {

			const b = boundsFromTroika( c, group );
			if ( b ) return b;

		}

	}
	return null;

}

/** Sticky last-good wipe/bend box across Troika sync gaps (scrub). */
const GEOM_FX_BOUNDS_UD = '__fccGeomFxBounds';

/**
 * Fallback when layout Troika has no textRenderInfo yet (common right after
 * scrub / char-split rebuild): AABB of currently drawn Troika meshes in text-root space.
 */
function boundsFromDrawnMeshes( group ) {

	const meshes = collectTroikaMeshes( group, [] );
	if ( ! meshes.length ) return null;

	let minX = Infinity;
	let minY = Infinity;
	let maxX = - Infinity;
	let maxY = - Infinity;
	let any = false;

	for ( let i = 0; i < meshes.length; i ++ ) {

		const mesh = meshes[ i ];
		const geo = mesh.geometry;
		if ( ! geo ) continue;
		if ( ! geo.boundingBox ) geo.computeBoundingBox();
		const bb = geo.boundingBox;
		if ( ! bb || bb.isEmpty() ) continue;

		matrixToRoot( mesh, group, _toRoot );
		for ( let c = 0; c < 8; c ++ ) {

			_corner.set(
				c & 1 ? bb.max.x : bb.min.x,
				c & 2 ? bb.max.y : bb.min.y,
				c & 4 ? bb.max.z : bb.min.z,
			).applyMatrix4( _toRoot );
			minX = Math.min( minX, _corner.x );
			minY = Math.min( minY, _corner.y );
			maxX = Math.max( maxX, _corner.x );
			maxY = Math.max( maxY, _corner.y );

		}
		any = true;

	}

	if ( ! any || ! ( maxX - minX > 1e-4 && maxY - minY > 1e-4 ) ) return null;
	const pad = Math.max( 2, Math.max( maxX - minX, maxY - minY ) * 0.02 );
	return { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };

}

function resolveFxBounds( group ) {

	let b = textRootBounds( group );
	if ( ! b ) b = boundsFromDrawnMeshes( group );
	if ( b ) {

		if ( ! group.userData ) group.userData = {};
		group.userData[ GEOM_FX_BOUNDS_UD ] = b;
		return b;

	}
	const sticky = group.userData && group.userData[ GEOM_FX_BOUNDS_UD ];
	return sticky || null;

}

function clearFxBounds( group ) {

	if ( group && group.userData ) delete group.userData[ GEOM_FX_BOUNDS_UD ];

}

/** Every drawn Troika mesh of this text (flower layers + char clones), not nested UI texts.
 * While char-split hides originals, skip parked/parent flower meshes — only char clones + layout. */
function collectTroikaMeshes( group, out ) {

	const hideOrig = !!( group.userData && group.userData.__fccTextAnimHideOriginals );
	const visit = ( o ) => {

		for ( let i = 0; i < o.children.length; i ++ ) {

			const c = o.children[ i ];
			if ( ! c ) continue;
			if ( c.name === FCC_TEXTANIM_PARK ) continue;
			if ( isUIText( c ) && ! ( c.userData && c.userData.__fccTextAnimChar ) ) continue;
			if ( c instanceof Text && c.name !== FCC_TEXTANIM_LAYOUT ) {

				// Parent originals parked/hidden: do not feed wipe/bend (would keep a second layer alive).
				if ( hideOrig && o === group ) continue;
				out.push( c );

			}
			visit( c );

		}

	};
	visit( group );
	return out;

}

function sampleGeomFx( group ) {

	const ui = getFccUI( group );
	if ( ! ui || ! ui.textAnim ) return null;
	ensureTextAnimOnUI( ui );
	const anim = ui.textAnim;
	if ( ! anim.enabled ) return null;

	const opts = getTextAnimSampleOpts( group );
	const wipe = sampleWipeRevealProgress( anim, opts );
	const bend = sampleBendProgress( anim, opts );
	const bendAmount = ( Math.abs( Number( bend.bendX ) || 0 ) + Math.abs( Number( bend.bendY ) || 0 )
		+ Math.abs( Number( bend.rotateZ ) || 0 ) ) * clamp01( bend.progress );
	const bendOn = bend.enabled && bendAmount > 1e-5;
	if ( ! wipe.enabled && ! bendOn ) return null;
	return { wipe: wipe.enabled ? wipe : null, bend: bendOn ? bend : null };

}

function writeBendUniforms( u, bend, bounds ) {

	if ( ! bend ) {

		u.uFccBendOn.value = 0;
		return;

	}
	const bw = Math.max( bounds.maxX - bounds.minX, 1 );
	const bh = Math.max( bounds.maxY - bounds.minY, 1 );
	const hx = bw * 0.5;
	const hy = bh * 0.5;
	const cx = Number.isFinite( Number( bend.centerX ) ) ? clamp01( bend.centerX ) : 0.5;
	const cy = Number.isFinite( Number( bend.centerY ) ) ? clamp01( bend.centerY ) : 0.5;
	u.uFccBendOn.value = 1;
	u.uFccBendX.value = Math.max( - 4, Math.min( 4, Number( bend.bendX ) || 0 ) );
	u.uFccBendY.value = Math.max( - 4, Math.min( 4, Number( bend.bendY ) || 0 ) );
	u.uFccBendRotZ.value = Math.max( - 6.2832, Math.min( 6.2832, Number( bend.rotateZ ) || 0 ) );
	u.uFccBendStrength.value = clamp01( bend.progress );
	u.uFccBendCenter.value.set( bounds.minX + bw * cx, bounds.minY + bh * cy );
	u.uFccBendHalf.value.set( hx, hy );
	// ~2.4× half-extent reads like mild 3D; larger = flatter.
	u.uFccBendFocal.value = Math.max( 80, Math.max( hx, hy ) * 2.4 );

}

function writeWipeUniforms( u, wipe, bounds, debug ) {

	if ( ! wipe ) {

		u.uFccWipeOn.value = 0;
		return;

	}
	const fillDim = Number( wipe.fillDim );
	const blendKey = String( wipe.blendMode || 'normal' ).toLowerCase();
	u.uFccWipeOn.value = 1;
	u.uFccWipeProgress.value = clamp01( wipe.progress );
	u.uFccWipeSoft.value = clampNum( wipe.soft, 0.02, 0.5, 0.12 );
	u.uFccWipeDir.value = WIPE_DIR_INDEX[ wipe.direction ] || 0;
	u.uFccWipeBounds.value.set( bounds.minX, bounds.minY, bounds.maxX, bounds.maxY );
	u.uFccWipeEdgeIntensity.value = Math.max( 0, Number( wipe.edgeIntensity ) || 0 );
	u.uFccWipeEdgeWidth.value = clampNum( wipe.edgeWidth, 0.005, 0.25, 0.04 );
	u.uFccWipeBlend.value = WIPE_BLEND_INDEX[ blendKey ] || 0;
	u.uFccWipeFillDim.value = Number.isFinite( fillDim ) ? Math.max( 0, Math.min( 1, fillDim ) ) : 1;
	u.uFccWipeFillRange.value = clampNum( wipe.fillRange, 0.02, 1, 0.12 );
	u.uFccWipeFillPower.value = clampNum( wipe.fillPower, 0.5, 8, 2.5 );
	u.uFccWipeDebug.value = debug ? 1 : 0;

}

function applyGroupFx( group, fx, debug ) {

	// Phase ended / no fx: clear sticky box and force wipe+bend off.
	if ( ! fx ) {

		clearFxBounds( group );
		const meshesOff = collectTroikaMeshes( group, [] );
		for ( let i = 0; i < meshesOff.length; i ++ ) {

			const mesh = meshesOff[ i ];
			const m = mesh.material;
			const mats = Array.isArray( m ) ? m : [ m ];
			for ( let k = 0; k < mats.length; k ++ ) {

				const mat = mats[ k ];
				if ( ! mat || ! patchedMaterials.has( mat ) ) continue;
				const u = uniformsFor( mat );
				writeBendUniforms( u, null, null );
				writeWipeUniforms( u, null, null, false );

			}

		}
		return;

	}

	const bounds = resolveFxBounds( group );
	const wantWipe = !! fx.wipe;
	const wantBend = !! fx.bend;
	// Scrub race: Troika textRenderInfo (and sometimes mesh AABB) briefly null.
	// Keep previous frame uniforms — writing wipe OFF here is the flicker.
	if ( ( wantWipe || wantBend ) && ! bounds ) return;

	const bend = wantBend ? fx.bend : null;
	const wipe = wantWipe ? fx.wipe : null;
	const needs = !! ( bend || wipe );
	const detail = bend ? BEND_GLYPH_DETAIL : 1;

	const meshes = collectTroikaMeshes( group, [] );
	for ( let i = 0; i < meshes.length; i ++ ) {

		const mesh = meshes[ i ];
		if ( mesh.glyphGeometryDetail !== detail ) mesh.glyphGeometryDetail = detail;

		const m = mesh.material;
		const mats = Array.isArray( m ) ? m : [ m ];
		let toRootReady = false;
		for ( let k = 0; k < mats.length; k ++ ) {

			const mat = mats[ k ];
			if ( ! mat ) continue;
			if ( needs ) {

				if ( ! ensurePatched( mat ) ) continue;

			} else if ( ! patchedMaterials.has( mat ) ) {

				continue;

			}

			const u = uniformsFor( mat );
			if ( needs ) {

				if ( ! toRootReady ) {

					matrixToRoot( mesh, group, _toRoot );
					toRootReady = true;

				}
				u.uFccToRoot.value.copy( _toRoot );
				u.uFccFromRoot.value.copy( _toRoot ).invert();

			}
			writeBendUniforms( u, bend, bounds );
			writeWipeUniforms( u, wipe, bounds, debug );

		}

	}

}

/**
 * Per frame, after applyTextAnimsInScene (char poses must be set first).
 * @param {THREE.Object3D} root scene
 * @param {{enabled?: boolean, debug?: boolean}} [opts]
 */
export function applyTextGeomFxInScene( root, opts = {} ) {

	if ( ! root ) return;
	const enabled = opts.enabled !== false;
	const debug = !! opts.debug;
	const seen = new Set();

	if ( enabled ) {

		root.traverse( ( obj ) => {

			if ( ! isUIText( obj ) ) return;
			if ( obj.userData && obj.userData.__fccTextAnimChar ) return;
			const fx = sampleGeomFx( obj );
			if ( ! fx ) return;
			seen.add( obj );
			activeGroups.add( obj );
			applyGroupFx( obj, fx, debug );

		} );

	}

	for ( const group of activeGroups ) {

		if ( seen.has( group ) ) continue;
		applyGroupFx( group, null, false );
		activeGroups.delete( group );

	}

}
