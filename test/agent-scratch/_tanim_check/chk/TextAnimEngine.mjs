/**
 * FreeFilmCut textanim/2 — sampling engine (pure math, no THREE objects).
 *
 *   sampleTextAnim( anim, tSec, charCount )
 *     → { charPoses, passOps, needsCharSplit, end }
 *
 * Per frame: one call per animated Text. Cost ≈ chars × components; the real
 * cost in the editor is the per-char Troika/flower mesh stack (TextAnimRuntime),
 * which is why `needsCharSplit` is false for text-only stacks (wipe/blur) —
 * those keep the single original Text mesh.
 */

import { getTextAnimDescriptor } from './TextAnimRegistry.js?v=fcc-tanim-2';
import { easeSample, clamp01 } from './TextAnimTypes.js?v=fcc-tanim-2';

/** @returns {{offsetX:number,offsetY:number,rotateX:number,rotateY:number,rotateZ:number,scaleX:number,scaleY:number,opacity:number,charProgress:number}} */
export function createPose() {

	return {
		offsetX: 0,
		offsetY: 0,
		rotateX: 0,
		rotateY: 0,
		rotateZ: 0,
		scaleX: 1,
		scaleY: 1,
		opacity: 1,
		charProgress: 1,
	};

}

function mulberry32( seed ) {

	let a = seed >>> 0;
	return function () {

		a |= 0;
		a = ( a + 0x6D2B79F5 ) | 0;
		let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
		t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
		return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

	};

}

/**
 * rank[charIndex] = index in stagger order (0 = first to animate).
 * @returns {number[]}
 */
export function buildCharRanks( n, order, seed ) {

	const count = Math.max( 0, n | 0 );
	const rank = new Array( count );
	if ( count === 0 ) return rank;
	if ( count === 1 ) {

		rank[ 0 ] = 0;
		return rank;

	}

	const mid = ( count - 1 ) * 0.5;

	if ( order === 'ltr' ) {

		for ( let i = 0; i < count; i ++ ) rank[ i ] = i;
		return rank;

	}

	if ( order === 'rtl' ) {

		for ( let i = 0; i < count; i ++ ) rank[ i ] = count - 1 - i;
		return rank;

	}

	const idx = [];
	for ( let i = 0; i < count; i ++ ) idx.push( i );

	if ( order === 'center' || order === 'edges' ) {

		// Stable sort by distance to the visual center.
		const sign = order === 'center' ? 1 : - 1;
		idx.sort( ( a, b ) => ( Math.abs( a - mid ) - Math.abs( b - mid ) ) * sign || a - b );

	} else if ( order === 'random' ) {

		const rnd = mulberry32( seed || 1 );
		for ( let i = count - 1; i > 0; i -- ) {

			const j = Math.floor( rnd() * ( i + 1 ) );
			const tmp = idx[ i ];
			idx[ i ] = idx[ j ];
			idx[ j ] = tmp;

		}

	}

	for ( let r = 0; r < count; r ++ ) rank[ idx[ r ] ] = r;
	return rank;

}

/**
 * v1 semantics: when a whole-text (RT pass) component owns visibility, the
 * preview snapped glyphs to rest pose with opacity 1, otherwise the per-char
 * stagger fade sat on top of the sweep and washed it out. v2 keeps that as an
 * opt-in instance flag instead of an implicit rule.
 */
export function charPoseSuppressed( anim ) {

	const comps = anim && anim.components ? anim.components : [];
	for ( const c of comps ) {

		if ( ! c || ! c.enabled || ! c.suppressCharPose ) continue;
		const d = getTextAnimDescriptor( c.type );
		if ( d && d.scope === 'text' ) return true;

	}
	return false;

}

function needsCharSplitFor( anim ) {

	if ( charPoseSuppressed( anim ) ) return false;
	const comps = anim && anim.components ? anim.components : [];
	for ( const c of comps ) {

		if ( ! c || ! c.enabled ) continue;
		const d = getTextAnimDescriptor( c.type );
		if ( d && d.scope === 'char' ) return true;

	}
	return false;

}

