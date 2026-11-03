/**
 * Text animation — public facade (textanim v3).
 *
 * All real work now lives in js/textanim/:
 *   TextAnimTypes.js     schema / normalize / v1→v2 migration
 *   TextAnimRegistry.js  component descriptors (add an effect = one file)
 *   TextAnimBuiltins.js  first-party components
 *   TextAnimEngine.js    per-frame sampling (char poses + text pass ops)
 *
 * This module is kept as the stable import point for Viewport / TextAnimRuntime
 * / the sidebar, so call sites do not churn while the data model changes.
 */

import {
	TEXTANIM_FORMAT,
	TEXTANIM_FORMAT_V1,
	TEXTANIM_EASES,
	TEXTANIM_ORDERS,
	TEXTANIM_WIPE_DIRS,
	TEXTANIM_LOOPS,
	easeSample,
	createDefaultTextAnim,
	normalizeTextAnim,
	ensureTextAnimOnUI,
	orderTextAnimComponents,
} from '../textanim/TextAnimTypes.js?v=fcc-tanim-24';

import {
	sampleTextAnim,
	sampleTextPassOps,
	findPassOp,
	textAnimNeedsCharSplit,
} from '../textanim/TextAnimEngine.js?v=fcc-tanim-24';

export { TEXTANIM_FORMAT, TEXTANIM_FORMAT_V1 };
export { TEXTANIM_EASES, TEXTANIM_ORDERS, TEXTANIM_WIPE_DIRS, TEXTANIM_LOOPS };
export { easeSample, createDefaultTextAnim, normalizeTextAnim, ensureTextAnimOnUI, orderTextAnimComponents };
export { sampleTextAnim, sampleTextPassOps, textAnimNeedsCharSplit };

/**
 * Wipe pass params for TextGeomFx (v1 shape); the value comes from a
 * `wipeReveal` text-scope component.
 *
 * @param {object} anim fccUI.textAnim
 * @param {{ time?: number, values?: Map<string, number>|null }} [opts] TextAnimOverrides sample
 */
export function sampleWipeRevealProgress( anim, opts ) {

	if ( ! anim || ! anim.enabled ) {

		return { enabled: false, progress: 1, direction: 'ltr', soft: 0.12, edgeIntensity: 0, edgeWidth: 0.04, fillDim: 1, fillRange: 0.12, fillPower: 2.5, blendMode: 'normal' };

	}

	const op = findPassOp( sampleTextPassOps( anim, opts ), 'wipe' );
	if ( ! op ) {

		return { enabled: false, progress: 1, direction: 'ltr', soft: 0.12, edgeIntensity: 0, edgeWidth: 0.04, fillDim: 1, fillRange: 0.12, fillPower: 2.5, blendMode: 'normal' };

	}

	return {
		enabled: true,
		progress: op.progress,
		direction: op.direction,
		soft: op.soft,
		edgeIntensity: op.edgeIntensity,
		edgeWidth: op.edgeWidth,
		fillDim: op.fillDim,
		fillRange: op.fillRange,
		fillPower: op.fillPower,
		blendMode: op.blendMode || 'normal',
		componentId: op.componentId || '',
	};

}


/**
 * Whole-text bend pass params for TextGeomFx.
 * @param {object} anim
 * @param {{ time?: number, values?: Map<string, number>|null }} [opts]
 */
export function sampleBendProgress( anim, opts ) {

	if ( ! anim || ! anim.enabled ) {

		return { enabled: false, progress: 0, bendX: 0, bendY: 0, rotateZ: 0, centerX: 0.5, centerY: 0.5 };

	}

	const op = findPassOp( sampleTextPassOps( anim, opts ), 'bend' );
	if ( ! op ) {

		return { enabled: false, progress: 0, bendX: 0, bendY: 0, rotateZ: 0, centerX: 0.5, centerY: 0.5 };

	}

	return {
		enabled: true,
		progress: op.progress,
		bendX: op.bendX,
		bendY: op.bendY,
		rotateZ: op.rotateZ || 0,
		centerX: op.centerX,
		centerY: op.centerY,
		componentId: op.componentId || '',
	};

}

/** @deprecated v1 concept —kept so older call sites do not crash. */
export function getActivePhase( anim ) {

	return ( anim && anim.components && anim.components[ 0 ] ) ? anim.components[ 0 ] : createDefaultTextAnim();

}

// ---------------------------------------------------------------------------
// Legacy v1 sampling helpers.
// Only kept for external scripts that imported them; the editor runtime uses
// TextAnimEngine now. Safe to delete once no saved Script nodes reference them.
// ---------------------------------------------------------------------------

export function buildCharOrder( count, order, seed ) {

	const n = Math.max( 0, count | 0 );
	const idx = [];
	for ( let i = 0; i < n; i ++ ) idx.push( i );
	if ( order === 'rtl' ) idx.reverse();
	else if ( order === 'random' ) {

		let a = ( seed || 1 ) >>> 0;
		const rnd = function () {

			a |= 0;
			a = ( a + 0x6D2B79F5 ) | 0;
			let t = Math.imul( a ^ ( a >>> 15 ), 1 | a );
			t = ( t + Math.imul( t ^ ( t >>> 7 ), 61 | t ) ) ^ t;
			return ( ( t ^ ( t >>> 14 ) ) >>> 0 ) / 4294967296;

		};
		for ( let i = n - 1; i > 0; i -- ) {

			const j = Math.floor( rnd() * ( i + 1 ) );
			const tmp = idx[ i ];
			idx[ i ] = idx[ j ];
			idx[ j ] = tmp;

		}

	}
	return idx;

}

export function sampleWipeAxisMask( progress, soft, axis01 ) {

	const p = Math.max( 0, Math.min( 1, progress ) );
	const a = Math.max( 0, Math.min( 1, axis01 ) );
	const s = Math.max( 1e-4, soft != null ? soft : 0.12 );
	const pExp = p * ( 1 + 2 * s ) - s;
	const e0 = a - s;
	const e1 = a + s;
	const t = Math.max( 0, Math.min( 1, ( pExp - e0 ) / ( e1 - e0 ) ) );
	return t * t * ( 3 - 2 * t );

}

export function wipeAxisForChar( direction, base, minX, maxX, minY, maxY ) {

	const dx = Math.max( 1e-4, maxX - minX );
	const dy = Math.max( 1e-4, maxY - minY );
	const u = ( base.x - minX ) / dx;
	const v = ( base.y - minY ) / dy;
	switch ( direction ) {

		case 'rtl': return 1 - u;
		case 'ttb': return 1 - v;
		case 'btt': return v;
		case 'ltr':
		default: return u;

	}

}
