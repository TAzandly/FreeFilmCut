/**
 * UICompositePass — feed the wiped Screen Space–Camera UI back into the
 * post-processing chain.
 *
 * Why this exists:
 *   A SS-Camera canvas is normally drawn by the beauty camera *inside*
 *   RenderPass, so every enabled effect (bloom / deepGlow / film / invert)
 *   treats it like any other scene content. That breaks as soon as a
 *   `wipeReveal` runs: the canvas has to be hidden for the beauty pass and
 *   composited from an offscreen RT instead, otherwise the un-wiped text
 *   shows through underneath the sweep.
 *
 *   Blitting that RT to the *screen* after `composer.render()` is what made
 *   the UI escape post-processing. Inserting this pass right after RenderPass
 *   (index 1, before every effect) keeps the wipe correct AND keeps the UI in
 *   the effect chain: effects now sample the composited text like scene pixels.
 *
 * Contract:
 *   - texture: the project-resolution UI RT (already wiped / TextFx'd), sRGB.
 *     Sampling auto-decodes to linear because the RT is tagged SRGBColorSpace,
 *     which matches the composer's linear HDR buffer.
 *   - Draws into readBuffer in place (needsSwap = false) so the following pass
 *     keeps reading the same target.
 *   - `enabled = false` when there is no wipe this frame: the canvas is then
 *     drawn by RenderPass itself and must not be composited twice.
 *   - MUST keep renderer.autoClear = false while drawing. RenderPass restores
 *     autoClear to the caller's value (usually true); FullScreenQuad →
 *     renderer.render() would otherwise clear readBuffer and wipe the 3D beauty
 *     before the UI quad lands — scene vanishes, only UI+PP remains.
 */

import { ShaderMaterial, NormalBlending } from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const UICompositeShader = {
	name: 'UICompositeShader',

	uniforms: {
		tUI: { value: null },
		uOpacity: { value: 1 },
	},

	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = vec4( position.xy, 0.0, 1.0 );
		}
	`,

	fragmentShader: /* glsl */`
		uniform sampler2D tUI;
		uniform float uOpacity;
		varying vec2 vUv;

		void main() {
			vec4 c = texture2D( tUI, vUv );
			// Straight alpha over whatever RenderPass left in the buffer.
			// Skip empty padding so the 3D / letterbox already there survives.
			if ( c.a < 0.001 ) discard;
			gl_FragColor = vec4( c.rgb, c.a * uOpacity );
		}
	`,
};

class UICompositePass extends Pass {

	constructor() {

		super();
		this.name = 'UICompositePass';
		this.texture = null;
		this.opacity = 1;
		// Draw into the current buffer instead of swapping it away.
		this.needsSwap = false;
		this.clear = false;

		this.material = new ShaderMaterial( {
			name: 'UICompositeShader',
			uniforms: UICompositeShader.uniforms,
			vertexShader: UICompositeShader.vertexShader,
			fragmentShader: UICompositeShader.fragmentShader,
			transparent: true,
			blending: NormalBlending,
			depthTest: false,
			depthWrite: false,
			premultipliedAlpha: false,
			toneMapped: false,
		} );
		this.uniforms = this.material.uniforms;

		this._fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		if ( ! this.texture ) return;

		this.uniforms.tUI.value = this.texture;
		this.uniforms.uOpacity.value = this.opacity;

		// In-place over RenderPass beauty — never auto-clear the target.
		const prevAutoClear = renderer.autoClear;
		renderer.autoClear = false;

		if ( this.renderToScreen ) {

			renderer.setRenderTarget( null );

		} else {

			renderer.setRenderTarget( readBuffer );

		}

		this._fsQuad.render( renderer );

		renderer.autoClear = prevAutoClear;

	}

	dispose() {

		this.material.dispose();
		this._fsQuad.dispose();

	}

}

export { UICompositePass };
