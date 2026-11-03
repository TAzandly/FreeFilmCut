/**
 * FreeFilmCut textanim/3 data model.
 *
 *   freecapcut.textanim/3 = {
 *     format, enabled, components: [component…], legacy: (v1 doc | null)
 *   }
 *
 * Components carry no time window: progress, numeric params and selector
 * fields are driven by `.anim` keys under `textAnim.<compId>.*` (see
 * ui/TextAnimOverrides.js). A /2 component may still hold `time` until the
 * editor converts it into keys (ui/TextAnimKeys.js); /2 documents load as /3.
 * No global `stagger`: each component owns a `selector`.
 * Component order === stacking order.
 * Hard rule: every text-scope pass (wipeReveal, …) is kept AFTER all
 * char-scope components so wipe always composites on top of per-char motion.
 *
 * v1 (freecapcut.textanim/1) documents are migrated in place on load:
 *   in.channels  →charIn      out.channels →charOut
 *   wave (char); bend (text)  →wave (char); bend (text) (char)
 *   wipeReveal   →wipeReveal  (text)
 * The original v1 object is kept under `legacy` for rollback.
 */

import {
	getTextAnimDescriptor,
	createTextAnimInstance,
	cloneParams,
	paramDefault,
	defaultSelector,
} from './TextAnimRegistry.js';

import './TextAnimBuiltins.js?v=fcc-tanim-24';

export const TEXTANIM_FORMAT = 'freecapcut.textanim/3';
export const TEXTANIM_FORMAT_V2 = 'freecapcut.textanim/2';
export const TEXTANIM_FORMAT_V1 = 'freecapcut.textanim/1';

function isComponentFormat( f ) {

	return f === TEXTANIM_FORMAT || f === TEXTANIM_FORMAT_V2;

}

export const TEXTANIM_EASES = [ 'linear', 'cubicOut', 'cubicInOut', 'bounceOut', 'spring' ];
export const TEXTANIM_ORDERS = [ 'ltr', 'rtl', 'center', 'edges', 'random' ];
export const TEXTANIM_WIPE_DIRS = [ 'ltr', 'rtl', 'ttb', 'btt' ];
export const TEXTANIM_LOOPS = [ 'clamp', 'loop', 'pingpong', 'infinite' ];

/** Soft cap —sampling is cheap, this keeps the sidebar readable. */
export const TEXTANIM_MAX_COMPONENTS = 12;

// ---------------------------------------------------------------- helpers

export function num( v, fallback ) {

	const n = Number( v );
	return Number.isFinite( n ) ? n : fallback;

}

export function clamp01( x ) {

	return x < 0 ? 0 : ( x > 1 ? 1 : x );

}

function deepClone( v ) {

	if ( v == null ) return v;
	try {

		return JSON.parse( JSON.stringify( v ) );

	} catch ( e ) {

		return null;

	}

}

export function easeSample( name, t ) {

	const x = clamp01( t );
	switch ( name ) {

		case 'cubicInOut':
			return x < 0.5 ? 4 * x * x * x : 1 - Math.pow( - 2 * x + 2, 3 ) / 2;
		case 'cubicOut':
			return 1 - Math.pow( 1 - x, 3 );
		case 'bounceOut': {

			const n1 = 7.5625;
			const d1 = 2.75;
			if ( x < 1 / d1 ) return n1 * x * x;
			if ( x < 2 / d1 ) {

				const y = x - 1.5 / d1; return n1 * y * y + 0.75;

			}
			if ( x < 2.5 / d1 ) {

				const y = x - 2.25 / d1; return n1 * y * y + 0.9375;

			}
			const y = x - 2.625 / d1;
			return n1 * y * y + 0.984375;

		}
		case 'spring': {

			// Underdamped harmonic toward 1 —overshoots then settles.
			if ( x <= 0 ) return 0;
			if ( x >= 1 ) return 1;
			const omega = 14;
			const zeta = 0.38;
			const wd = omega * Math.sqrt( Math.max( 1e-6, 1 - zeta * zeta ) );
			const exp = Math.exp( - zeta * omega * x );
			return 1 - exp * ( Math.cos( wd * x ) + ( zeta * omega / wd ) * Math.sin( wd * x ) );

		}
		case 'linear':
		default:
			return x;

	}

}

// ---------------------------------------------------------------- defaults

