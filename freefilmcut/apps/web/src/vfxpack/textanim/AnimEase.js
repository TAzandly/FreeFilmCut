/**
 * Per-key easing presets for .anim (freecapcut.anim/2). A key's `ease` shapes
 * the segment from that key to the next one. Keep the list in sync with the
 * NLE player (sub-project 3).
 */

export const ANIM_EASES = [ 'linear', 'easeIn', 'easeOut', 'easeInOut', 'back', 'elastic', 'bounce', 'step' ];

export const ANIM_EASE_LABELS_ZH = {
	linear: '线性',
	easeIn: '缓入',
	easeOut: '缓出',
	easeInOut: '缓入缓出',
	back: '回弹',
	elastic: '弹性',
	bounce: '弹跳',
	step: '阶跃',
};

export function isAnimEase( name ) {

	return ANIM_EASES.includes( name );

}

function bounceOut( u ) {

	const n1 = 7.5625;
	const d1 = 2.75;
	if ( u < 1 / d1 ) return n1 * u * u;
	if ( u < 2 / d1 ) {

		u -= 1.5 / d1;
		return n1 * u * u + 0.75;

	}
	if ( u < 2.5 / d1 ) {

		u -= 2.25 / d1;
		return n1 * u * u + 0.9375;

	}
	u -= 2.625 / d1;
	return n1 * u * u + 0.984375;

}

/** @param {string} name @param {number} u segment fraction 0..1 */
export function applyAnimEase( name, u ) {

	const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
	switch ( name ) {

		case 'easeIn': return x * x * x;
		case 'easeOut': return 1 - Math.pow( 1 - x, 3 );
		case 'easeInOut': return x < 0.5 ? 4 * x * x * x : 1 - Math.pow( - 2 * x + 2, 3 ) / 2;
		case 'back': {

			const c1 = 1.70158;
			const c3 = c1 + 1;
			return 1 + c3 * Math.pow( x - 1, 3 ) + c1 * Math.pow( x - 1, 2 );

		}
		case 'elastic': {

			if ( x === 0 || x === 1 ) return x;
			return Math.pow( 2, - 10 * x ) * Math.sin( ( x * 10 - 0.75 ) * ( 2 * Math.PI / 3 ) ) + 1;

		}
		case 'bounce': return bounceOut( x );
		case 'step': return x >= 1 ? 1 : 0;
		default: return x;

	}

}
