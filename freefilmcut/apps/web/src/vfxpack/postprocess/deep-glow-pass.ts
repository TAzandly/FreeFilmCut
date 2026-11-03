/**
 * DeepGlowPass — FreeFilmCut rewrite of JY Deep_Glow algorithm (not a file copy).
 * Mirrored: alpha/luma energy → packed multi-radius Gaussian H/V (gamma 2.4) →
 * 8-level screen blend with pow(intensity*0.5, 1/2.4). See Editor DeepGlowPass.js.
 */
import {
	ShaderMaterial,
	UniformsUtils,
	Vector2,
	Vector3,
	WebGLRenderTarget,
	LinearFilter,
	RGBAFormat,
	HalfFloatType,
	NoBlending,
} from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

const SAMPLE1 = 16;
const SAMPLE2 = 32;

const ExtractShader = {
	name: "DeepGlowExtractShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
		threshold: { value: 0.0 },
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
		uniform float threshold;
		varying vec2 vUv;
		void main() {
			vec4 c = texture2D( tDiffuse, vUv );
			float luma = dot( c.rgb, vec3( 0.2126, 0.7152, 0.0722 ) );
			float energy = max( max( luma, c.a ), 0.0 );
			energy = max( energy - threshold, 0.0 );
			gl_FragColor = vec4( energy );
		}
	`,
};

const PackedBlurShader = {
	name: "DeepGlowPackedBlurShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
		texelSize: { value: new Vector2(1, 1) },
		downSample: { value: 1.0 },
		horizontal: { value: 1.0 },
		sampleMax: { value: 16.0 },
		radiusScale: { value: 1.0 },
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
		uniform vec2 texelSize;
		uniform float downSample;
		uniform float horizontal;
		uniform float sampleMax;
		uniform float radiusScale;
		varying vec2 vUv;

		float normpdf( float x, float sigma ) {
			return 0.39894 * exp( -0.5 * x * x / ( sigma * sigma ) ) / sigma;
		}

		void main() {
			float sigma = 4.0;
			float gamma = 2.4;
			float s = max( sampleMax, 1.0 );
			float s1 = s * 0.5;
			float s2 = s1 * 0.5;
			float s3 = s2 * 0.5;

			vec2 dir = ( horizontal > 0.5 )
				? vec2( texelSize.x, 0.0 )
				: vec2( 0.0, texelSize.y );
			vec2 unit_uv = dir * downSample * max( radiusScale, 0.01 );

			vec4 cur = texture2D( tDiffuse, vUv );
			vec4 base = ( horizontal > 0.5 ) ? cur.aaaa : cur;
			float weight0 = normpdf( 0.0, sigma );
			vec4 center = pow( base, vec4( gamma ) ) * weight0;
			vec4 sum = vec4( 0.0 );
			vec4 sum_weight = vec4( weight0 );

			for ( int i = 1; i <= 32; ++ i ) {
				float curIndex = float( i );
				if ( curIndex > s + 0.5 ) break;

				vec2 rUv = vUv + unit_uv * curIndex;
				vec2 lUv = vUv - unit_uv * curIndex;
				vec4 rightColor = texture2D( tDiffuse, rUv );
				vec4 leftColor = texture2D( tDiffuse, lUv );
				if ( horizontal > 0.5 ) {
					rightColor = rightColor.aaaa;
					leftColor = leftColor.aaaa;
				}
				rightColor = pow( rightColor, vec4( gamma ) );
				leftColor = pow( leftColor, vec4( gamma ) );

				if ( curIndex <= s3 ) {
					float w = normpdf( curIndex / s3 * 16.0, sigma );
					sum.r += ( rightColor.r + leftColor.r ) * w;
					sum_weight.r += w * 2.0;
				}
				if ( curIndex <= s2 ) {
					float w = normpdf( curIndex / s2 * 16.0, sigma );
					sum.g += ( rightColor.g + leftColor.g ) * w;
					sum_weight.g += w * 2.0;
				}
				if ( curIndex <= s1 ) {
					float w = normpdf( curIndex / s1 * 16.0, sigma );
					sum.b += ( rightColor.b + leftColor.b ) * w;
					sum_weight.b += w * 2.0;
				}
				{
					float w = normpdf( curIndex / s * 16.0, sigma );
					sum.a += ( rightColor.a + leftColor.a ) * w;
					sum_weight.a += w * 2.0;
				}
			}

			vec4 result = ( sum + center ) / max( sum_weight, vec4( 1e-4 ) );
			gl_FragColor = pow( result, vec4( 1.0 / gamma ) );
		}
	`,
};

