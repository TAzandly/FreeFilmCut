/**
 * FreeFilmCut — unified post-effect registry (camera PP + Text Fx share this set).
 *
 * registerEffect( type, descriptor ) where descriptor:
 *   label, labelZh?,
 *   inputs?: ('camera'|'texture')[]  — default both; filters listEffectDescriptors
 *   createDefaultParams(), createPasses( ctx ), applyParams?( passes, params ),
 *   paramSchema?: [...]
 *
 * ctx = { THREE, width, height, scene?, camera?, renderer?, input: 'camera'|'texture' }
 *
 * Camera stack: camera.userData.postProcessStack
 * Text stack:   fccUI.textFxStack  (same { enabled, effects[] } shape)
 * Per-text FX must NOT be written into camera.postProcessStack.
 */

const registry = new Map();

export function registerEffect( type, descriptor ) {

	const inputs = Array.isArray( descriptor.inputs ) && descriptor.inputs.length
		? descriptor.inputs.slice()
		: [ 'camera', 'texture' ];
	registry.set( type, { type, ...descriptor, inputs } );

}

/** Remove a registered effect (used by the custom-effect runtime). */
export function unregisterEffect( type ) {

	registry.delete( type );

}

export function getEffectDescriptor( type ) {

	return registry.get( type ) || null;

}

export function listEffectTypes( filter ) {

	return listEffectDescriptors( filter ).map( ( d ) => d.type );

}

/**
 * @param {{ input?: 'camera'|'texture' }} [filter]
 */
export function listEffectDescriptors( filter ) {

	const input = filter && filter.input;
	const all = Array.from( registry.values() );
	if ( ! input ) return all;
	return all.filter( ( d ) => ! d.inputs || d.inputs.indexOf( input ) !== - 1 );

}

export function createDefaultEffectEntry( type ) {

	const desc = registry.get( type );
	if ( ! desc ) return null;
	return {
		id: ( typeof crypto !== 'undefined' && crypto.randomUUID )
			? crypto.randomUUID()
			: ( 'pp_' + Math.random().toString( 36 ).slice( 2, 10 ) ),
		type,
		enabled: true,
		params: desc.createDefaultParams(),
	};

}

/** Normalize { enabled, effects[] }. */
export function normalizeEffectStack( stack ) {

	if ( ! stack || typeof stack !== 'object' ) {

		return { enabled: true, effects: [] };

	}

	if ( ! Array.isArray( stack.effects ) ) stack.effects = [];
	if ( typeof stack.enabled !== 'boolean' ) stack.enabled = true;
	return stack;

}

/** Ensure camera.userData.postProcessStack exists and is well-formed. */
export function ensureStackOnCamera( camera ) {

	if ( ! camera.userData ) camera.userData = {};
	let stack = camera.userData.postProcessStack;
	if ( ! stack || typeof stack !== 'object' ) {

		stack = { enabled: true, effects: [] };
		camera.userData.postProcessStack = stack;

	}

	return normalizeEffectStack( stack );

}

/**
 * Ensure Text Fx stack on fccUI (same shape as camera postProcessStack).
 * @param {object} ui fccUI plain object (type === 'text')
 */
export function ensureTextFxStack( ui ) {

	if ( ! ui || typeof ui !== 'object' ) return { enabled: true, effects: [] };
	if ( ! ui.textFxStack || typeof ui.textFxStack !== 'object' ) {

		ui.textFxStack = { enabled: true, effects: [] };

	}

	return normalizeEffectStack( ui.textFxStack );

}

/** True if stack has at least one enabled registered effect. */
export function stackDataHasEnabledEffects( stack ) {

	if ( ! stack || stack.enabled === false ) return false;
	const effects = stack.effects || [];
	const hit = effects.some( ( e ) => e && e.enabled !== false && registry.has( e.type ) );
	if ( ! hit && effects.some( ( e ) => e && e.enabled !== false ) ) {
		// Usually means PostProcessRegistry.js was loaded under two different ?v= URLs
		// (split Map): builtins registered in one module instance, queried in another.
		if ( typeof console !== 'undefined' && ! stackDataHasEnabledEffects._registryMissWarned ) {
			stackDataHasEnabledEffects._registryMissWarned = true;
			console.error( '[FreeFilmCut postprocess] enabled effects present but none match the registry — check that every import of PostProcessRegistry.js / BuiltinEffects.js uses the SAME ?v= cache bust.', effects.map( ( e ) => e && e.type ), 'registry size', registry.size );
		}
	}
	return hit;

}

export function stackHasEnabledEffects( camera ) {

	const stack = camera?.userData?.postProcessStack;
	return stackDataHasEnabledEffects( stack );

}

