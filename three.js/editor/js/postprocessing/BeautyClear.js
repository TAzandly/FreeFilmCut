/**
 * Scene beauty-buffer clear for FreeFilmCut Editor.
 *
 * Default background => transparent clear (alpha 0).
 * Color / Texture / Equirect => opaque clear (alpha 1); scene.background still draws.
 * Letterbox bars use a separate opaque chrome clear — not the beauty alpha.
 */

import * as THREE from 'three';

export function isTransparentBackground( editor ) {

	if ( ! editor ) return false;
	const t = editor.backgroundType;
	if ( t === 'Default' || t === 'default' || ! t ) return true;
	return false;

}

/**
 * Clear color/alpha for the camera beauty / EffectComposer RenderPass.
 * Call immediately before composer.render() or scene beauty render.
 */
export function applyBeautyClear( renderer, editor ) {

	if ( ! renderer ) return;
	if ( isTransparentBackground( editor ) ) {

		renderer.setClearColor( 0x000000, 0 );

	} else {

		const c = editor && editor.viewportColor;
		if ( c && c.isColor ) renderer.setClearColor( c, 1 );
		else renderer.setClearColor( 0x000000, 1 );

	}

}

/** Opaque dark clear for full-canvas letterbox bars (UI chrome only). */
export function applyLetterboxChromeClear( renderer ) {

	if ( ! renderer ) return;
	renderer.setClearColor( 0x111111, 1 );

}

export function beautyClearAlpha( editor ) {

	return isTransparentBackground( editor ) ? 0 : 1;

}
