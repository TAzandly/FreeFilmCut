/**
 * Editor mirror of OpenCut text-layer-aabb (pad formula + hysteresis).
 * Overlay TextFx preview uses this; SS-camera full-scene composer stays project-sized.
 */

const BASE_AA_PAD = 8;
export const TEXT_LAYER_RT_SIZE_HYSTERESIS = 1.35;

export function bloomPadPxFromStack( input ) {

	const base = Math.max( 0, Math.round( input.basePadPx != null ? input.basePadPx : BASE_AA_PAD ) );
	const stack = input.stack;
	const canvasMax = Math.max( 1, input.canvasW, input.canvasH );
	const inkMax = Math.max( 1, input.inkMaxSide );
	let bloomPad = 0;
	if ( ! stack || stack.enabled === false ) return base;
	const effects = stack.effects || [];
	for ( let i = 0; i < effects.length; i ++ ) {

		const entry = effects[ i ];
		if ( ! entry || entry.enabled === false ) continue;
		const params = entry.params || {};
		if ( entry.type === 'bloom' ) {

			const strength = Math.max( 0, Number( params.strength ) || 0 );
			const radius = Math.max( 0, Number( params.radius ) || 0 );
			if ( strength < 1e-4 ) continue;
			bloomPad = Math.max(
				bloomPad,
				unrealBloomHaloPadPx( strength, radius, canvasMax, inkMax )
			);

		} else if ( entry.type === 'deepGlow' ) {

			const intensity = Math.max( 0, Number( params.intensity ) || 0 );
			const radius = Math.max( 0, Number( params.radius ) || 0 );
			if ( intensity < 1e-4 ) continue;
			bloomPad = Math.max(
				bloomPad,
				radius * 64 + 32,
				48 * Math.min( 2, intensity + 0.35 ),
				0.06 * canvasMax
			);

		}

	}
	return Math.max( base, Math.ceil( bloomPad ) );

}

/**
 * UnrealBloomPass pad in project pixels (1:1 PP density).
 * `radius` is a 0..1 mip-weight lerp, NOT pixels — see OpenCut text-layer-aabb.ts.
 */
function unrealBloomHaloPadPx( strength, radius, canvasMax, inkMax ) {

	const s = Math.max( 0, strength );
	const t = Math.min( 1, Math.max( 0, radius ) );
	const r0 = 12;
	const r1 = 40;
	const r2 = 112;
	const r3 = 288;
	const r4 = Math.min( 704, canvasMax * 0.45 );
	const reachCore = 0.5 * r0 + 0.35 * r1 + 0.15 * r2;
	const reachOuter = 0.25 * r1 + 0.35 * r2 + 0.25 * r3 + 0.15 * r4;
	const reach = ( 1 - t ) * reachCore + t * reachOuter;
	const sMul = Math.min( 2.75, 0.75 + s * 1.25 );
	let pad = reach * sMul;
	pad = Math.max( pad, 64, 0.08 * canvasMax, Math.min( 0.22 * canvasMax, 0.45 * inkMax * Math.min( 1.4, s + 0.55 ) ) );
	pad = Math.min( pad, 0.48 * canvasMax );
	return pad;

}

export function padAndClampTextLayerAabb( ink, padPx, canvasW, canvasH ) {

	const pad = Math.max( 0, Math.ceil( padPx ) );
	const cw = Math.max( 1, Math.round( canvasW ) );
	const ch = Math.max( 1, Math.round( canvasH ) );
	let x = Math.floor( ink.x - pad );
	let y = Math.floor( ink.y - pad );
	let r = Math.ceil( ink.x + ink.w + pad );
	let t = Math.ceil( ink.y + ink.h + pad );
	x = Math.max( 0, Math.min( x, cw - 1 ) );
	y = Math.max( 0, Math.min( y, ch - 1 ) );
	r = Math.max( x + 1, Math.min( r, cw ) );
	t = Math.max( y + 1, Math.min( t, ch ) );
	return { x: x, y: y, w: r - x, h: t - y };

}

export function shouldReuseTextLayerRtSize( prevW, prevH, needW, needH, hysteresis ) {

	const hys = hysteresis != null ? hysteresis : TEXT_LAYER_RT_SIZE_HYSTERESIS;
	const pw = Math.max( 1, Math.round( prevW ) );
	const ph = Math.max( 1, Math.round( prevH ) );
	const nw = Math.max( 1, Math.round( needW ) );
	const nh = Math.max( 1, Math.round( needH ) );
	if ( pw < nw || ph < nh ) return false;
	if ( pw > nw * hys || ph > nh * hys ) return false;
	return true;

}

export function mapAabbToDestRect( aabb, authoredW, authoredH, destW, destH ) {

	const sx = Math.max( 1, destW ) / Math.max( 1, authoredW );
	const sy = Math.max( 1, destH ) / Math.max( 1, authoredH );
	return {
		x: aabb.x * sx,
		y: aabb.y * sy,
		w: Math.max( 1, aabb.w * sx ),
		h: Math.max( 1, aabb.h * sy ),
	};

}
