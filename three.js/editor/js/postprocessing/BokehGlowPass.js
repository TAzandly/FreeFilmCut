/**
 * BokehGlowPass — FULL port of the CapCut effect pack 超级大光斑
 * (D:/GrokbotWork/FreeCapCutEffect/特效/超级大光斑, AmazingFeature 13.6.0).
 *
 * Five internal stages, mirroring the pack's scene graph 1:1:
 *   1) PassHorzBlur  — horizontal 9-tap gaussian (weights .2/.19/.17/.15/.13/.11/.08/.05/.02,
 *                      center weight × mix(10, 1, timeIntensity*numIntensity), unit scaled by
 *                      max(w,h)/1280)                              → rtH (full res)
 *   2) PassVertBlur  — vertical gaussian + clamp01 + filter.png 8×8 LUT
 *                      (classic blue-index lookup, filterIns) + noise.png
 *                      light-leak (R channel × gray, noiseIns)     → rtV (full res)
 *   3) PassBokeh0    — highlight-weighted bokeh kernel (~700 taps,
 *                      amount = 40 + 0.9987*500 = 539.35, pow(c,9),
 *                      maxColor mixed by lightIns)                 → rtB0 (55% res)
 *   4) PassBokeh1    — second bokeh iteration (pack runs it twice) → rtB1 (55% res)
 *   5) PassOutput    — bilinear copy to writeBuffer
 *
 * Slider mapping (ImageBusinessSlider.lua, s/n/i/f ∈ [0,1] UI range):
 *   size     → blurIntensity = s*13 (bokeh radius), numIntensity = s
 *   number   → noiseIns = blurIns = 0.55*(1-n), horzR = 2 - 1.5*n
 *   intensity→ lightIns = i*1.25
 *   filter   → filterIns = f
 *
 * timeIntensity (0..1, UI「光斑量」): CapCut SeekModeScript drives this with a
 * (1-progress)^4 envelope over ~1.75s (scaled by effects_adjust_speed). We expose
 * it as a manual slider so 0 = no bokeh / 1 = full. Multiplies gaussian radius,
 * center-weight mix, filter/noise mixes, and bokeh sample offsets (pack shaders).
 * When size < 0.01 or timeIntensity < 0.01 the bokeh RTs run at 100% (pack
 * pecent=1 branch) so near-passthrough does not soften via upscaling.
 *
 * Textures: images/bokeh-glow/filter.png (512² 8×8 LUT, flipY=false, no color
 * decode — GLES2 semantics) and noise.png. Until a texture loads its mix factor
 * is forced to 0 (LUT/noise skipped) with a 1×1 white fallback bound.
 *
 * Color space: the pack runs GLES2 in GAMMA space end to end. Our composer
 * feeds LINEAR HalfFloat, so stage 1 encodes linear→sRGB per sample and the
 * final output stage decodes sRGB→linear (downstream Bloom/OutputPass keep
 * their linear contract). Without this pow(c,9) collapses midtone weights and
 * the bokeh field turns sparse/chunky.
 *
 * HDR contract (same as Bloom/DeepGlow): materials toneMapped=false, NoBlending;
 * only the bokeh stage clamps rgb (as in the original), the gaussian stages keep
 * HDR values for OutputPass tonemapping.
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
} from 'three';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

const GAUSSIAN_WEIGHTS = '.2/.19/.17/.15/.13/.11/.08/.05/.02';

// The pack runs GLES2: every stage (gaussian, LUT, noise, pow(c,9) bokeh
// weighting) operates on GAMMA-SPACE (sRGB-encoded) values. Our composer feeds
// LINEAR HalfFloat (RenderPass → effects → OutputPass converts at the very
// end), so we encode at stage-1 input and decode at the final output stage.
// Without this, pow(c,9) kills midtone contributions (0.5 sRGB = 0.214 linear;
// pow(0.214,9)*539 ≈ 0.0006 vs 1.05 in gamma space) and the bokeh field
// collapses to sparse near-white blobs — the "not smooth" symptom.
const SRGB_CONVERT_GLSL = /* glsl */`
	vec3 linearToSRGB( vec3 c ) {
		c = clamp( c, vec3( 0.0 ), vec3( 1.0 ) );
		return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
	}
	vec3 sRGBToLinear( vec3 c ) {
		c = clamp( c, vec3( 0.0 ), vec3( 1.0 ) );
		return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
	}
`;

