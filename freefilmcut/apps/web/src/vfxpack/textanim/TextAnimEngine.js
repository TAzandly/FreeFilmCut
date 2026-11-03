/**
 * FreeFilmCut textanim/3 — sampling engine (pure math, no THREE objects).
 *
 *   sampleTextAnim( anim, charCount, { time, values } )
 *     → { charPoses, passOps, needsCharSplit }
 *
 * `values` are the `.anim` overrides for this Text (ui/TextAnimOverrides.js).
 *
 * Per frame: one call per animated Text. Cost ≤chars × components; the real
 * cost in the editor is the per-char Troika/flower mesh stack (TextAnimRuntime),
 * which is why `needsCharSplit` is false for text-only stacks (wipe/blur) —
 * those keep the single original Text mesh.
 */

import { getTextAnimDescriptor } from './TextAnimRegistry.js';
import { easeSample, clamp01 } from './TextAnimTypes.js';
import { applyAnimEase } from './AnimEase.js';

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
 * Effective component state for one sample: static fields with `.anim`
 * overrides on top. Override keys (without the `textAnim.` prefix):
 *   <id>.progress  <id>.enabled  <id>.<param>  <id>.<param>.0|1
 *   <id>.selector.start|end|amount|delay
 * No progress key = 1 (the component sits at its end state).
 */
const SELECTOR_KEY_FIELDS = [ 'start', 'end', 'amount', 'delay' ];

function clampDef( def, v ) {

	let x = v;
	if ( def && def.min != null ) x = Math.max( def.min, x );
	if ( def && def.max != null ) x = Math.min( def.max, x );
	return x;

}

function copyParams( params ) {

	const out = {};
	for ( const k of Object.keys( params || {} ) ) {

		const v = params[ k ];
		out[ k ] = Array.isArray( v ) ? v.slice() : v;

	}
	return out;

}

export function resolveComponent( comp, desc, values ) {

	const out = {
		enabled: comp.enabled !== false,
		progress: 1,
		params: comp.params,
		selector: comp.selector,
	};
	if ( ! values || values.size === 0 ) return out;

	const id = comp.id;
	const ev = values.get( id + '.enabled' );
	if ( ev !== undefined ) out.enabled = ev >= 0.5;
	const pv = values.get( id + '.progress' );
	if ( pv !== undefined ) out.progress = clamp01( pv );

	const schema = desc && desc.params ? desc.params : {};
	let params = null;
	for ( const key of Object.keys( schema ) ) {

		const def = schema[ key ];
		if ( def.type === 'pair' ) {

			for ( let k = 0; k < 2; k ++ ) {

				const v = values.get( id + '.' + key + '.' + k );
				if ( v === undefined ) continue;
				if ( ! params ) params = copyParams( comp.params );
				if ( ! Array.isArray( params[ key ] ) ) params[ key ] = [ 0, 0 ];
				params[ key ][ k ] = clampDef( def, v );

			}

		} else if ( def.type === 'number' || def.type === 'bool' || def.type == null ) {

			let v = values.get( id + '.' + key );
			// Legacy pair tracks: prefer .0 (from) when the single path is absent.
			if ( v === undefined ) v = values.get( id + '.' + key + '.0' );
			if ( v === undefined ) continue;
			if ( ! params ) params = copyParams( comp.params );
			params[ key ] = def.type === 'bool' ? v >= 0.5 : clampDef( def, v );

		}

	}
	if ( params ) out.params = params;

	if ( comp.selector ) {

		let sel = null;
		for ( const f of SELECTOR_KEY_FIELDS ) {

			const v = values.get( id + '.selector.' + f );
			if ( v === undefined ) continue;
			if ( ! sel ) sel = Object.assign( {}, comp.selector );
			sel[ f ] = f === 'amount' ? Math.max( - 4, Math.min( 4, v ) ) : clamp01( v );

		}
		if ( sel ) {

			if ( sel.end < sel.start ) sel.end = sel.start;
			out.selector = sel;

		}

	}
	return out;

}

