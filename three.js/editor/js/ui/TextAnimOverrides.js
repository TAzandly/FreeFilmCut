/**
 * Runtime values written by `.anim` tracks under `textAnim.<compId>.<field>`.
 * Import WITHOUT a ?v= query everywhere so every importer shares one WeakMap.
 *
 * `time` is the owning clip's local time — the clock for continuous
 * components (wave / jitter). Values persist until the next sample of the same
 * object, so a paused panel keeps showing the last sampled state.
 *
 * `keys` holds the raw keyframe arrays for the same paths (still without the
 * `textAnim.` prefix). charIn / charOut use them to re-sample params at each
 * character's local progress so 错开 actually staggers the keyed curve.
 */

const OVERRIDES = new WeakMap();

function ensureEntry( object ) {

	let entry = OVERRIDES.get( object );
	if ( ! entry ) {

		entry = { time: 0, values: new Map(), keys: new Map() };
		OVERRIDES.set( object, entry );

	}
	if ( ! entry.keys ) entry.keys = new Map();
	return entry;

}

/** Called once per target before its textAnim tracks are written. */
export function beginTextAnimTarget( object, time ) {

	if ( ! object ) return;
	const entry = ensureEntry( object );
	entry.time = Number.isFinite( time ) ? time : 0;
	entry.values.clear();
	entry.keys.clear();

}

/** @param {string} sub path without the `textAnim.` prefix, e.g. `c1.progress` */
export function setTextAnimOverride( object, sub, value, keys ) {

	if ( ! object || ! sub || ! Number.isFinite( value ) ) return;
	const entry = ensureEntry( object );
	entry.values.set( sub, value );
	if ( keys && keys.length ) entry.keys.set( sub, keys );

}

export function clearTextAnimOverrides( object ) {

	if ( object ) OVERRIDES.delete( object );

}

const EMPTY = { time: 0, values: null, keys: null };

/** @returns {{ time: number, values: Map<string, number>|null, keys: Map<string, object[]>|null }} */
export function getTextAnimSampleOpts( object ) {

	const entry = object ? OVERRIDES.get( object ) : null;
	return entry || EMPTY;

}