const GaussianShader = {
	name: 'BokehGlowGaussianShader',
	uniforms: {
		tDiffuse: { value: null },
		u_unit: { value: new Vector2( 1 / 1280, 1 / 1280 ) },
		u_blurSize: { value: 1.0 },
		u_centerMix: { value: 10.0 },
		u_axis: { value: 1.0 },
	},
	vertexShader: /* glsl */`
		varying vec2 vUv;
		void main() {
			vUv = uv;
			gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 );
		}
	`,
	fragmentShader: /* glsl */`
		precision highp float;
		uniform sampler2D tDiffuse;
		uniform vec2 u_unit;
		uniform float u_blurSize;
		uniform float u_centerMix;
		uniform float u_axis;
		varying vec2 vUv;
		${ SRGB_CONVERT_GLSL }

		// Original per-tap weights: i<2:.19, <3:.17, <4:.15, <5:.13, <6:.11,
		// <7:.08, <8:.05, <9:.02 (neighborWeight returns weight*2*10).
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
	name: 'BokehGlowVertFinishShader',
	uniforms: {
		tDiffuse: { value: null },
		tFilter: { value: null },
		tNoise: { value: null },
		u_unit: { value: new Vector2( 1 / 1280, 1 / 1280 ) },
		u_blurSize: { value: 1.0 },
		u_centerMix: { value: 10.0 },
		u_filterIns: { value: 0.0 },
		u_noiseIns: { value: 0.0 },
	},
	vertexShader: GaussianShader.vertexShader,
	fragmentShader: /* glsl */`
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

		// Classic 8x8-grid LUT lookup (512x512), verbatim from the pack.
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

			// Light-leak: noise.png R channel modulated by luma (verbatim).
			float noise = texture2D( tNoise, vUv ).r;
			resultColor = takeEffectFilter( tFilter, resultColor, u_filterIns );
			float gray = dot( resultColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
			resultColor.rgb = mix( resultColor.rgb, resultColor.rgb * noise, u_noiseIns * gray );

			gl_FragColor = resultColor;
		}
	`,
};

const BokehShader = {
	name: 'BokehGlowBokehShader',
	uniforms: {
		tDiffuse: { value: null },
		u_unit: { value: new Vector2( 1 / 720, 1 / 720 ) },
		u_blurIntensity: { value: 13.0 },
		u_lightIns: { value: 0.75 },
		u_timeIntensity: { value: 1.0 },
	},
	vertexShader: GaussianShader.vertexShader,
	fragmentShader: /* glsl */`
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
			// Pack bokeh.frag: early-out when timeIntensity < 0.01 → identity.
			if ( u_timeIntensity < 0.01 ) {
				gl_FragColor = curColor;
				return;
			}
			// amount = 40.0 + 0.9987*500.0 (verbatim from bokeh.frag)
			float amount = 40.0 + 0.9987 * 500.0;
			vec4 resultColor = curColor;
			vec3 maxColor = vec3( 0.0 );
			vec3 sumWeight = vec3( 0.0 );
			vec3 sumColor = vec3( 0.0 );
			// Pack: UV offset *= blurIntensity * timeIntensity (baked into u_blurIntensity).
			for ( float i = - 9.0; i <= 9.0; i += .75 ) {
				for ( float j = - 9.0; j <= 9.0; j += .75 ) {
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
	name: 'BokehGlowOutputShader',
	uniforms: {
		tDiffuse: { value: null },
	},
	vertexShader: GaussianShader.vertexShader,
	fragmentShader: /* glsl */`
		precision highp float;
		uniform sampler2D tDiffuse;
		varying vec2 vUv;
		${ SRGB_CONVERT_GLSL }
		void main() {
			// Chain ran in gamma space (GLES2 semantics); decode back to linear
			// so downstream passes (Bloom / OutputPass tonemap) keep their contract.
			gl_FragColor = vec4( sRGBToLinear( texture2D( tDiffuse, vUv ).rgb ), 1.0 );
		}
	`,
};

function makeWhite1x1() {

	const data = new Uint8Array( [ 255, 255, 255, 255 ] );
	const tex = new DataTexture( data, 1, 1, RGBAFormat );
	tex.needsUpdate = true;
	return tex;

}

const CopyShader = {
	name: 'BokehGlowCopyShader',
	uniforms: {
		tDiffuse: { value: null },
	},
	vertexShader: GaussianShader.vertexShader,
	fragmentShader: /* glsl */`
		uniform sampler2D tDiffuse;
		varying vec2 vUv;
		void main() {
			gl_FragColor = texture2D( tDiffuse, vUv );
		}
	`,
};

/**
 * @augments Pass
 */
class BokehGlowPass extends Pass {

	/**
	 * @param {Vector2} [resolution]
	 */
	constructor( resolution ) {

		super();

		// Raw UI params (0..1), sliders in pack semantics. Derived uniforms are
		// recomputed in render() so keyframed applyParams updates stay cheap.
		this.size = 1.0;
		this.number = 0.1;
		this.intensity = 0.6;
		this.filter = 0.2;
		// CapCut SeekModeScript timeIntensity — manual 0..1「光斑量」.
		this.timeIntensity = 1.0;

		this._resolution = ( resolution && resolution.isVector2 )
			? resolution.clone()
			: new Vector2( 256, 256 );

		this._horzMaterial = new ShaderMaterial( {
			name: GaussianShader.name,
			uniforms: UniformsUtils.clone( GaussianShader.uniforms ),
			vertexShader: GaussianShader.vertexShader,
			fragmentShader: GaussianShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		} );

		this._vertMaterial = new ShaderMaterial( {
			name: VertFinishShader.name,
			uniforms: UniformsUtils.clone( VertFinishShader.uniforms ),
			vertexShader: VertFinishShader.vertexShader,
			fragmentShader: VertFinishShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		} );

		this._bokeh0Material = new ShaderMaterial( {
			name: BokehShader.name,
			uniforms: UniformsUtils.clone( BokehShader.uniforms ),
			vertexShader: BokehShader.vertexShader,
			fragmentShader: BokehShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		} );

		this._bokeh1Material = new ShaderMaterial( {
			name: BokehShader.name,
			uniforms: UniformsUtils.clone( BokehShader.uniforms ),
			vertexShader: BokehShader.vertexShader,
			fragmentShader: BokehShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		} );

		this._outputMaterial = new ShaderMaterial( {
			name: OutputShader.name,
			uniforms: UniformsUtils.clone( OutputShader.uniforms ),
			vertexShader: OutputShader.vertexShader,
			fragmentShader: OutputShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		} );

		this._fsQuad = new FullScreenQuad( this._outputMaterial );

		this._white1x1 = makeWhite1x1();
		this._filterTexture = null;
		this._noiseTexture = null;
		this._filterLoaded = false;
		this._noiseLoaded = false;
		// The pack bundles filter/noise and renders frame 0 with them already
		// resident. noise.png averages only ~0.10 luminance, so a few early
		// frames without it show a glow roughly twice as bright/large as the
		// authored look ("huge glow that shrinks on first param edit"). Gate
		// the whole effect on texture readiness: passthrough until resolved.
		this._filterResolved = false;
		this._noiseResolved = false;
		this._loadTextures();
		this._texturesPending = ! ( this._filterResolved && this._noiseResolved );

		this._copyMaterial = new ShaderMaterial( {
			name: CopyShader.name,
			uniforms: UniformsUtils.clone( CopyShader.uniforms ),
			vertexShader: CopyShader.vertexShader,
			fragmentShader: CopyShader.fragmentShader,
			toneMapped: false,
			depthTest: false,
			depthWrite: false,
			blending: NoBlending,
		} );

		this._rtH = null;
		this._rtV = null;
		this._rtB0 = null;
		this._rtB1 = null;
		this._rtBokehScale = 0;

		this._allocTargets( this._resolution.x, this._resolution.y );
		this.needsSwap = true;

	}

	_loadTextures() {

		if ( typeof TextureLoader === 'undefined' ) {

			this._filterResolved = this._noiseResolved = true;
			return;

		}
		try {
			const loader = new TextureLoader();
			const filterUrl = new URL( '../../images/bokeh-glow/filter.png', import.meta.url ).href;
			const noiseUrl = new URL( '../../images/bokeh-glow/noise.png', import.meta.url ).href;
			// GLES2 semantics: no sRGB decode, no flip — LUT grid math is authored top-left.
			loader.load( filterUrl, ( tex ) => {

				tex.colorSpace = NoColorSpace; // three constant is '' — a literal 'NoColorSpace' string is not a registered space and crashes upload
				tex.flipY = false;
				tex.generateMipmaps = false;
				tex.minFilter = LinearFilter;
				tex.magFilter = LinearFilter;
				tex.needsUpdate = true;
				this._filterTexture = tex;
				this._filterLoaded = true;
				this._filterResolved = true;
				this._texturesPending = ! ( this._filterResolved && this._noiseResolved );

			}, undefined, () => {

				this._filterResolved = true; // error: stay on white fallback, LUT factor stays 0
				this._texturesPending = ! ( this._filterResolved && this._noiseResolved );

			} );
			loader.load( noiseUrl, ( tex ) => {

				tex.colorSpace = NoColorSpace; // three constant is '' — a literal 'NoColorSpace' string is not a registered space and crashes upload
				tex.flipY = false;
				tex.generateMipmaps = false;
				tex.minFilter = LinearFilter;
				tex.magFilter = LinearFilter;
				tex.needsUpdate = true;
				this._noiseTexture = tex;
				this._noiseLoaded = true;
				this._noiseResolved = true;
				this._texturesPending = ! ( this._filterResolved && this._noiseResolved );

			}, undefined, () => {

				this._noiseResolved = true; // error: stay on white fallback, noise factor stays 0
				this._texturesPending = ! ( this._filterResolved && this._noiseResolved );

			} );
		} catch ( e ) {
			// Textures stay fallback; LUT/noise mix factors stay 0.
			this._filterResolved = this._noiseResolved = true;
			this._texturesPending = false;
		}

	}

	_makeRT( w, h, name ) {

		const rt = new WebGLRenderTarget( w, h, {
			minFilter: LinearFilter,
			magFilter: LinearFilter,
			format: RGBAFormat,
			type: HalfFloatType,
			depthBuffer: false,
			stencilBuffer: false,
		} );
		rt.texture.name = name;
		rt.texture.generateMipmaps = false;
		return rt;

	}

	_allocTargets( width, height ) {

		const w = Math.max( 1, Math.floor( width ) );
		const h = Math.max( 1, Math.floor( height ) );
		this._disposeTargets();
		this._rtH = this._makeRT( w, h, 'BokehGlow.horz' );
		this._rtV = this._makeRT( w, h, 'BokehGlow.vert' );
		this._rtBokehScale = 0; // reallocated on first render with current size
		this._w = w;
		this._h = h;

	}

	_allocBokehTargets() {

		// Pack SeekModeScript: RTs at 55% while the effect is visible, 100% when
		// size/time intensity ~ 0 (near-passthrough must not soften on upscale).
		const scale = ( this.size < 0.01 || this.timeIntensity < 0.01 ) ? 1.0 : 0.55;
		if ( this._rtBokehScale === scale && this._rtB0 ) return;
		this._rtB0?.dispose();
		this._rtB1?.dispose();
		const w = Math.max( 1, Math.floor( this._w * scale ) );
		const h = Math.max( 1, Math.floor( this._h * scale ) );
		this._rtB0 = this._makeRT( w, h, 'BokehGlow.bokeh0' );
		this._rtB1 = this._makeRT( w, h, 'BokehGlow.bokeh1' );
		this._rtBokehScale = scale;

	}

	_disposeTargets() {

		for ( const rt of [ this._rtH, this._rtV, this._rtB0, this._rtB1 ] ) {

			if ( rt ) rt.dispose();

		}
		this._rtH = this._rtV = this._rtB0 = this._rtB1 = null;

	}

	setSize( width, height ) {

		this._resolution.set( width, height );
		this._allocTargets( width, height );

	}

	_renderStage( renderer, material, target ) {

		this._fsQuad.material = material;
		renderer.setRenderTarget( target );
		renderer.clear();
		this._fsQuad.render( renderer );

	}

	render( renderer, writeBuffer, readBuffer ) {

		const w = this._w;
		const h = this._h;
		if ( ! w || ! h ) return;

		// Textures still loading: pass the input through untouched so the very
		// first frames do not show the no-LUT / no-light-leak intermediate look.
		if ( this._texturesPending ) {

			this._copyMaterial.uniforms.tDiffuse.value = readBuffer.texture;
			this._fsQuad.material = this._copyMaterial;
			if ( this.renderToScreen ) {

				renderer.setRenderTarget( null );
				this._fsQuad.render( renderer );

			} else {

				renderer.setRenderTarget( writeBuffer );
				if ( this.clear ) renderer.clear();
				this._fsQuad.render( renderer );

			}
			return;

		}

		// Derived uniforms (ImageBusinessSlider.lua + SeekModeScript timeIntensity).
		const t = Math.min( 1, Math.max( 0, this.timeIntensity ) );
		const blurIntensity = Math.max( 0, this.size ) * 13.0;
		const numIntensity = Math.max( 0, this.size );
		const noiseIns = Math.max( 0, 0.55 * ( 1.0 - this.number ) );
		const blurIns = noiseIns;
		const horzR = Math.max( 0, 2.0 - 1.5 * this.number );
		const lightIns = Math.max( 0, this.intensity ) * 1.25;
		const filterIns = this._filterLoaded ? Math.max( 0, this.filter ) : 0.0;
		const noiseGate = this._noiseLoaded ? 1.0 : 0.0;
		// Pack: blurSize = horzR * timeIntensity * numIntensity * blurIns
		//        centerMix = mix(10, 1, timeIntensity * numIntensity)
		//        filterIns *= timeIntensity; noise *= pow(timeIntensity, 1.5)
		const tn = t * numIntensity;
		const blurSize = horzR * tn * blurIns;
		const centerMix = 10.0 + ( 1.0 - 10.0 ) * tn;

		this._allocBokehTargets();

		const rescale1280 = Math.max( w, h ) / 1280.0;
		const unit1280 = new Vector2( rescale1280 / w, rescale1280 / h );
		const rescale720 = Math.min( w, h ) / 720.0;
		const unit720 = new Vector2( ( 0.5 * rescale720 ) / w, ( 0.5 * rescale720 ) / h );

		// 1) Horizontal gaussian
		const horz = this._horzMaterial;
		horz.uniforms.tDiffuse.value = readBuffer.texture;
		horz.uniforms.u_unit.value.copy( unit1280 );
		horz.uniforms.u_blurSize.value = blurSize;
		horz.uniforms.u_centerMix.value = centerMix;
		horz.uniforms.u_axis.value = 1.0;
		this._renderStage( renderer, horz, this._rtH );

		// 2) Vertical gaussian + clamp + LUT + light-leak noise
		const vert = this._vertMaterial;
		vert.uniforms.tDiffuse.value = this._rtH.texture;
		vert.uniforms.tFilter.value = this._filterTexture || this._white1x1;
		vert.uniforms.tNoise.value = this._noiseTexture || this._white1x1;
		vert.uniforms.u_unit.value.copy( unit1280 );
		vert.uniforms.u_blurSize.value = blurSize; // vertR = horzR (lua never sets vertR)
		vert.uniforms.u_centerMix.value = centerMix;
		vert.uniforms.u_filterIns.value = filterIns * t; // mix(0, filterIns, timeIntensity)
		vert.uniforms.u_noiseIns.value = noiseIns * noiseGate * Math.pow( t, 1.5 );
		this._renderStage( renderer, vert, this._rtV );

		// 3) + 4) Bokeh kernel, twice (pack runs PassBokeh0/PassBokeh1)
		for ( const mat of [ this._bokeh0Material, this._bokeh1Material ] ) {

			mat.uniforms.u_unit.value.copy( unit720 );
			// Pack: UV *= blurIntensity * timeIntensity
			mat.uniforms.u_blurIntensity.value = Math.max( blurIntensity * t, 0.01 );
			mat.uniforms.u_lightIns.value = lightIns;
			mat.uniforms.u_timeIntensity.value = t;

		}
		this._bokeh0Material.uniforms.tDiffuse.value = this._rtV.texture;
		this._renderStage( renderer, this._bokeh0Material, this._rtB0 );
		this._bokeh1Material.uniforms.tDiffuse.value = this._rtB0.texture;
		this._renderStage( renderer, this._bokeh1Material, this._rtB1 );

		// 5) Output: bilinear copy (PassOutput verbatim)
		this._outputMaterial.uniforms.tDiffuse.value = this._rtB1.texture;
		this._fsQuad.material = this._outputMaterial;
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

export { BokehGlowPass };