export function createDefaultTextAnim() {

	return {
		format: TEXTANIM_FORMAT,
		enabled: false,
		components: [],
		legacy: null,
		legacyRepaired: true,
	};

}

export function createDefaultComponent( anim, type ) {

	const comp = createTextAnimInstance( anim, type );
	if ( type === 'wave' ) {

		comp.selector.delay = 0;
		comp.selector.ease = 'linear';

	}
	return comp;

}

// ---------------------------------------------------------------- normalize

export function normalizeTime( raw, desc ) {

	const t = ( raw && typeof raw === 'object' ) ? raw : {};
	const loop = TEXTANIM_LOOPS.includes( t.loop ) ? t.loop : 'clamp';
	return {
		start: Math.max( 0, num( t.start, 0 ) ),
		duration: Math.max( 0.01, num( t.duration, desc ? desc.defaultDuration : 1 ) ),
		loop,
		timeScale: num( t.timeScale, 1 ),
	};

}

/**
 * v2 time window → progress keys ({ t, v, ease? }, seconds on the clip).
 * clamp / infinite: 0→1 over the window (infinite only ramped in, the
 * motion itself runs on the clock). loop: sawtooth, pingpong: triangle, both
 * expanded until `horizon`.
 */
export function timeToProgressKeys( rawTime, horizon, desc ) {

	const time = normalizeTime( rawTime, desc );
	const speed = Math.abs( time.timeScale ) > 1e-4 ? Math.abs( time.timeScale ) : 1;
	const d = Math.max( 0.01, time.duration / speed );
	const s = time.start;
	if ( time.loop !== 'loop' && time.loop !== 'pingpong' ) {

		return [ { t: s, v: 0 }, { t: s + d, v: 1 } ];

	}
	const end = Math.max( s + d, num( horizon, 0 ) );
	const cycles = Math.min( 64, Math.max( 1, Math.ceil( ( end - s ) / d - 1e-6 ) ) );
	const keys = [];
	if ( time.loop === 'pingpong' ) {

		for ( let i = 0; i <= cycles; i ++ ) keys.push( { t: s + i * d, v: i % 2 } );
		return keys;

	}
	// Sawtooth: a step key holds 1 at the cycle end, the next key drops to 0.
	const eps = 1e-3;
	keys.push( { t: s, v: 0 } );
	for ( let i = 1; i <= cycles; i ++ ) {

		keys.push( { t: s + i * d, v: 1, ease: 'step' } );
		if ( i < cycles ) keys.push( { t: s + i * d + eps, v: 0 } );

	}
	delete keys[ keys.length - 1 ].ease;
	return keys;

}

function normalizeSelectorInPlace( sel, desc ) {

	if ( ! desc || ! desc.selector ) return null;
	const d = defaultSelector();
	const s = ( sel && typeof sel === 'object' ) ? sel : {};
	s.unit = s.unit === 'word' || s.unit === 'line' ? s.unit : 'char';
	s.order = TEXTANIM_ORDERS.includes( s.order ) ? s.order : d.order;
	s.start = clamp01( num( s.start, d.start ) );
	s.end = clamp01( num( s.end, d.end ) );
	if ( s.end < s.start ) s.end = s.start;
	s.amount = num( s.amount, d.amount );
	s.delay = clamp01( num( s.delay, d.delay ) );
	s.ease = TEXTANIM_EASES.includes( s.ease ) ? s.ease : d.ease;
	s.seed = Math.floor( num( s.seed, d.seed ) ) || 1;
	return s;

}

/** Collapse legacy [from,to] / {from,to} to one number — keep from/[0] so old docs stay visibly offset. */
function collapseLegacyPair( cur, fallback ) {

	if ( Array.isArray( cur ) ) return num( cur[ 0 ], fallback );
	if ( cur && typeof cur === 'object' && ( 'from' in cur || 'to' in cur ) ) return num( cur.from, fallback );
	return num( cur, fallback );

}

