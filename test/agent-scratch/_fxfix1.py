from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut")

# 1) Fix InvertColorPass — toneMapped:false + ignore near-zero alpha RGB
inv_path = root/"three.js/editor/js/postprocessing/InvertColorPass.js"
inv_path.write_text(r'''/**
 * Color invert post-process pass: mix(input, 1.0 - rgb, intensity).
 * Preserves alpha. Pixels with a≈0 keep rgb unchanged (avoids flashing clear color).
 * Used by camera PP and Text Fx (texture input) via shared Registry.
 */

import {
	ShaderMaterial,
	UniformsUtils
} from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const InvertColorShader = {
	name: 'InvertColorShader',
	uniforms: {
		tDiffuse: { value: null },
		intensity: { value: 1.0 },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,
	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse;
		uniform float intensity;
		varying vec2 vUv;
		void main() {
			vec4 texel = texture2D( tDiffuse, vUv );
			// Transparent clear / padding: do not invert rgb (keeps edges clean for text RT).
			float mask = step( 0.001, texel.a );
			vec3 inverted = 1.0 - texel.rgb;
			vec3 rgb = mix( texel.rgb, inverted, intensity * mask );
			gl_FragColor = vec4( rgb, texel.a );
		}
	`,
};

/**
 * @augments Pass
 */
class InvertColorPass extends Pass {

	/**
	 * @param {number} [intensity=1] - Blend 0 = original, 1 = full invert.
	 */
	constructor( intensity = 1.0 ) {

		super();

		this.uniforms = UniformsUtils.clone( InvertColorShader.uniforms );

		this.material = new ShaderMaterial( {
			name: InvertColorShader.name,
			uniforms: this.uniforms,
			vertexShader: InvertColorShader.vertexShader,
			fragmentShader: InvertColorShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			transparent: false,
		} );

		this.uniforms.intensity.value = intensity;

		this._fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		this.uniforms[ 'tDiffuse' ].value = readBuffer.texture;

		if ( this.renderToScreen ) {

			renderer.setRenderTarget( null );
			this._fsQuad.render( renderer );

		} else {

			renderer.setRenderTarget( writeBuffer );
			if ( this.clear ) renderer.clear();
			this._fsQuad.render( renderer );

		}

	}

	dispose() {

		this.material.dispose();
		this._fsQuad.dispose();

	}

}

export { InvertColorPass, InvertColorShader };
''', encoding='utf-8')
print('InvertColorPass fixed')

# 2) OpenCut invert-pass.ts mirror
oc_inv = root/"freefilmcut/apps/web/src/vfxpack/postprocess/invert-pass.ts"
if oc_inv.exists():
    print('OpenCut invert exists', oc_inv.stat().st_size)
    print(oc_inv.read_text(encoding='utf-8', errors='replace')[:500])