function maybeEnabled( comp, values ) {

	if ( ! comp ) return false;
	if ( comp.enabled ) return true;
	return !! ( values && values.has( comp.id + '.enabled' ) );

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
		// wipeReveal always composites after char poses — never treat as solo.
		if ( c.type === 'wipeReveal' ) continue;
		const d = getTextAnimDescriptor( c.type );
		if ( d && d.scope === 'text' ) return true;

	}
	return false;

}

/**
 * Structural: decides whether glyphs get split into per-char meshes. A
 * component that is statically off but has an `enabled` key still counts, so
 * keying it on does not need a rebuild.
 */
export function textAnimNeedsCharSplit( anim, values ) {

	if ( charPoseSuppressed( anim ) ) return false;
	const comps = anim && anim.components ? anim.components : [];
	for ( const c of comps ) {

		if ( ! maybeEnabled( c, values ) ) continue;
		const d = getTextAnimDescriptor( c.type );
		if ( d && d.scope === 'char' ) return true;

	}
	return false;

}

/**
 * Per-char weight in the progress domain. `delay` spreads the chars' start
 * points over [0, delay]; each char then runs over a window of 1 - delay.
 * @returns {{raw:number, p:number, skip?:boolean}} raw = linear 0..1, p = eased × amount
 */
export function charWeight( progress, rank, n, sel ) {

	const delay = clamp01( sel.delay != null ? sel.delay : 0.35 );
	const step = n <= 1 ? 0 : delay / ( n - 1 );
	const win = n <= 1 ? 1 : Math.max( 1e-4, 1 - delay );
	const raw = clamp01( ( progress - rank * step ) / win );

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

	const p = easeSample( sel.ease, raw ) * ( sel.amount != null ? sel.amount : 1 );
	return { raw, p };

}


/**
 * Local copy of anim key sampling so the engine does not import FreeCapCutAnimCore
 * (keeps textanim <-> anim dependency one-way).
 */
function sampleAnimKeys( keys, t ) {

	if ( ! keys || keys.length === 0 ) return null;
	if ( t <= keys[ 0 ].t ) return keys[ 0 ].v;
	if ( t >= keys[ keys.length - 1 ].t ) return keys[ keys.length - 1 ].v;
	for ( let i = 0; i < keys.length - 1; i ++ ) {

		const a = keys[ i ];
		const b = keys[ i + 1 ];
		if ( t >= a.t && t <= b.t ) {

			if ( b.t === a.t ) return a.v;
			const u = applyAnimEase( a.ease || 'linear', ( t - a.t ) / ( b.t - a.t ) );
			return a.v + ( b.v - a.v ) * u;

		}

	}
	return keys[ keys.length - 1 ].v;

}

/**
 * Invert a (typically monotonic 0->1) progress track: find clip time whose
 * sampled progress equals `targetP`. Used so each staggered char can read the
 * same param curve at its own local progress.
 */
export function timeAtProgress( progKeys, targetP ) {

	if ( ! progKeys || ! progKeys.length ) return null;
	const p = clamp01( targetP );
	const t0 = progKeys[ 0 ].t;
	const t1 = progKeys[ progKeys.length - 1 ].t;
	if ( ! ( t1 > t0 ) ) return t0;
	const v0 = sampleAnimKeys( progKeys, t0 );
	const v1 = sampleAnimKeys( progKeys, t1 );
	if ( v0 == null || v1 == null ) return t0;
	if ( Math.abs( v1 - v0 ) < 1e-9 ) return t0;
	const ascending = v1 >= v0;
	let lo = t0;
	let hi = t1;
	for ( let i = 0; i < 28; i ++ ) {

		const mid = ( lo + hi ) * 0.5;
		const v = sampleAnimKeys( progKeys, mid );
		if ( v == null ) break;
		if ( ascending ? ( v < p ) : ( v > p ) ) lo = mid;
		else hi = mid;

	}
	return ( lo + hi ) * 0.5;

}

/**
 * Re-resolve component params as if the clip were at the time when progress
 * equals `localP`. Returns null when there are no param tracks to remap
 * (caller falls back to static amplitude x weight).
 */