export function textAnimNeedsCharSplit( anim ) {

	return needsCharSplitFor( anim );

}

export function textAnimTimelineEnd( anim ) {

	const comps = anim && anim.components ? anim.components : [];
	let end = 0;
	for ( const c of comps ) {

		if ( ! c || ! c.enabled || ! c.time ) continue;
		if ( c.time.loop === 'infinite' ) continue;
		end = Math.max( end, c.time.start + c.time.duration );

	}
	return end;

}

function localTime( comp, t ) {

	const ts = Number.isFinite( Number( comp.time.timeScale ) ) ? Number( comp.time.timeScale ) : 1;
	return ( t - comp.time.start ) * ts;

}

/**
 * Linear 0..1 progress of a whole component (no per-char stagger).
 * text-scope components and `ctx.raw` for char components both use this.
 */
function componentProgress( comp, lt ) {

	const dur = Math.max( 1e-4, Number( comp.time.duration ) || 1 );
	const loop = comp.time.loop || 'clamp';

	if ( loop === 'infinite' ) {

		// Ramp in over `duration`, then keep running at full strength.
		return clamp01( lt / dur );

	}

	if ( loop === 'loop' ) {

		if ( lt < 0 ) return 0;
		return clamp01( ( lt % dur ) / dur );

	}

	if ( loop === 'pingpong' ) {

		if ( lt < 0 ) return 0;
		const cycle = ( lt % ( dur * 2 ) ) / dur;
		return cycle <= 1 ? cycle : 2 - cycle;

	}

	// clamp
	if ( lt <= 0 ) return 0;
	if ( lt >= dur ) return 1;
	return lt / dur;

}

/**
 * Per-char weight for a component with a selector.
 * @returns {{raw:number, p:number}} raw = linear 0..1, p = eased × amount × range
 */
function charWeight( comp, lt, rank, n, sel ) {

	const dur = Math.max( 1e-4, Number( comp.time.duration ) || 1 );
	const delay = clamp01( sel.delay != null ? sel.delay : 0.35 );
	const step = n <= 1 ? 0 : ( delay * dur ) / ( n - 1 );
	const win = Math.max( 1e-4, dur - step * ( n - 1 ) );
	const l = lt - rank * step;

	const loop = comp.time.loop || 'clamp';
	let raw;

	if ( loop === 'infinite' ) {

		raw = clamp01( l / win );

	} else if ( loop === 'loop' ) {

		raw = l < 0 ? 0 : clamp01( ( l % win ) / win );

	} else if ( loop === 'pingpong' ) {

		if ( l < 0 ) raw = 0;
		else {

			const cycle = ( l % ( win * 2 ) ) / win;
			raw = cycle <= 1 ? cycle : 2 - cycle;

		}

	} else {

		raw = l <= 0 ? 0 : ( l >= win ? 1 : l / win );

	}

	let p = easeSample( sel.ease, raw ) * ( sel.amount != null ? sel.amount : 1 );

	const s0 = sel.start != null ? sel.start : 0;
	const s1 = sel.end != null ? sel.end : 1;
	if ( s0 > 0 || s1 < 1 ) {

		const pos = n <= 1 ? 0 : rank / ( n - 1 );
		if ( pos < s0 || pos > s1 ) {

			// Out of range is NOT p=0: the char is simply unaffected by this
			// component (AE Range Selector semantics), so the caller skips it.
			return { raw: 0, p: 0, skip: true };

		}

	}

	return { raw, p };

}

/**
 * @param {object} anim v2 document (normalized)
 * @param {number} tSec scrub time
 * @param {number} charCount animatable glyph count
 */
