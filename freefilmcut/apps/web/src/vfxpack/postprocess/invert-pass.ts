import {
	ShaderMaterial,
	UniformsUtils,
	type WebGLRenderer,
	type WebGLRenderTarget,
} from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const InvertColorShader = {
	name: "InvertColorShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
		intensity: { value: 1.0 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,
	fragmentShader: /* glsl */ `
		uniform sampler2D tDiffuse;
		uniform float intensity;
		varying vec2 vUv;
		void main() {
			vec4 texel = texture2D( tDiffuse, vUv );
			float mask = step( 0.001, texel.a );
			vec3 inverted = 1.0 - texel.rgb;
			vec3 rgb = mix( texel.rgb, inverted, intensity * mask );
			gl_FragColor = vec4( rgb, texel.a );
		}
	`,
};

export class InvertColorPass extends Pass {
	uniforms: typeof InvertColorShader.uniforms;
	material: ShaderMaterial;
	private _fsQuad: FullScreenQuad;

	constructor(intensity = 1.0) {
		super();
		this.uniforms = UniformsUtils.clone(InvertColorShader.uniforms);
		this.material = new ShaderMaterial({
			name: InvertColorShader.name,
			uniforms: this.uniforms,
			vertexShader: InvertColorShader.vertexShader,
			fragmentShader: InvertColorShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			transparent: false,
		});
		this.uniforms.intensity.value = intensity;
		this._fsQuad = new FullScreenQuad(this.material);
	}

	render(
		renderer: WebGLRenderer,
		writeBuffer: WebGLRenderTarget,
		readBuffer: WebGLRenderTarget,
	) {
		this.uniforms.tDiffuse.value = readBuffer.texture;
		if (this.renderToScreen) {
			renderer.setRenderTarget(null);
			this._fsQuad.render(renderer);
		} else {
			renderer.setRenderTarget(writeBuffer);
			if (this.clear) renderer.clear();
			this._fsQuad.render(renderer);
		}
	}

	dispose() {
		this.material.dispose();
		this._fsQuad.dispose();
	}
}