function resolveParamsAtLocalProgress( comp, desc, values, trackKeys, localP ) {

	if ( ! trackKeys || ! trackKeys.size || ! desc ) return null;
	const id = comp.id;
	const progKeys = trackKeys.get( id + '.progress' );
	if ( ! progKeys || ! progKeys.length ) return null;

	const schema = desc.params || {};
	let any = false;
	for ( const key of Object.keys( schema ) ) {

		if ( trackKeys.has( id + '.' + key ) || trackKeys.has( id + '.' + key + '.0' ) || trackKeys.has( id + '.' + key + '.1' ) ) {

			any = true;
			break;

		}

	}
	if ( ! any ) return null;

	const t = timeAtProgress( progKeys, localP );
	if ( t == null || ! Number.isFinite( t ) ) return null;

	const localValues = new Map();
	if ( values ) {

		for ( const [ k, v ] of values ) {

			if ( k === id + '.enabled' || k.indexOf( id + '.selector.' ) === 0 ) localValues.set( k, v );

		}

	}
	localValues.set( id + '.progress', clamp01( localP ) );

	for ( const key of Object.keys( schema ) ) {

		const pk = trackKeys.get( id + '.' + key );
		if ( pk && pk.length ) {

			const v = sampleAnimKeys( pk, t );
			if ( v != null && Number.isFinite( v ) ) localValues.set( id + '.' + key, v );
			continue;

		}
		const pk0 = trackKeys.get( id + '.' + key + '.0' );
		const pk1 = trackKeys.get( id + '.' + key + '.1' );
		if ( pk0 && pk0.length ) {

			const v = sampleAnimKeys( pk0, t );
			if ( v != null && Number.isFinite( v ) ) localValues.set( id + '.' + key + '.0', v );

		}
		if ( pk1 && pk1.length ) {

			const v = sampleAnimKeys( pk1, t );
			if ( v != null && Number.isFinite( v ) ) localValues.set( id + '.' + key + '.1', v );

		}

	}

	return resolveComponent( comp, desc, localValues );

}


/**
 * Far pose for charIn (start) / charOut (end): sample param keys at progress
 * 0 or 1, or the first/last key on each track. Never use the live global
 * interpolated values — those caused rigid whole-text motion when multiplied
 * by per-char weight.
 */
function resolveFarParams( comp, desc, values, trackKeys, atEnd ) {

	if ( ! desc ) return comp && comp.params ? comp.params : {};
	const id = comp.id;
	const localValues = new Map();
	if ( values ) {

		for ( const [ k, v ] of values ) {

			if ( k === id + '.enabled' || k.indexOf( id + '.selector.' ) === 0 ) localValues.set( k, v );

		}

	}

	const targetP = atEnd ? 1 : 0;
	if ( trackKeys && trackKeys.size ) {

		const progKeys = trackKeys.get( id + '.progress' );
		if ( progKeys && progKeys.length ) {

			const remapped = resolveParamsAtLocalProgress( comp, desc, localValues, trackKeys, targetP );
			if ( remapped ) return remapped.params;

		}

		const schema = desc.params || {};
		for ( const key of Object.keys( schema ) ) {

			const pk = trackKeys.get( id + '.' + key );
			if ( pk && pk.length ) {

				localValues.set( id + '.' + key, atEnd ? pk[ pk.length - 1 ].v : pk[ 0 ].v );
				continue;

			}
			const pk0 = trackKeys.get( id + '.' + key + '.0' );
			if ( pk0 && pk0.length ) {

				localValues.set( id + '.' + key + '.0', atEnd ? pk0[ pk0.length - 1 ].v : pk0[ 0 ].v );

			}

		}

	}

	return resolveComponent( comp, desc, localValues ).params;

}

function passOpsFor( comps, time, values ) {

	const out = [];
	for ( const comp of comps ) {

		if ( ! comp ) continue;
		const desc = getTextAnimDescriptor( comp.type );
		if ( ! desc || desc.scope !== 'text' ) continue;
		const r = resolveComponent( comp, desc, values );
		if ( ! r.enabled ) continue;
		const op = desc.resolvePass( {
			t: time,
			raw: r.progress,
			p: r.progress,
			params: r.params,
			on: comp.channels || {},
			comp,
		} );
		if ( op && op.kind ) out.push( op );

	}
	return out;

}

