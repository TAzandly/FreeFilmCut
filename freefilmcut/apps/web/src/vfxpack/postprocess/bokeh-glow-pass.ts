/**
 * BokehGlowPass — FULL port of the CapCut effect pack 超级大光斑
 * (see Editor three.js/editor/js/postprocessing/BokehGlowPass.js for the
 * stage-by-stage doc and the ImageBusinessSlider.lua remaps).
 *
 * Five internal stages: horizontal 9-tap gaussian → vertical gaussian +
 * clamp + filter.png LUT + noise.png light-leak → bokeh kernel ×2 (55% res,
 * amount = 40 + 0.9987*500) → bilinear output.
 *
 * timeIntensity (0..1, UI「光斑量」): CapCut SeekModeScript (1-progress)^4
 * envelope — exposed as a manual slider (0=无光斑, 1=满光斑).
 * Textures load from /effects/bokeh-glow/*.png (GLES2 semantics: no flip, no
 * sRGB decode); until loaded their mix factors stay 0.
 */
import {
	DataTexture,
	LinearFilter,
	NoBlending,
	NoColorSpace,
	RGBAFormat,
	ShaderMaterial,
	TextureLoader,
	UniformsUtils,
	Vector2,
	WebGLRenderTarget,
	HalfFloatType,
} from "three";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";

// The pack runs GLES2: every stage (gaussian, LUT, noise, pow(c,9) bokeh
// weighting) operates on GAMMA-SPACE (sRGB-encoded) values. Our pack composer
// feeds LINEAR HalfFloat (NoColorSpace RTs, OutputPass converts at the end),
// so encode at stage-1 input and decode at the final output stage. Without
// this, pow(c,9) kills midtone contributions (0.5 sRGB = 0.214 linear;
// pow(0.214,9)*539 ≈ 0.0006 vs 1.05 in gamma space) and the bokeh field
// collapses to sparse near-white blobs.
const SRGB_CONVERT_GLSL = /* glsl */ `
	vec3 linearToSRGB( vec3 c ) {
		c = clamp( c, vec3( 0.0 ), vec3( 1.0 ) );
		return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
	}
	vec3 sRGBToLinear( vec3 c ) {
		c = clamp( c, vec3( 0.0 ), vec3( 1.0 ) );
		return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
	}
`;

const COPY_SHADER_FRAGMENT = /* glsl */ `
	uniform sampler2D tDiffuse;
	varying vec2 vUv;
	void main() {
		gl_FragColor = texture2D( tDiffuse, vUv );
	}
`;