function normalizeParamsInPlace( params, desc ) {

	const p = ( params && typeof params === 'object' ) ? params : {};
	const schema = desc ? desc.params : {};
	for ( const key of Object.keys( schema ) ) {

		const def = schema[ key ];
		const cur = p[ key ];
		if ( def.type === 'pair' ) {

			// Legacy schema only — builtins no longer declare pair; keep for third-party.
			const fallback = paramDefault( def );
			const fb0 = Array.isArray( fallback ) ? fallback[ 0 ] : fallback;
			const fb1 = Array.isArray( fallback ) ? fallback[ 1 ] : fallback;
			if ( Array.isArray( cur ) ) {

				p[ key ] = [
					num( cur[ 0 ], fb0 ),
					num( cur[ 1 ], fb1 ),
				];

			} else if ( cur && typeof cur === 'object' ) {

				p[ key ] = [ num( cur.from, fb0 ), num( cur.to, fb1 ) ];

			} else {

				p[ key ] = Array.isArray( fallback ) ? fallback.slice() : [ fb0, fb1 ];

			}

		} else if ( def.type === 'select' ) {

			const opts = Array.isArray( def.options ) ? def.options : Object.keys( def.options || {} );
			p[ key ] = opts.includes( cur ) ? cur : paramDefault( def );

		} else if ( def.type === 'bool' ) {

			p[ key ] = cur != null ? !! cur : paramDefault( def );

		} else if ( def.type === 'color' ) {

			p[ key ] = typeof cur === 'string' ? cur : paramDefault( def );

		} else {

			// number (and default): accept legacy pair shapes
			p[ key ] = collapseLegacyPair( cur, paramDefault( def ) );

		}

		if ( def.min != null && def.type === 'number' ) p[ key ] = Math.max( def.min, p[ key ] );
		if ( def.max != null && def.type === 'number' ) p[ key ] = Math.min( def.max, p[ key ] );

	}
	return p;

}

/**
 * Normalize one component in place. Unknown types are kept (disabled) so a
 * newer document does not lose data when opened in an older build.
 */
export function normalizeComponentInPlace( comp ) {

	if ( ! comp || typeof comp !== 'object' ) return null;
	const desc = getTextAnimDescriptor( comp.type );

	comp.id = typeof comp.id === 'string' && comp.id ? comp.id : 'c_' + String( comp.type || 'unknown' ) + '_x';
	comp.enabled = comp.enabled !== false;
	if ( comp.time != null ) comp.time = normalizeTime( comp.time, desc );
	else delete comp.time;

	if ( ! desc ) {

		comp.enabled = false;
		comp.unknown = true;
		comp.channels = ( comp.channels && typeof comp.channels === 'object' ) ? comp.channels : {};
		comp.params = ( comp.params && typeof comp.params === 'object' ) ? comp.params : {};
		comp.selector = null;
		return comp;

	}

	delete comp.unknown;
	comp.scope = desc.scope;
	// bend: v1/char-era `amount`/`lift` → whole-text bendX/Y + center.
	if ( comp.type === 'bend' && comp.params && typeof comp.params === 'object' ) {

		const pp = comp.params;
		if ( pp.bendY == null && pp.amount != null ) pp.bendY = pp.amount;
		if ( pp.bendX == null ) pp.bendX = 0;
		if ( pp.centerX == null ) pp.centerX = 0.5;
		if ( pp.centerY == null ) pp.centerY = 0.5;

	}
	comp.params = normalizeParamsInPlace( comp.params, desc );

	const chans = ( comp.channels && typeof comp.channels === 'object' ) ? comp.channels : {};
	for ( const ch of desc.channels ) {

		if ( chans[ ch ] === undefined ) {

			chans[ ch ] = desc.defaultChannels ? desc.defaultChannels[ ch ] === true : true;

		} else {

			chans[ ch ] = chans[ ch ] !== false;

		}

	}
	comp.channels = chans;

	comp.selector = normalizeSelectorInPlace( comp.selector, desc );

	// Text-scope wipe must compose with char poses (product rule).
	// wipeReveal never solos; other text passes keep opt-in suppressCharPose.
	if ( desc.scope === 'text' ) {

		if ( comp.type === 'wipeReveal' ) {

			delete comp.suppressCharPose;

		} else {

			comp.suppressCharPose = comp.suppressCharPose === true;

		}

	} else {

		delete comp.suppressCharPose;

	}
	return comp;

}