const BlendShader = {
	name: "DeepGlowBlendShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
		tGlow0: { value: null as unknown },
		tGlow1: { value: null as unknown },
		intensity: { value: 1.2 },
		glowColor: { value: new Vector3(1, 1, 1) },
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
		uniform sampler2D tGlow0;
		uniform sampler2D tGlow1;
		uniform float intensity;
		uniform vec3 glowColor;
		varying vec2 vUv;

		void main() {
			vec4 oriColor = texture2D( tDiffuse, vUv );

			// intensity <= 0 => identity (no brightening from self-screen+add)
			if ( intensity <= 1e-4 ) {
				gl_FragColor = oriColor;
				return;
			}

			vec4 blurColor = texture2D( tGlow0, vUv );
			vec4 blurColor1 = texture2D( tGlow1, vUv );

			float blurGray1 = blurColor.x;
			float blurGray2 = blurColor.y;
			float blurGray3 = blurColor.z;
			float blurGray4 = blurColor.w;
			float blurGray5 = blurColor1.x;
			float blurGray6 = blurColor1.y;
			float blurGray7 = blurColor1.z;
			float blurGray8 = blurColor1.w;

			// JY-shaped curve, but no +1e-5 floor so I=0 stays silent (guard above)
			float softI = pow( max( intensity, 0.0 ) * 0.5, 1.0 / 2.4 );
			vec4 tint = vec4( glowColor, 1.0 );

			vec4 dis1 = clamp( vec4( blurGray1 ) * softI * tint, 0.0, 1.0 );
			vec4 dis2 = clamp( vec4( blurGray2 ) * softI * tint, 0.0, 1.0 );
			vec4 dis3 = clamp( vec4( blurGray3 ) * softI * tint, 0.0, 1.0 );
			vec4 dis4 = clamp( vec4( blurGray4 ) * softI * tint, 0.0, 1.0 );
			vec4 dis5 = clamp( vec4( blurGray5 ) * softI * tint, 0.0, 1.0 );
			vec4 dis6 = clamp( vec4( blurGray6 ) * softI * tint, 0.0, 1.0 );
			vec4 dis7 = clamp( vec4( blurGray7 ) * softI * tint, 0.0, 1.0 );
			vec4 dis8 = clamp( vec4( blurGray8 ) * softI * tint, 0.0, 1.0 );

			// Screen-merge 8 levels
			dis1 = 1.0 - ( 1.0 - dis1 ) * ( 1.0 - dis2 );
			dis1 = 1.0 - ( 1.0 - dis1 ) * ( 1.0 - dis3 );
			dis1 = 1.0 - ( 1.0 - dis1 ) * ( 1.0 - dis4 );
			dis1 = 1.0 - ( 1.0 - dis1 ) * ( 1.0 - dis5 );
			dis1 = 1.0 - ( 1.0 - dis1 ) * ( 1.0 - dis6 );
			dis1 = 1.0 - ( 1.0 - dis1 ) * ( 1.0 - dis7 );
			dis1 = 1.0 - ( 1.0 - dis1 ) * ( 1.0 - dis8 );

			// Do NOT use max(softI, 1.0) — that forced boost when softI < 1
			vec4 glowLayer = clamp( dis1 * softI, 0.0, 1.0 );

			// Skip screen/self-screen/add when no glow energy (avoids ori self-screen brighten)
			float glowAmt = max( max( glowLayer.r, glowLayer.g ), max( glowLayer.b, glowLayer.a ) );
			if ( glowAmt <= 1e-5 ) {
				gl_FragColor = oriColor;
				return;
			}

			vec4 glowColor4 = glowLayer;
			glowColor4 = 1.0 - ( 1.0 - glowColor4 ) * ( 1.0 - oriColor );
			glowColor4 = 1.0 - ( 1.0 - glowColor4 ) * ( 1.0 - glowColor4 );

			// Only the glow delta is added (not a full brightened duplicate of ori)
			vec4 res = oriColor + glowColor4 * softI;
			res = clamp( res, vec4( 0.0 ), vec4( 1.0 ) );
			float alpha = clamp( max( oriColor.a, glowLayer.a ), 0.0, 1.0 );
			gl_FragColor = vec4( res.rgb, alpha );
		}
	`,
};

export class DeepGlowPass extends Pass {
	intensity: number;
	threshold: number;
	radius: number;
	downSample: number;
	glowColor: Vector3;

	private _resolution: Vector2;
	private _extractMaterial: ShaderMaterial;
	private _blurMaterial: ShaderMaterial;
	private _blendMaterial: ShaderMaterial;
	private _fsQuad: FullScreenQuad;
	private _energyRT: WebGLRenderTarget | null = null;
	private _midRT1: WebGLRenderTarget | null = null;
	private _midRT2: WebGLRenderTarget | null = null;
	private _glow0: WebGLRenderTarget | null = null;
	private _glow1: WebGLRenderTarget | null = null;

	constructor(
		resolution?: Vector2,
		intensity = 1.2,
		threshold = 0.0,
		radius = 1.0,
	) {
		super();
		this.intensity = intensity;
		this.threshold = threshold;
		this.radius = radius;
		this.downSample = 1.0;
		this.glowColor = new Vector3(1, 1, 1);
		this._resolution =
			resolution && resolution.isVector2
				? resolution.clone()
				: new Vector2(256, 256);

		this._extractMaterial = new ShaderMaterial({
			name: ExtractShader.name,
			uniforms: UniformsUtils.clone(ExtractShader.uniforms),
			vertexShader: ExtractShader.vertexShader,
			fragmentShader: ExtractShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		});
		this._blurMaterial = new ShaderMaterial({
			name: PackedBlurShader.name,
			uniforms: UniformsUtils.clone(PackedBlurShader.uniforms),
			vertexShader: PackedBlurShader.vertexShader,
			fragmentShader: PackedBlurShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		});
		this._blendMaterial = new ShaderMaterial({
			name: BlendShader.name,
			uniforms: UniformsUtils.clone(BlendShader.uniforms),
			vertexShader: BlendShader.vertexShader,
			fragmentShader: BlendShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		});
		this._fsQuad = new FullScreenQuad(null as unknown as ShaderMaterial);
		this._allocTargets(this._resolution.x, this._resolution.y);
		this.needsSwap = true;
	}

	private _makeRT(w: number, h: number, name: string) {
		const rt = new WebGLRenderTarget(w, h, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			format: RGBAFormat,
			type: HalfFloatType,
			depthBuffer: false,
			stencilBuffer: false,
		});
		rt.texture.name = name;
		rt.texture.generateMipmaps = false;
		return rt;
	}

	private _disposeTargets() {
		for (const rt of [
			this._energyRT,
			this._midRT1,
			this._midRT2,
			this._glow0,
			this._glow1,
		]) {
			rt?.dispose();
		}
		this._energyRT = this._midRT1 = this._midRT2 = this._glow0 = this._glow1 =
			null;
	}

	private _allocTargets(width: number, height: number) {
		this._disposeTargets();
		const w = Math.max(1, Math.floor(width / 2));
		const h = Math.max(1, Math.floor(height / 2));
		this._energyRT = this._makeRT(w, h, "DeepGlow.energy");
		this._midRT1 = this._makeRT(w, h, "DeepGlow.mid1");
		this._midRT2 = this._makeRT(w, h, "DeepGlow.mid2");
		this._glow0 = this._makeRT(w, h, "DeepGlow.glow0");
		this._glow1 = this._makeRT(w, h, "DeepGlow.glow1");
	}

	setSize(width: number, height: number) {
		this._resolution.set(width, height);
		this._allocTargets(width, height);
	}

	private _runBlur(
		renderer: import("three").WebGLRenderer,
		src: WebGLRenderTarget,
		mid: WebGLRenderTarget,
		dest: WebGLRenderTarget,
		sampleMax: number,
	) {
		const blur = this._blurMaterial;
		const w = dest.width;
		const h = dest.height;
		const ds = this.downSample * Math.max(this.radius, 0.01);

		blur.uniforms.tDiffuse.value = src.texture;
		blur.uniforms.texelSize.value.set(1 / Math.max(1, w), 1 / Math.max(1, h));
		blur.uniforms.downSample.value = ds;
		blur.uniforms.horizontal.value = 1.0;
		blur.uniforms.sampleMax.value = sampleMax;
		blur.uniforms.radiusScale.value = 1.0;
		renderer.setRenderTarget(mid);
		renderer.clear();
		this._fsQuad.material = blur;
		this._fsQuad.render(renderer);

		blur.uniforms.tDiffuse.value = mid.texture;
		blur.uniforms.horizontal.value = 0.0;
		renderer.setRenderTarget(dest);
		renderer.clear();
		this._fsQuad.render(renderer);
	}

	render(
		renderer: import("three").WebGLRenderer,
		writeBuffer: WebGLRenderTarget,
		readBuffer: WebGLRenderTarget,
	) {
		const extract = this._extractMaterial;
		const blend = this._blendMaterial;

		extract.uniforms.tDiffuse.value = readBuffer.texture;
		extract.uniforms.threshold.value = this.threshold;
		renderer.setRenderTarget(this._energyRT);
		renderer.clear();
		this._fsQuad.material = extract;
		this._fsQuad.render(renderer);

		this._runBlur(
			renderer,
			this._energyRT!,
			this._midRT1!,
			this._glow0!,
			SAMPLE1,
		);
		this._runBlur(
			renderer,
			this._energyRT!,
			this._midRT2!,
			this._glow1!,
			SAMPLE2,
		);

		blend.uniforms.tDiffuse.value = readBuffer.texture;
		blend.uniforms.tGlow0.value = this._glow0!.texture;
		blend.uniforms.tGlow1.value = this._glow1!.texture;
		blend.uniforms.intensity.value = this.intensity;
		(blend.uniforms.glowColor.value as Vector3).copy(this.glowColor);

		this._fsQuad.material = blend;
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
		this._extractMaterial.dispose();
		this._blurMaterial.dispose();
		this._blendMaterial.dispose();
		this._fsQuad.dispose();
		this._disposeTargets();
	}
}