/**
 * @param {object} anim textanim/3 document (normalized)
 * @param {number} charCount animatable glyph count
 * @param {{ time?: number, values?: Map<string, number>|null, keys?: Map<string, object[]>|null }} [opts]
 *   time = clock for continuous components (owning clip's local time)
 *   keys = raw keyframe arrays (same path keys as values) for per-char remap
 */
export function sampleTextAnim( anim, charCount, opts ) {

	const result = {
		charPoses: null,
		passOps: [],
		needsCharSplit: false,
	};

	const comps = anim && anim.components ? anim.components : [];
	if ( ! comps.length || ! anim.enabled ) return result;

	const time = opts && Number.isFinite( opts.time ) ? opts.time : 0;
	const values = opts && opts.values ? opts.values : null;
	const trackKeys = opts && opts.keys ? opts.keys : null;
	const n = Math.max( 0, charCount | 0 );

	result.passOps = passOpsFor( comps, time, values );

	if ( ! textAnimNeedsCharSplit( anim, values ) || n === 0 ) return result;

	// ---- char scope: per-glyph poses ----
	result.needsCharSplit = true;

	const poses = new Array( n );
	for ( let i = 0; i < n; i ++ ) poses[ i ] = createPose();

	for ( const comp of comps ) {

		if ( ! comp ) continue;
		const desc = getTextAnimDescriptor( comp.type );
		if ( ! desc || desc.scope !== 'char' || ! desc.sample ) continue;
		const r = resolveComponent( comp, desc, values );
		if ( ! r.enabled ) continue;

		const sel = r.selector;
		const ranks = sel ? buildCharRanks( n, sel.order, sel.seed ) : null;
		const amount = sel ? ( sel.amount != null ? sel.amount : 1 ) : 1;
		// charIn/charOut: CapCut stagger = far amplitude (keys at progress 0/1)
		// times per-char weight. Do NOT sample live global param values here —
		// that made every glyph share one Y and look like rigid vertical motion.
		// Do NOT set paramsMapped+p=amount either: with rest defaults or a stale
		// builtins build that ignores paramsMapped, that path zeros all motion.
		const staggerFar = !! desc.progressMappedParams || desc.type === 'charIn' || desc.type === 'charOut';
		const farParams = staggerFar
			? resolveFarParams( comp, desc, values, trackKeys, desc.type === 'charOut' || desc.category === 'out' )
			: r.params;
		const ctx = {
			t: time,
			raw: 0,
			p: 0,
			progress: r.progress,
			amount,
			params: farParams,
			paramsMapped: false,
			on: comp.channels || {},
			comp,
			charIndex: 0,
			charCount: n,
		};

		for ( let i = 0; i < n; i ++ ) {

			const weight = sel
				? charWeight( r.progress, ranks[ i ], n, sel )
				: { raw: r.progress, p: r.progress };

			// Out-of-range chars never touch the pose (AE Range Selector).
			if ( weight.skip ) continue;

			ctx.charIndex = i;
			ctx.raw = weight.raw;
			ctx.params = staggerFar ? farParams : r.params;
			ctx.paramsMapped = false;
			ctx.p = weight.p;
			ctx.progress = r.progress;

			desc.sample( ctx, poses[ i ] );

		}

	}

	result.charPoses = poses;
	return result;

}

/**
 * Text-scope only sampler —used by TextGeomFx on frames where the glyphs are
 * NOT split (fast path).
 */
export function sampleTextPassOps( anim, opts ) {

	const comps = anim && anim.components ? anim.components : [];
	if ( ! anim || ! anim.enabled ) return [];
	const time = opts && Number.isFinite( opts.time ) ? opts.time : 0;
	const values = opts && opts.values ? opts.values : null;
	return passOpsFor( comps, time, values );

}

/** Last wipe op wins (documented: components stack in order). */
export function findPassOp( ops, kind ) {

	if ( ! ops || ! ops.length ) return null;
	for ( let i = ops.length - 1; i >= 0; i -- ) {

		if ( ops[ i ] && ops[ i ].kind === kind ) return ops[ i ];

	}
	return null;

}