export function sampleTextAnim( anim, tSec, charCount ) {

	const result = {
		charPoses: null,
		passOps: [],
		needsCharSplit: false,
		end: 0,
	};

	const comps = anim && anim.components ? anim.components : [];
	if ( ! comps.length || ! anim.enabled ) return result;

	const t = Number.isFinite( tSec ) ? tSec : 0;
	const n = Math.max( 0, charCount | 0 );

	// ---- text scope: pass ops (no char split needed) ----
	for ( const comp of comps ) {

		if ( ! comp || ! comp.enabled ) continue;
		const desc = getTextAnimDescriptor( comp.type );
		if ( ! desc || desc.scope !== 'text' ) continue;
		if ( comp.time.loop !== 'infinite' ) {

			result.end = Math.max( result.end, comp.time.start + comp.time.duration );

		}
		const lt = localTime( comp, t );
		const raw = componentProgress( comp, lt );
		const op = desc.resolvePass( {
			t,
			lt,
			raw,
			p: raw,
			duration: comp.time.duration,
			params: comp.params,
			on: comp.channels || {},
			comp,
		} );
		if ( op && op.kind ) result.passOps.push( op );

	}

	if ( ! needsCharSplitFor( anim ) || n === 0 ) return result;

	// ---- char scope: per-glyph poses ----
	result.needsCharSplit = true;

	const poses = new Array( n );
	for ( let i = 0; i < n; i ++ ) poses[ i ] = createPose();

	for ( const comp of comps ) {

		if ( ! comp || ! comp.enabled ) continue;
		const desc = getTextAnimDescriptor( comp.type );
		if ( ! desc || desc.scope !== 'char' || ! desc.sample ) continue;

		if ( comp.time.loop !== 'infinite' ) {

			result.end = Math.max( result.end, comp.time.start + comp.time.duration );

		}

		const sel = comp.selector;
		const lt = localTime( comp, t );
		const ranks = sel ? buildCharRanks( n, sel.order, sel.seed ) : null;
		const amount = sel ? ( sel.amount != null ? sel.amount : 1 ) : 1;
		const ctx = {
			t,
			lt,
			raw: 0,
			p: 0,
			amount,
			duration: comp.time.duration,
			params: comp.params,
			on: comp.channels || {},
			comp,
			charIndex: 0,
			charCount: n,
		};

		for ( let i = 0; i < n; i ++ ) {

			let weight;
			if ( sel ) weight = charWeight( comp, lt, ranks[ i ], n, sel );
			else {

				const raw = componentProgress( comp, lt );
				weight = { raw, p: raw };

			}

			// p === 0 is NOT a no-op: it means "hold the From side" (hidden /
			// offset back), which is exactly what a pending entrance needs.
			// Out-of-range chars are different — they never touch the pose.
			if ( weight.skip ) continue;

			ctx.charIndex = i;
			ctx.raw = weight.raw;
			ctx.p = weight.p;
			desc.sample( ctx, poses[ i ] );

		}

	}

	result.charPoses = poses;
	return result;

}

/**
 * Text-scope only sampler — used by the Viewport wipe pass on frames where the
 * glyphs are NOT split (fast path).
 */
export function sampleTextPassOps( anim, tSec ) {

	const out = [];
	const comps = anim && anim.components ? anim.components : [];
	if ( ! anim.enabled ) return out;

	const t = Number.isFinite( tSec ) ? tSec : 0;
	for ( const comp of comps ) {

		if ( ! comp || ! comp.enabled ) continue;
		const desc = getTextAnimDescriptor( comp.type );
		if ( ! desc || desc.scope !== 'text' ) continue;
		const lt = localTime( comp, t );
		const raw = componentProgress( comp, lt );
		const op = desc.resolvePass( {
			t,
			lt,
			raw,
			p: raw,
			duration: comp.time.duration,
			params: comp.params,
			on: comp.channels || {},
			comp,
		} );
		if ( op && op.kind ) out.push( op );

	}
	return out;

}

/** Last wipe op wins (documented: components stack in order). */
export function findPassOp( ops, kind ) {

	if ( ! ops || ! ops.length ) return null;
	for ( let i = ops.length - 1; i >= 0; i -- ) {

		if ( ops[ i ] && ops[ i ].kind === kind ) return ops[ i ];

	}
	return null;

}