const GaussianShader = {
	name: "BokehGlowGaussianShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
		u_unit: { value: new Vector2(1 / 1280, 1 / 1280) },
		u_blurSize: { value: 1.0 },
		u_centerMix: { value: 10.0 },
		u_axis: { value: 1.0 },
	},
	vertexShader: /* glsl */ `
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,
	fragmentShader: /* glsl */ `
		precision highp float;
		uniform sampler2D tDiffuse;
		uniform vec2 u_unit;
		uniform float u_blurSize;
		uniform float u_centerMix;
		uniform float u_axis;
		varying vec2 vUv;
		${SRGB_CONVERT_GLSL}

		float tapWeight( float i ) {
			if ( i < 2.0 ) return .19;
			if ( i < 3.0 ) return .17;
			if ( i < 4.0 ) return .15;
			if ( i < 5.0 ) return .13;
			if ( i < 6.0 ) return .11;
			if ( i < 7.0 ) return .08;
			if ( i < 8.0 ) return .05;
			return .02;
		}

		vec4 sampleSRGB( vec2 uv ) {
			return vec4( linearToSRGB( texture2D( tDiffuse, uv ).rgb ), 1.0 );
		}

		void main() {
			vec4 curColor = sampleSRGB( vUv );
			vec2 dir = ( u_axis > 0.5 ) ? vec2( u_unit.x, 0.0 ) : vec2( 0.0, u_unit.y );

			vec4 resultColor = curColor * .2;
			float weight = .2 * u_centerMix;
			for ( float i = 1.0; i <= 8.0; i ++ ) {
				float w = tapWeight( i );
				vec2 duv = dir * ( u_blurSize * i );
				vec4 pair = sampleSRGB( vUv + duv ) + sampleSRGB( vUv - duv );
				resultColor += pair * w;
				weight += w * 2.0 * 10.0;
			}
			gl_FragColor = resultColor / ( weight / 10.0 );
		}
	`,
};

const VertFinishShader = {
	name: "BokehGlowVertFinishShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
		tFilter: { value: null as unknown },
		tNoise: { value: null as unknown },
		u_unit: { value: new Vector2(1 / 1280, 1 / 1280) },
		u_blurSize: { value: 1.0 },
		u_centerMix: { value: 10.0 },
		u_filterIns: { value: 0.0 },
		u_noiseIns: { value: 0.0 },
	},
	vertexShader: GaussianShader.vertexShader,
	fragmentShader: /* glsl */ `
		precision highp float;
		uniform sampler2D tDiffuse;
		uniform sampler2D tFilter;
		uniform sampler2D tNoise;
		uniform vec2 u_unit;
		uniform float u_blurSize;
		uniform float u_centerMix;
		uniform float u_filterIns;
		uniform float u_noiseIns;
		varying vec2 vUv;

		float tapWeight( float i ) {
			if ( i < 2.0 ) return .19;
			if ( i < 3.0 ) return .17;
			if ( i < 4.0 ) return .15;
			if ( i < 5.0 ) return .13;
			if ( i < 6.0 ) return .11;
			if ( i < 7.0 ) return .08;
			if ( i < 8.0 ) return .05;
			return .02;
		}

		vec4 takeEffectFilter( sampler2D myfilter, vec4 inputColor, float how ) {
			float blueColor = inputColor.b * 63.0;
			vec2 quad1;
			quad1.y = floor( floor( blueColor ) / 8.0 );
			quad1.x = floor( blueColor ) - ( quad1.y * 8.0 );
			vec2 quad2;
			quad2.y = floor( ceil( blueColor ) / 8.0 );
			quad2.x = ceil( blueColor ) - ( quad2.y * 8.0 );
			vec2 texPos1;
			texPos1.x = ( quad1.x * 1.0 / 8.0 ) + .5 / 512.0 + ( ( 1.0 / 8.0 - 1.0 / 512.0 ) * inputColor.r );
			texPos1.y = ( quad1.y * 1.0 / 8.0 ) + .5 / 512.0 + ( ( 1.0 / 8.0 - 1.0 / 512.0 ) * inputColor.g );
			vec2 texPos2;
			texPos2.x = ( quad2.x * 1.0 / 8.0 ) + .5 / 512.0 + ( ( 1.0 / 8.0 - 1.0 / 512.0 ) * inputColor.r );
			texPos2.y = ( quad2.y * 1.0 / 8.0 ) + .5 / 512.0 + ( ( 1.0 / 8.0 - 1.0 / 512.0 ) * inputColor.g );
			vec4 newColor1 = texture2D( myfilter, texPos1 );
			vec4 newColor2 = texture2D( myfilter, texPos2 );
			vec4 newColor = mix( newColor1, newColor2, fract( blueColor ) );
			return mix( inputColor, vec4( newColor.rgb, inputColor.w ), how );
		}

		void main() {
			vec4 curColor = texture2D( tDiffuse, vUv );
			vec2 dir = vec2( 0.0, u_unit.y );

			vec4 resultColor = curColor * .2;
			float weight = .2 * u_centerMix;
			for ( float i = 1.0; i <= 8.0; i ++ ) {
				float w = tapWeight( i );
				vec2 duv = dir * ( u_blurSize * i );
				vec4 pair = texture2D( tDiffuse, vUv + duv ) + texture2D( tDiffuse, vUv - duv );
				resultColor += pair * w;
				weight += w * 2.0 * 10.0;
			}
			resultColor = resultColor / ( weight / 10.0 );
			resultColor = clamp( resultColor, 0.0, 1.0 );

			float noise = texture2D( tNoise, vUv ).r;
			resultColor = takeEffectFilter( tFilter, resultColor, u_filterIns );
			float gray = dot( resultColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
			resultColor.rgb = mix( resultColor.rgb, resultColor.rgb * noise, u_noiseIns * gray );

			gl_FragColor = resultColor;
		}
	`,
};

const BokehShader = {
	name: "BokehGlowBokehShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
		u_unit: { value: new Vector2(1 / 720, 1 / 720) },
		u_blurIntensity: { value: 13.0 },
		u_lightIns: { value: 0.75 },
		u_timeIntensity: { value: 1.0 },
	},
	vertexShader: GaussianShader.vertexShader,
	fragmentShader: /* glsl */ `
		precision highp float;
		uniform sampler2D tDiffuse;
		uniform vec2 u_unit;
		uniform float u_blurIntensity;
		uniform float u_lightIns;
		uniform float u_timeIntensity;
		varying vec2 vUv;

		#define PI 3.1415926

		vec2 rot( float angle, vec2 uv ) {
			float theta = angle * PI / 180.0;
			return uv * mat2( cos( theta ), - sin( theta ), sin( theta ), cos( theta ) );
		}

		void main() {
			vec4 curColor = texture2D( tDiffuse, vUv );
			if ( u_timeIntensity < 0.01 ) {
				gl_FragColor = curColor;
				return;
			}
			float amount = 40.0 + 0.9987 * 500.0;
			vec4 resultColor = curColor;
			vec3 maxColor = vec3( 0.0 );
			vec3 sumWeight = vec3( 0.0 );
			vec3 sumColor = vec3( 0.0 );
			for ( float i = -9.0; i <= 9.0; i += .75 ) {
				for ( float j = -9.0; j <= 9.0; j += .75 ) {
					vec2 tempVec = vec2( i, j );
					if ( dot( tempVec, tempVec ) >= 50.0 ) continue;
					vec2 tempUv = vUv + u_blurIntensity * vec2( i, j ) * u_unit;
					vec3 tempColor = texture2D( tDiffuse, tempUv ).rgb;
					maxColor = max( maxColor, tempColor );
					sumColor += tempColor * ( pow( tempColor, vec3( 9.0 ) ) * amount + .4 );
					sumWeight += pow( tempColor, vec3( 9.0 ) ) * amount + .4;
				}
			}
			for ( float i = 0.0; i <= 360.0; i += 5.0 ) {
				vec2 tempVec = rot( i, vec2( 7.0, 0.0 ) );
				vec2 tempUv = vUv + u_blurIntensity * tempVec * u_unit;
				vec3 tempColor = texture2D( tDiffuse, tempUv ).rgb;
				maxColor = max( maxColor, tempColor );
				sumColor += tempColor * ( pow( tempColor, vec3( 9.0 ) ) * amount + .4 );
				sumWeight += pow( tempColor, vec3( 9.0 ) ) * amount + .4;
			}
			resultColor.rgb = clamp( sumColor / max( sumWeight, vec3( 1e-4 ) ), 0.0, 1.0 );
			resultColor.rgb = mix( resultColor.rgb, maxColor, clamp( resultColor.rgb * u_lightIns, 0.0, 1.0 ) );
			gl_FragColor = resultColor;
		}
	`,
};

const OutputShader = {
	name: "BokehGlowOutputShader",
	uniforms: {
		tDiffuse: { value: null as unknown },
	},
	vertexShader: GaussianShader.vertexShader,
	fragmentShader: /* glsl */ `
		precision highp float;
		uniform sampler2D tDiffuse;
		varying vec2 vUv;
		${SRGB_CONVERT_GLSL}
		void main() {
			// Chain ran in gamma space (GLES2 semantics); decode back to linear
			// so downstream compositing keeps its color-space contract.
			gl_FragColor = vec4( sRGBToLinear( texture2D( tDiffuse, vUv ).rgb ), 1.0 );
		}
	`,
};

function makeWhite1x1(): DataTexture {
	const data = new Uint8Array([255, 255, 255, 255]);
	const tex = new DataTexture(data, 1, 1, RGBAFormat);
	tex.needsUpdate = true;
	return tex;
}

const clamp01 = (value: number): number =>
	Math.min(1, Math.max(0, Number(value) || 0));

export class BokehGlowPass extends Pass {
	/** Raw UI params (0..1) in pack slider semantics. */
	size: number;
	number: number;
	intensity: number;
	filter: number;
	/** CapCut SeekModeScript timeIntensity — 0=无光斑, 1=满光斑. */
	timeIntensity: number;

	private _resolution: Vector2;
	private _horzMaterial: ShaderMaterial;
	private _vertMaterial: ShaderMaterial;
	private _bokeh0Material: ShaderMaterial;
	private _bokeh1Material: ShaderMaterial;
	private _outputMaterial: ShaderMaterial;
	private _fsQuad: FullScreenQuad;

	private _white1x1: DataTexture;
	private _filterTexture: import("three").Texture | null = null;
	private _noiseTexture: import("three").Texture | null = null;
	private _filterLoaded = false;
	private _noiseLoaded = false;
	// The pack bundles filter/noise and renders frame 0 with them already
	// resident. noise.png averages only ~0.10 luminance, so a few early frames
	// without it show a glow roughly twice as bright/large as the authored look
	// ("huge glow that shrinks on first param edit"). Gate the whole effect on
	// texture readiness: passthrough until both textures resolve (or fail).
	private _filterResolved = false;
	private _noiseResolved = false;
	private _texturesPending = true;
	private _copyMaterial: ShaderMaterial;

	private _rtH: WebGLRenderTarget | null = null;
	private _rtV: WebGLRenderTarget | null = null;
	private _rtB0: WebGLRenderTarget | null = null;
	private _rtB1: WebGLRenderTarget | null = null;
	private _rtBokehScale = 0;
	private _w = 0;
	private _h = 0;

	constructor(resolution: Vector2) {
		super();
		this.size = 1.0;
		this.number = 0.1;
		this.intensity = 0.6;
		this.filter = 0.2;
		this.timeIntensity = 1.0;

		this._resolution = resolution?.isVector2
			? resolution.clone()
			: new Vector2(256, 256);

		const materialOptions = {
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		} as const;

		this._horzMaterial = new ShaderMaterial({
			name: GaussianShader.name,
			uniforms: UniformsUtils.clone(
				GaussianShader.uniforms as typeof GaussianShader.uniforms,
			),
			vertexShader: GaussianShader.vertexShader,
			fragmentShader: GaussianShader.fragmentShader,
			...materialOptions,
		});
		this._vertMaterial = new ShaderMaterial({
			name: VertFinishShader.name,
			uniforms: UniformsUtils.clone(
				VertFinishShader.uniforms as typeof VertFinishShader.uniforms,
			),
			vertexShader: VertFinishShader.vertexShader,
			fragmentShader: VertFinishShader.fragmentShader,
			...materialOptions,
		});
		this._bokeh0Material = new ShaderMaterial({
			name: BokehShader.name,
			uniforms: UniformsUtils.clone(
				BokehShader.uniforms as typeof BokehShader.uniforms,
			),
			vertexShader: BokehShader.vertexShader,
			fragmentShader: BokehShader.fragmentShader,
			...materialOptions,
		});
		this._bokeh1Material = new ShaderMaterial({
			name: BokehShader.name,
			uniforms: UniformsUtils.clone(
				BokehShader.uniforms as typeof BokehShader.uniforms,
			),
			vertexShader: BokehShader.vertexShader,
			fragmentShader: BokehShader.fragmentShader,
			...materialOptions,
		});
		this._outputMaterial = new ShaderMaterial({
			name: OutputShader.name,
			uniforms: UniformsUtils.clone(
				OutputShader.uniforms as typeof OutputShader.uniforms,
			),
			vertexShader: OutputShader.vertexShader,
			fragmentShader: OutputShader.fragmentShader,
			...materialOptions,
		});

		this._fsQuad = new FullScreenQuad(this._outputMaterial);

		this._copyMaterial = new ShaderMaterial({
			name: "BokehGlowCopyShader",
			uniforms: UniformsUtils.clone(
				OutputShader.uniforms as typeof OutputShader.uniforms,
			),
			vertexShader: OutputShader.vertexShader,
			fragmentShader: COPY_SHADER_FRAGMENT,
			...materialOptions,
		});

		this._white1x1 = makeWhite1x1();
		this._loadTextures();

		this._allocTargets({
			width: this._resolution.x,
			height: this._resolution.y,
		});
		this.needsSwap = true;
	}

	private _loadTextures() {
		// Browser only — bun tests instantiate the pass without a DOM.
		if (typeof window === "undefined" || typeof document === "undefined") {
			this._filterResolved = true;
			this._noiseResolved = true;
			this._texturesPending = false;
			return;
		}
		try {
			const loader = new TextureLoader();
			// GLES2 semantics: no flip, no sRGB decode — LUT grid math is
			// authored top-left; noise multiplies raw values.
			loader.load(
				"/effects/bokeh-glow/filter.png",
				(tex) => {
					tex.colorSpace = NoColorSpace; // three constant is "" — a literal "NoColorSpace" string is not a registered space and crashes upload
					tex.flipY = false;
					tex.generateMipmaps = false;
					tex.minFilter = LinearFilter;
					tex.magFilter = LinearFilter;
					tex.needsUpdate = true;
					this._filterTexture = tex;
					this._filterLoaded = true;
					this._filterResolved = true;
					this._texturesPending = !(
						this._filterResolved && this._noiseResolved
					);
				},
				undefined,
				() => {
					this._filterResolved = true; // error: white fallback, LUT factor stays 0
					this._texturesPending = !(
						this._filterResolved && this._noiseResolved
					);
				},
			);
			loader.load(
				"/effects/bokeh-glow/noise.png",
				(tex) => {
					tex.colorSpace = NoColorSpace; // three constant is "" — a literal "NoColorSpace" string is not a registered space and crashes upload
					tex.flipY = false;
					tex.generateMipmaps = false;
					tex.minFilter = LinearFilter;
					tex.magFilter = LinearFilter;
					tex.needsUpdate = true;
					this._noiseTexture = tex;
					this._noiseLoaded = true;
					this._noiseResolved = true;
					this._texturesPending = !(
						this._filterResolved && this._noiseResolved
					);
				},
				undefined,
				() => {
					this._noiseResolved = true; // error: white fallback, noise factor stays 0
					this._texturesPending = !(
						this._filterResolved && this._noiseResolved
					);
				},
			);
		} catch {
			// Textures stay fallback; LUT/noise mix factors stay 0.
			this._filterResolved = true;
			this._noiseResolved = true;
			this._texturesPending = false;
		}
	}

	private _makeRT({
		width,
		height,
		name,
	}: {
		width: number;
		height: number;
		name: string;
	}): WebGLRenderTarget {
		const rt = new WebGLRenderTarget(width, height, {
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

	private _allocTargets({
		width,
		height,
	}: {
		width: number;
		height: number;
	}) {
		this._disposeTargets();
		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));
		this._rtH = this._makeRT({ width: w, height: h, name: "BokehGlow.horz" });
		this._rtV = this._makeRT({ width: w, height: h, name: "BokehGlow.vert" });
		this._rtBokehScale = 0; // reallocated on first render with current size
		this._w = w;
		this._h = h;
	}

	private _allocBokehTargets() {
		// Pack SeekModeScript: RTs at 55% while visible, 100% when size ~ 0
		// (near-passthrough must not soften via upscaling).
		const scale =
			this.size < 0.01 || this.timeIntensity < 0.01 ? 1.0 : 0.55;
		if (this._rtBokehScale === scale && this._rtB0 && this._rtB1) return;
		this._rtB0?.dispose();
		this._rtB1?.dispose();
		const w = Math.max(1, Math.floor(this._w * scale));
		const h = Math.max(1, Math.floor(this._h * scale));
		this._rtB0 = this._makeRT({ width: w, height: h, name: "BokehGlow.bokeh0" });
		this._rtB1 = this._makeRT({ width: w, height: h, name: "BokehGlow.bokeh1" });
		this._rtBokehScale = scale;
	}

	private _disposeTargets() {
		for (const rt of [this._rtH, this._rtV, this._rtB0, this._rtB1]) {
			rt?.dispose();
		}
		this._rtH = this._rtV = this._rtB0 = this._rtB1 = null;
	}

	setSize(width: number, height: number) {
		this._resolution.set(width, height);
		this._allocTargets({ width, height });
	}

	private _renderStage(
		renderer: import("three").WebGLRenderer,
		material: ShaderMaterial,
		target: WebGLRenderTarget,
	) {
		this._fsQuad.material = material;
		renderer.setRenderTarget(target);
		renderer.clear();
		this._fsQuad.render(renderer);
	}

	private _blitToOutput({
		renderer,
		writeBuffer,
	}: {
		renderer: import("three").WebGLRenderer;
		writeBuffer: WebGLRenderTarget;
	}) {
		if (this.renderToScreen) {
			renderer.setRenderTarget(null);
			this._fsQuad.render(renderer);
		} else {
			renderer.setRenderTarget(writeBuffer);
			if (this.clear) renderer.clear();
			this._fsQuad.render(renderer);
		}
	}

	render(
		renderer: import("three").WebGLRenderer,
		writeBuffer: WebGLRenderTarget,
		readBuffer: WebGLRenderTarget,
	) {
		const w = this._w;
		const h = this._h;
		if (!w || !h) return;

		// Textures still loading: pass the input through untouched so the very
		// first frames do not show the no-LUT / no-light-leak intermediate look.
		if (this._texturesPending) {
			this._copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
			this._fsQuad.material = this._copyMaterial;
			if (this.renderToScreen) {
				renderer.setRenderTarget(null);
				this._fsQuad.render(renderer);
			} else {
				renderer.setRenderTarget(writeBuffer);
				if (this.clear) renderer.clear();
				this._fsQuad.render(renderer);
			}
			return;
		}

		// Derived uniforms (ImageBusinessSlider.lua + SeekModeScript timeIntensity).
		const t = clamp01(this.timeIntensity);
		const blurIntensity = Math.max(0, this.size) * 13.0;
		const numIntensity = Math.max(0, this.size);
		const noiseIns = Math.max(0, 0.55 * (1.0 - this.number));
		const blurIns = noiseIns;
		const horzR = Math.max(0, 2.0 - 1.5 * this.number);
		const lightIns = Math.max(0, this.intensity) * 1.25;
		const filterIns = this._filterLoaded ? clamp01(this.filter) : 0.0;
		const noiseGate = this._noiseLoaded ? 1.0 : 0.0;
		const tn = t * numIntensity;
		const blurSize = horzR * tn * blurIns;
		const centerMix = 10.0 + (1.0 - 10.0) * tn;

		this._allocBokehTargets();
		const rtH = this._rtH;
		const rtV = this._rtV;
		const rtB0 = this._rtB0;
		const rtB1 = this._rtB1;
		if (!rtH || !rtV || !rtB0 || !rtB1) return;

		const rescale1280 = Math.max(w, h) / 1280.0;
		const rescale720 = Math.min(w, h) / 720.0;

		// 1) Horizontal gaussian
		const horz = this._horzMaterial;
		horz.uniforms.tDiffuse.value = readBuffer.texture;
		const horzUnit = horz.uniforms.u_unit.value;
		if (horzUnit instanceof Vector2) {
			horzUnit.set(rescale1280 / w, rescale1280 / h);
		}
		horz.uniforms.u_blurSize.value = blurSize;
		horz.uniforms.u_centerMix.value = centerMix;
		horz.uniforms.u_axis.value = 1.0;
		this._renderStage(renderer, horz, rtH);

		// 2) Vertical gaussian + clamp + LUT + light-leak noise
		const vert = this._vertMaterial;
		vert.uniforms.tDiffuse.value = rtH.texture;
		vert.uniforms.tFilter.value = this._filterTexture ?? this._white1x1;
		vert.uniforms.tNoise.value = this._noiseTexture ?? this._white1x1;
		const vertUnit = vert.uniforms.u_unit.value;
		if (vertUnit instanceof Vector2) {
			vertUnit.set(rescale1280 / w, rescale1280 / h);
		}
		vert.uniforms.u_blurSize.value = blurSize; // vertR = horzR (lua never sets vertR)
		vert.uniforms.u_centerMix.value = centerMix;
		vert.uniforms.u_filterIns.value = filterIns * t;
		vert.uniforms.u_noiseIns.value = noiseIns * noiseGate * Math.pow(t, 1.5);
		this._renderStage(renderer, vert, rtV);

		// 3) + 4) Bokeh kernel, twice (pack runs PassBokeh0/PassBokeh1)
		for (const mat of [this._bokeh0Material, this._bokeh1Material]) {
			const bokehUnit = mat.uniforms.u_unit.value;
			if (bokehUnit instanceof Vector2) {
				bokehUnit.set((0.5 * rescale720) / w, (0.5 * rescale720) / h);
			}
			mat.uniforms.u_blurIntensity.value = Math.max(blurIntensity * t, 0.01);
			mat.uniforms.u_lightIns.value = lightIns;
			mat.uniforms.u_timeIntensity.value = t;
		}
		this._bokeh0Material.uniforms.tDiffuse.value = rtV.texture;
		this._renderStage(renderer, this._bokeh0Material, rtB0);
		this._bokeh1Material.uniforms.tDiffuse.value = rtB0.texture;
		this._renderStage(renderer, this._bokeh1Material, rtB1);

		// 5) Output: bilinear copy (PassOutput verbatim)
		this._outputMaterial.uniforms.tDiffuse.value = rtB1.texture;
		this._fsQuad.material = this._outputMaterial;
		this._blitToOutput({ renderer, writeBuffer });
	}

	dispose() {
		this._horzMaterial.dispose();
		this._vertMaterial.dispose();
		this._bokeh0Material.dispose();
		this._bokeh1Material.dispose();
		this._outputMaterial.dispose();
		this._copyMaterial.dispose();
		this._fsQuad.dispose();
		this._disposeTargets();
		this._white1x1.dispose();
		this._filterTexture?.dispose();
		this._noiseTexture?.dispose();
	}
}

/** Shader sources exported for tests (gamma-space boundary assertions). */
export const BokehGlowShaderSources = {
	gaussian: GaussianShader,
	vert: VertFinishShader,
	output: OutputShader,
} as const;