export function createComponentFromRaw( raw ) {

	if ( ! raw || typeof raw !== 'object' || ! raw.type ) return null;
	const desc = getTextAnimDescriptor( raw.type );
	const base = desc
		? createTextAnimInstance( null, raw.type, {
			id: raw.id,
			enabled: raw.enabled !== false,
			time: raw.time,
			params: raw.params,
			channels: raw.channels,
			selector: raw.selector,
			suppressCharPose: raw.suppressCharPose,
		} )
		: null;

	if ( base ) {

		// createTextAnimInstance ignores unknown/partial selector keys →normalize again.
		base.params = Object.assign( cloneParams( desc ), raw.params || {} );
		if ( base.selector && raw.selector ) Object.assign( base.selector, raw.selector );
		normalizeComponentInPlace( base );
		return base;

	}

	return normalizeComponentInPlace( deepClone( raw ) );

}

// ---------------------------------------------------------------- v1 migration

function v1Defaults( kind ) {

	const isIn = kind !== 'out';
	return {
		duration: 1.0,
		overlap: 0.65,
		order: 'ltr',
		seed: 1,
		ease: 'cubicOut',
		channels: {
			opacity: { from: isIn ? 0 : 1, to: isIn ? 1 : 0 },
			offsetX: { from: 0, to: 0 },
			offsetY: { from: isIn ? - 36 : 36, to: 0 },
			scale: { from: isIn ? 0.55 : 1, to: isIn ? 1 : 0.55 },
			rotateZ: { from: isIn ? - 0.35 : 0.35, to: 0 },
		},
		wave: { amp: 12, freq: 1.25, phase: 0 },
		bend: { bendX: 0, bendY: 0.35, centerX: 0.5, centerY: 0.5 },
		wipe: { direction: 'ltr', soft: 0.12, edgeIntensity: 2.5, edgeWidth: 0.04, blendMode: 'normal' },
	};

}

function v1PhaseIsDefault( phase, kind ) {

	if ( ! phase || typeof phase !== 'object' ) return true;
	const d = v1Defaults( kind );
	const eps = 1e-4;
	const near = ( a, b ) => Math.abs( num( a, b ) - b ) < eps;

	if ( ! near( phase.duration, d.duration ) ) return false;
	const st = phase.stagger || {};
	if ( ! near( st.overlap, d.overlap ) ) return false;
	if ( ( st.order || d.order ) !== d.order ) return false;
	if ( phase.ease && phase.ease !== d.ease ) return false;

	const ch = phase.channels || {};
	for ( const key of Object.keys( d.channels ) ) {

		const c = ch[ key ];
		if ( ! c || typeof c !== 'object' ) continue;
		if ( ! near( c.from, d.channels[ key ].from ) ) return false;
		if ( ! near( c.to, d.channels[ key ].to ) ) return false;

	}

	const mod = phase.modulators || {};
	const w = mod.wave;
	if ( w && w.enabled ) return false;
	const b = mod.bend;
	if ( b && b.enabled ) return false;
	const wp = mod.wipeReveal;
	if ( wp && wp.enabled ) return false;

	return true;

}

/** v1 channel → single number; keep `from` (visible offset) per keyframe migration. */
function v1Pair( phase, key, defFrom, defTo ) {

	const ch = phase && phase.channels ? phase.channels[ key ] : null;
	if ( ! ch || typeof ch !== 'object' ) return defFrom;
	return num( ch.from, defFrom );

}

/**
 * v1 kept modulators under `phase.modulators.*`, but `wipeReveal` was also
 * written as a phase sibling in some builds. Look in both so a saved project
 * never loses its sweep silently.
 */
function v1Modulator( phase, name ) {

	if ( ! phase || typeof phase !== 'object' ) return null;
	const mods = ( phase.modulators && typeof phase.modulators === 'object' ) ? phase.modulators : null;
	let raw = mods ? mods[ name ] : null;
	if ( ! raw || typeof raw !== 'object' ) raw = phase[ name ];
	if ( ! raw || typeof raw !== 'object' ) return null;
	return raw;

}

function wipeParamsFromV1( w, invert ) {

	return {
		direction: TEXTANIM_WIPE_DIRS.includes( w && w.direction ) ? w.direction : 'ltr',
		soft: num( w && w.soft, 0.12 ),
		edgeIntensity: num( w && w.edgeIntensity, 2.5 ),
		edgeWidth: num( w && w.edgeWidth, 0.04 ),
		blendMode: ( w && [ 'normal', 'add', 'screen', 'multiply', 'multi' ].includes( w.blendMode ) )
			? ( w.blendMode === 'multi' ? 'multiply' : w.blendMode )
			: 'normal',
		invert: invert === true,
	};

}

