/**
 * FreeFilmCut textanim/2 — component registry.
 *
 * A component is a declarative descriptor:
 *   scope      'char' → per-glyph pose channels; 'text' → render pass op (wipe/blur/…)
 *   channels   which pose channels it MAY write (instance keeps an on/off table)
 *   params     schema for UI + defaults; every param is a plain number/select/bool/color/[a,b]
 *   sample     pure fn ( ctx, pose ) → mutates pose. Must NOT allocate THREE objects.
 *   resolvePass pure fn ( ctx ) → pass op for text-scope components.
 *
 * Hard rules (docs/textanim-v2-plan.md §0):
 *   - descriptors are stateless: no per-object closure, never touch userData
 *   - instances are pure JSON (auto-save must be structured-clone safe)
 */

const descriptors = new Map();

export const TEXTANIM_SCOPES = [ 'char', 'text' ];
export const TEXTANIM_GROUPS = [ 'transform', 'motion', 'look', 'reveal' ];

function assert( cond, msg ) {

	if ( ! cond ) throw new Error( '[textanim] ' + msg );

}

/**
 * @param {string} type unique id used in documents ("wave", "wipeReveal", …)
 * @param {object} descriptor
 */
export function registerTextAnim( type, descriptor ) {

	assert( typeof type === 'string' && type.length > 0, 'registerTextAnim: type required' );
	assert( descriptor && typeof descriptor === 'object', 'registerTextAnim(' + type + '): descriptor required' );

	const scope = descriptor.scope === 'text' ? 'text' : 'char';
	const params = ( descriptor.params && typeof descriptor.params === 'object' ) ? descriptor.params : {};

	const d = {
		type,
		label: descriptor.label || type,
		labelZh: descriptor.labelZh || descriptor.label || type,
		scope,
		group: TEXTANIM_GROUPS.includes( descriptor.group )
			? descriptor.group
			: ( scope === 'text' ? 'reveal' : 'motion' ),
		channels: Array.isArray( descriptor.channels ) ? descriptor.channels.slice() : [],
		// Which channels are ON for a brand-new instance (default: all of them).
		defaultChannels: ( descriptor.defaultChannels && typeof descriptor.defaultChannels === 'object' )
			? Object.assign( {}, descriptor.defaultChannels )
			: null,
		// char components get a selector (per-char range / order / stagger).
		selector: scope === 'char' && descriptor.selector !== false,
		defaultDuration: Number( descriptor.defaultDuration ) > 0 ? Number( descriptor.defaultDuration ) : 1,
		defaultLoop: descriptor.defaultLoop || ( scope === 'text' ? 'clamp' : 'clamp' ),
		params,
		sample: typeof descriptor.sample === 'function' ? descriptor.sample : null,
		resolvePass: typeof descriptor.resolvePass === 'function' ? descriptor.resolvePass : null,
		hint: descriptor.hint || '',
		hintZh: descriptor.hintZh || descriptor.hint || '',
	};

	assert( scope !== 'char' || d.sample, 'registerTextAnim(' + type + '): char scope needs sample()' );
	assert( scope !== 'text' || d.resolvePass, 'registerTextAnim(' + type + '): text scope needs resolvePass()' );

	if ( descriptors.has( type ) ) {

		console.warn( '[textanim] duplicate component type, overwriting:', type );

	}

	descriptors.set( type, d );
	return d;

}

export function getTextAnimDescriptor( type ) {

	return descriptors.get( type ) || null;

}

export function hasTextAnim( type ) {

	return descriptors.has( type );

}

/** @returns {object[]} descriptors, stable registration order */
export function listTextAnims( scope ) {

	const out = [];
	for ( const d of descriptors.values() ) {

		if ( scope && d.scope !== scope ) continue;
		out.push( d );

	}

	return out;

}

/** Server both scopes grouped for the "add" dropdown. */
export function listTextAnimsGrouped() {

	return {
		char: listTextAnims( 'char' ),
		text: listTextAnims( 'text' ),
	};

}

export function paramDefault( def ) {

	if ( ! def || typeof def !== 'object' ) return 0;
	switch ( def.type ) {

		case 'pair': {

			const arr = Array.isArray( def.default ) ? def.default : [ 0, 1 ];
			return [ Number( arr[ 0 ] ) || 0, Number( arr[ 1 ] ) || 0 ];

		}
		case 'select': {

			const opts = Array.isArray( def.options ) ? def.options : Object.keys( def.options || {} );
			return def.default != null ? def.default : ( opts[ 0 ] != null ? opts[ 0 ] : '' );

		}
		case 'bool':
			return !! def.default;
		case 'color':
			return def.default != null ? def.default : '#ffffff';
		case 'number':
		default:
			return Number.isFinite( Number( def.default ) ) ? Number( def.default ) : 0;

	}

}

export function cloneParams( descriptor ) {

	const out = {};
	const params = descriptor && descriptor.params ? descriptor.params : {};
	for ( const key of Object.keys( params ) ) {

		const v = paramDefault( params[ key ] );
		out[ key ] = Array.isArray( v ) ? v.slice() : v;

	}

	return out;

}

/** Human readable component id: c_wave_1, c_wave_2, … (k-frame paths use it). */
export function makeComponentId( anim, type ) {

	const list = ( anim && Array.isArray( anim.components ) ) ? anim.components : [];
	const prefix = 'c_' + type + '_';
	let max = 0;
	for ( const c of list ) {

		if ( ! c || typeof c.id !== 'string' || ! c.id.startsWith( prefix ) ) continue;
		const n = Number( c.id.slice( prefix.length ) );
		if ( Number.isFinite( n ) && n > max ) max = n;

	}

	return prefix + ( max + 1 );

}

/** Default selector — the v2 replacement for v1 `stagger`. */
export function defaultSelector( overrides ) {

	const base = {
		unit: 'char',
		order: 'ltr',
		start: 0,
		end: 1,
		amount: 1,
		// 0 = all chars together, 1 = fully serialized (= 1 - v1 overlap).
		delay: 0.35,
		ease: 'cubicOut',
		seed: 1,
	};
	return overrides ? Object.assign( base, overrides ) : base;

}

/**
 * Build a fresh component instance (pure JSON).
 * @param {object} anim owning anim (for unique ids)
 * @param {string} type descriptor type
 * @param {object} [overrides] partial instance fields
 */
export function createTextAnimInstance( anim, type, overrides ) {

	const d = getTextAnimDescriptor( type );
	if ( ! d ) throw new Error( '[textanim] unknown component type: ' + type );

	const o = overrides || {};
	const comp = {
		id: o.id || makeComponentId( anim, type ),
		type,
		scope: d.scope,
		enabled: o.enabled !== false,
		time: Object.assign(
			{
				start: 0,
				duration: d.defaultDuration,
				loop: d.defaultLoop,
				timeScale: 1,
			},
			o.time || {},
		),
		channels: {},
		params: Object.assign( cloneParams( d ), o.params || {} ),
		selector: d.selector ? defaultSelector( o.selector ) : null,
	};

	for ( const ch of d.channels ) {

		if ( o.channels && o.channels[ ch ] !== undefined ) {

			comp.channels[ ch ] = o.channels[ ch ] !== false;

		} else if ( d.defaultChannels ) {

			comp.channels[ ch ] = d.defaultChannels[ ch ] === true;

		} else {

			comp.channels[ ch ] = true;

		}

	}

	return comp;

}