function pushMigrated( anim, type, opts ) {

	const desc = getTextAnimDescriptor( type );
	if ( ! desc ) return null;
	const comp = createTextAnimInstance( anim, type, opts );
	normalizeComponentInPlace( comp );
	anim.components.push( comp );
	return comp;

}

/**
 * v1 →v2. `in` always becomes charIn (v1 applied it unconditionally);
 * `out` only when it was actually edited, so untouched docs do not gain an
 * exit animation they never used.
 */
export function migrateV1( raw ) {

	const anim = createDefaultTextAnim();
	anim.enabled = !! ( raw && raw.enabled );
	anim.legacy = deepClone( raw );
	anim.legacyRepaired = true;

	const inPhase = ( raw && raw.in && typeof raw.in === 'object' ) ? raw.in : null;
	const outPhase = ( raw && raw.out && typeof raw.out === 'object' ) ? raw.out : null;
	const inDur = Math.max( 0.01, num( inPhase && inPhase.duration, 1 ) );
	const outDur = Math.max( 0.01, num( outPhase && outPhase.duration, 1 ) );

	if ( inPhase ) {

		const st = inPhase.stagger || {};
		const ease = TEXTANIM_EASES.includes( inPhase.ease ) ? inPhase.ease : 'cubicOut';
		const selector = {
			order: TEXTANIM_ORDERS.includes( st.order ) ? st.order : 'ltr',
			delay: 1 - clamp01( num( st.overlap, 0.65 ) ),
			ease,
			seed: Math.floor( num( st.seed, 1 ) ) || 1,
		};

		pushMigrated( anim, 'charIn', {
			time: { start: 0, duration: inDur, loop: 'clamp' },
			params: {
				opacity: v1Pair( inPhase, 'opacity', 0, 1 ),
				offsetX: v1Pair( inPhase, 'offsetX', 0, 0 ),
				offsetY: v1Pair( inPhase, 'offsetY', - 36, 0 ),
				scale: v1Pair( inPhase, 'scale', 0.55, 1 ),
				rotateZ: v1Pair( inPhase, 'rotateZ', - 0.35, 0 ),
			},
			selector,
		} );

		const wave = v1Modulator( inPhase, 'wave' );
		if ( wave && wave.enabled ) {

			pushMigrated( anim, 'wave', {
				time: { start: 0, duration: inDur, loop: 'infinite' },
				params: {
					amp: num( wave.amp, 12 ),
					freq: num( wave.freq, 1.25 ),
					// v1 folded spatial + temporal frequency together: speed = freq.
					speed: num( wave.freq, 1.25 ),
					phase: num( wave.phase, 0 ),
				},
				selector: { order: selector.order, delay: 0, ease: 'linear', seed: selector.seed },
			} );

		}

		const bend = v1Modulator( inPhase, 'bend' );
		if ( bend && bend.enabled ) {

			pushMigrated( anim, 'bend', {
				time: { start: 0, duration: inDur, loop: 'clamp' },
				params: { bendX: 0, bendY: num( bend.amount, 0.35 ), centerX: 0.5, centerY: 0.5 },
				selector: { order: selector.order, delay: 0, ease, seed: selector.seed },
			} );

		}

		const wp = v1Modulator( inPhase, 'wipeReveal' );
		if ( wp && wp.enabled ) {

			pushMigrated( anim, 'wipeReveal', {
				time: { start: 0, duration: inDur, loop: 'clamp' },
				params: wipeParamsFromV1( wp, false ),
				// v1 forced rest pose + opacity 1 while the sweep was on.
				suppressCharPose: false,
			} );

		}

	}

	if ( outPhase && ! v1PhaseIsDefault( outPhase, 'out' ) ) {

		const st = outPhase.stagger || {};
		const ease = TEXTANIM_EASES.includes( outPhase.ease ) ? outPhase.ease : 'cubicOut';
		pushMigrated( anim, 'charOut', {
			time: { start: inPhase ? inDur : 0, duration: outDur, loop: 'clamp' },
			params: {
				opacity: v1Pair( outPhase, 'opacity', 1, 0 ),
				offsetX: v1Pair( outPhase, 'offsetX', 0, 0 ),
				offsetY: v1Pair( outPhase, 'offsetY', 36, 0 ),
				scale: v1Pair( outPhase, 'scale', 1, 0.55 ),
				rotateZ: v1Pair( outPhase, 'rotateZ', 0.35, 0 ),
			},
			selector: {
				order: TEXTANIM_ORDERS.includes( st.order ) ? st.order : 'ltr',
				delay: 1 - clamp01( num( st.overlap, 0.65 ) ),
				ease,
				seed: Math.floor( num( st.seed, 1 ) ) || 1,
			},
		} );

	}

	// ---- out-phase modulators (v1 allowed them on both phases) ----
	const outWave = v1Modulator( outPhase, 'wave' );
	if ( outWave && outWave.enabled ) {

		pushMigrated( anim, 'wave', {
			time: { start: inPhase ? inDur : 0, duration: outDur, loop: 'infinite' },
			params: {
				amp: num( outWave.amp, 12 ),
				freq: num( outWave.freq, 1.25 ),
				speed: num( outWave.freq, 1.25 ),
				phase: num( outWave.phase, 0 ),
			},
			selector: { order: 'ltr', delay: 0, ease: 'linear', seed: 1 },
		} );

	}

	const outBend = v1Modulator( outPhase, 'bend' );
	if ( outBend && outBend.enabled ) {

		pushMigrated( anim, 'bend', {
			time: { start: inPhase ? inDur : 0, duration: outDur, loop: 'clamp' },
			params: { bendX: 0, bendY: num( outBend.amount, 0.35 ), centerX: 0.5, centerY: 0.5 },
			selector: { order: 'ltr', delay: 0, ease: 'linear', seed: 1 },
		} );

	}

	const outWipe = v1Modulator( outPhase, 'wipeReveal' );
	if ( outWipe && outWipe.enabled ) {

		// Exit sweep: v1 played it forward on the out phase, which reads as a
		// reveal of emptiness →v2 models that as an inverted wipe.
		pushMigrated( anim, 'wipeReveal', {
			time: { start: inPhase ? inDur : 0, duration: outDur, loop: 'clamp' },
			params: wipeParamsFromV1( outWipe, true ),
			suppressCharPose: false,
		} );

	}

	return anim;

}

/**
 * A v2 document that was produced by an earlier (buggy) migration can be
 * missing a sweep that v1 had. `legacy` still holds the original, so put back
 * any effect that is present there but absent from `components`.
 * Runs at most once per document (guarded by `legacyRepaired`).
 */
export function repairFromLegacy( anim ) {

	if ( ! anim || ! isComponentFormat( anim.format ) ) return anim;
	if ( anim.legacyRepaired ) return anim;
	anim.legacyRepaired = true;

	const leg = anim.legacy;
	if ( ! leg || typeof leg !== 'object' ) return anim;
	if ( ! Array.isArray( anim.components ) ) anim.components = [];

	const has = ( type ) => anim.components.some( ( c ) => c && c.type === type );
	const inPhase = ( leg.in && typeof leg.in === 'object' ) ? leg.in : null;
	const outPhase = ( leg.out && typeof leg.out === 'object' ) ? leg.out : null;
	const inDur = Math.max( 0.01, num( inPhase && inPhase.duration, 1 ) );
	const outDur = Math.max( 0.01, num( outPhase && outPhase.duration, 1 ) );
	const added = [];

	if ( ! has( 'wipeReveal' ) ) {

		const w = v1Modulator( inPhase, 'wipeReveal' );
		if ( w && w.enabled ) {

			pushMigrated( anim, 'wipeReveal', {
				time: { start: 0, duration: inDur, loop: 'clamp' },
				params: wipeParamsFromV1( w, false ),
				suppressCharPose: false,
			} );
			added.push( 'wipeReveal' );

		} else {

			const wo = v1Modulator( outPhase, 'wipeReveal' );
			if ( wo && wo.enabled ) {

				pushMigrated( anim, 'wipeReveal', {
					time: { start: inDur, duration: outDur, loop: 'clamp' },
					params: wipeParamsFromV1( wo, true ),
					suppressCharPose: false,
				} );
				added.push( 'wipeReveal(out)' );

			}

		}

	}

	if ( ! has( 'wave' ) ) {

		const w = v1Modulator( inPhase, 'wave' );
		if ( w && w.enabled ) {

			pushMigrated( anim, 'wave', {
				time: { start: 0, duration: inDur, loop: 'infinite' },
				params: {
					amp: num( w.amp, 12 ),
					freq: num( w.freq, 1.25 ),
					speed: num( w.freq, 1.25 ),
					phase: num( w.phase, 0 ),
				},
				selector: { order: 'ltr', delay: 0, ease: 'linear', seed: 1 },
			} );
			added.push( 'wave' );

		}

	}

	if ( ! has( 'bend' ) ) {

		const b = v1Modulator( inPhase, 'bend' );
		if ( b && b.enabled ) {

			pushMigrated( anim, 'bend', {
				time: { start: 0, duration: inDur, loop: 'clamp' },
				params: { bendX: 0, bendY: num( b.amount, 0.35 ), centerX: 0.5, centerY: 0.5 },
				selector: { order: 'ltr', delay: 0, ease: 'linear', seed: 1 },
			} );
			added.push( 'bend' );

		}

	}

	if ( added.length ) {

		console.log( '[textanim] repaired from legacy:', added.join( ', ' ) );

	}
	return anim;

}

// ---------------------------------------------------------------- entry


/**
 * Stable-partition: char-scope first (stack among themselves), text-scope
 * last (wipe/blur always composite after per-char poses). Mutates `anim.components`.
 * @param {object} anim
 */
export function orderTextAnimComponents( anim ) {

	if ( ! anim || ! Array.isArray( anim.components ) || anim.components.length < 2 ) return anim;

	const chars = [];
	const texts = [];
	for ( let i = 0; i < anim.components.length; i ++ ) {

		const c = anim.components[ i ];
		const desc = c ? getTextAnimDescriptor( c.type ) : null;
		if ( desc && desc.scope === 'text' ) texts.push( c );
		else chars.push( c );

	}
	if ( ! texts.length || ! chars.length ) return anim;
	anim.components.length = 0;
	for ( let i = 0; i < chars.length; i ++ ) anim.components.push( chars[ i ] );
	for ( let i = 0; i < texts.length; i ++ ) anim.components.push( texts[ i ] );
	return anim;

}

export function normalizeTextAnim( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return createDefaultTextAnim();

	if ( isComponentFormat( raw.format ) && Array.isArray( raw.components ) ) {

		const anim = {
			format: TEXTANIM_FORMAT,
			enabled: !! raw.enabled,
			components: [],
			legacy: raw.legacy != null ? raw.legacy : null,
			legacyRepaired: raw.legacyRepaired === true,
		};
		if ( raw.legacyTimes && typeof raw.legacyTimes === 'object' ) anim.legacyTimes = deepClone( raw.legacyTimes );
		for ( const c of raw.components ) {

			const comp = normalizeComponentInPlace( deepClone( c ) );
			if ( comp ) anim.components.push( comp );

		}
		orderTextAnimComponents( anim );
		repairFromLegacy( anim );
		return anim;

	}

	// v1 doc, or a v2 doc whose components array got lost →still migrate-able.
	if ( raw.format === TEXTANIM_FORMAT_V1 || raw.in || raw.out ) {

		return migrateV1( raw );

	}

	return createDefaultTextAnim();

}

/**
 * Ensure `ui.textAnim` is a valid v2 document WITHOUT swapping object identity
 * on every call (the sidebar binds to live component objects).
 */
export function ensureTextAnimOnUI( ui ) {

	if ( ! ui || typeof ui !== 'object' ) return createDefaultTextAnim();

	if ( ! ui.textAnim || typeof ui.textAnim !== 'object' ) {

		ui.textAnim = createDefaultTextAnim();
		return ui.textAnim;

	}

	const raw = ui.textAnim;

	if ( ! isComponentFormat( raw.format ) || ! Array.isArray( raw.components ) ) {

		// v1 (or corrupt) —migrate once, keep the original under `legacy`.
		ui.textAnim = normalizeTextAnim( raw );
		return ui.textAnim;

	}

	raw.format = TEXTANIM_FORMAT;
	raw.enabled = !! raw.enabled;
	if ( ! Array.isArray( raw.components ) ) raw.components = [];
	for ( let i = raw.components.length - 1; i >= 0; i -- ) {

		if ( ! normalizeComponentInPlace( raw.components[ i ] ) ) raw.components.splice( i, 1 );

	}
	repairFromLegacy( raw );
	orderTextAnimComponents( raw );

	return raw;

}

export function getTextAnimComponents( anim ) {

	return ( anim && Array.isArray( anim.components ) ) ? anim.components : [];

}
