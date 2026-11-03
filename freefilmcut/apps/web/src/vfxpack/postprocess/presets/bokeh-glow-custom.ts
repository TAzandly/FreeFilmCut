/**
 * P4 acceptance: 超级大光斑 as a pure CustomEffectDefinition (NLE twin of
 * editor presets/BokehGlowCustomDefinition.js). Texture URLs point at the
 * public/effects/bokeh-glow assets already used by the handwritten pass.
 */
import type { CustomEffectDefinition } from "../custom-pass";

const FILTER_URL = "/effects/bokeh-glow/filter.png";
const NOISE_URL = "/effects/bokeh-glow/noise.png";

const SRGB_HELPERS = /* glsl */ `
	vec3 linearToSRGB( vec3 c ) {
		c = clamp( c, vec3( 0.0 ), vec3( 1.0 ) );
		return mix( c * 12.92, 1.055 * pow( c, vec3( 1.0 / 2.4 ) ) - 0.055, step( 0.0031308, c ) );
	}
	vec3 sRGBToLinear( vec3 c ) {
		c = clamp( c, vec3( 0.0 ), vec3( 1.0 ) );
		return mix( c / 12.92, pow( ( c + 0.055 ) / 1.055, vec3( 2.4 ) ), step( 0.04045, c ) );
	}
`;

const TAP_WEIGHT = /* glsl */ `
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
`;

const SLIDER_REMAP = /* glsl */ `
	// ImageBusinessSlider.lua + SeekModeScript timeIntensity (0=无光斑, 1=满)
	float numIntensity() { return max( size, 0.0 ); }
	float blurIns() { return max( 0.0, 0.55 * ( 1.0 - number ) ); }
	float horzR() { return max( 0.0, 2.0 - 1.5 * number ); }
	float blurSize() { return horzR() * timeIntensity * numIntensity() * blurIns(); }
	float centerMix() { return mix( 10.0, 1.0, timeIntensity * numIntensity() ); }
	float blurIntensity() { return max( max( size, 0.0 ) * 13.0 * timeIntensity, 0.01 ); }
	float lightIns() { return max( intensity, 0.0 ) * 1.25; }
	float getFilterIns() { return max( filterIns, 0.0 ) * timeIntensity; }
	float noiseIns() { return blurIns() * pow( timeIntensity, 1.5 ); }
	vec2 unit1280() {
		float rescale = max( uChainResolution.x, uChainResolution.y ) / 1280.0;
		return vec2( rescale / uChainResolution.x, rescale / uChainResolution.y );
	}
	vec2 unit720() {
		float rescale = min( uChainResolution.x, uChainResolution.y ) / 720.0;
		return vec2( ( 0.5 * rescale ) / uChainResolution.x, ( 0.5 * rescale ) / uChainResolution.y );
	}
`;

const PARAM_UNIFORMS = /* glsl */ `
	uniform float size;
	uniform float number;
	uniform float intensity;
	uniform float filterIns;
	uniform float timeIntensity;
	uniform vec2 uChainResolution;
`;

const HORZ_FS = /* glsl */ `
	precision highp float;
	uniform sampler2D tDiffuse;
	${PARAM_UNIFORMS}
	varying vec2 vUv;
	${SRGB_HELPERS}
	${TAP_WEIGHT}
	${SLIDER_REMAP}

	vec4 sampleSRGB( vec2 uv ) {
		return vec4( linearToSRGB( texture2D( tDiffuse, uv ).rgb ), 1.0 );
	}

	void main() {
		vec4 curColor = sampleSRGB( vUv );
		vec2 dir = vec2( unit1280().x, 0.0 );
		float u_blurSize = blurSize();
		float u_centerMix = centerMix();

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
`;

const VERT_FS = /* glsl */ `
	precision highp float;
	uniform sampler2D tDiffuse;
	uniform sampler2D tFilter;
	uniform sampler2D tNoise;
	${PARAM_UNIFORMS}
	varying vec2 vUv;
	${TAP_WEIGHT}
	${SLIDER_REMAP}

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
		vec2 dir = vec2( 0.0, unit1280().y );
		float u_blurSize = blurSize();
		float u_centerMix = centerMix();

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
		resultColor = takeEffectFilter( tFilter, resultColor, getFilterIns() );
		float gray = dot( resultColor.rgb, vec3( 0.299, 0.587, 0.114 ) );
		resultColor.rgb = mix( resultColor.rgb, resultColor.rgb * noise, noiseIns() * gray );

		gl_FragColor = resultColor;
	}
`;

const BOKEH_FS = /* glsl */ `
	precision highp float;
	uniform sampler2D tDiffuse;
	${PARAM_UNIFORMS}
	varying vec2 vUv;

	#define PI 3.1415926
	${SLIDER_REMAP}

	vec2 rot( float angle, vec2 uv ) {
		float theta = angle * PI / 180.0;
		return uv * mat2( cos( theta ), - sin( theta ), sin( theta ), cos( theta ) );
	}

	void main() {
		vec4 curColor = texture2D( tDiffuse, vUv );
		if ( timeIntensity < 0.01 ) {
			gl_FragColor = curColor;
			return;
		}
		float amount = 40.0 + 0.9987 * 500.0;
		float u_blurIntensity = blurIntensity();
		float u_lightIns = lightIns();
		vec2 u_unit = unit720();
		vec4 resultColor = curColor;
		vec3 maxColor = vec3( 0.0 );
		vec3 sumWeight = vec3( 0.0 );
		vec3 sumColor = vec3( 0.0 );
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
`;

const OUTPUT_FS = /* glsl */ `
	precision highp float;
	uniform sampler2D tDiffuse;
	varying vec2 vUv;
	${SRGB_HELPERS}
	void main() {
		gl_FragColor = vec4( sRGBToLinear( texture2D( tDiffuse, vUv ).rgb ), 1.0 );
	}
`;

export function createBokehGlowCustomDefinition(
	urls: { filterUrl?: string; noiseUrl?: string } = {},
): CustomEffectDefinition {
	const filterUrl = urls.filterUrl || FILTER_URL;
	const noiseUrl = urls.noiseUrl || NOISE_URL;

	return {
		id: "bokeh-glow",
		name: "超级大光斑·配置",
		version: 1,
		params: [
			{
				key: "timeIntensity",
				type: "float",
				default: 1.0,
				min: 0,
				max: 1,
				step: 0.01,
				label: "Amount",
				labelZh: "光斑量",
				expose: true,
			},
			{
				key: "size",
				type: "float",
				default: 1.0,
				min: 0,
				max: 1,
				step: 0.01,
				label: "Size",
				labelZh: "作用范围",
				expose: true,
			},
			{
				key: "number",
				type: "float",
				default: 0.1,
				min: 0,
				max: 1,
				step: 0.01,
				label: "Number",
				labelZh: "数量",
				expose: true,
			},
			{
				key: "intensity",
				type: "float",
				default: 0.6,
				min: 0,
				max: 1,
				step: 0.01,
				label: "Intensity",
				labelZh: "强度",
				expose: true,
			},
			{
				// GLSL reserved word — cannot use param key `filter` as a uniform name.
				key: "filterIns",
				type: "float",
				default: 0.2,
				min: 0,
				max: 1,
				step: 0.01,
				label: "Filter",
				labelZh: "滤镜",
				expose: true,
			},
		],
		textures: [
			{
				name: "filterMap",
				source: "image",
				path: filterUrl,
				colorSpace: "none",
				flipY: false,
			},
			{
				name: "noiseMap",
				source: "image",
				path: noiseUrl,
				colorSpace: "none",
				flipY: false,
			},
		],
		passes: [
			{
				name: "horz",
				inputs: { tDiffuse: "uInput" },
				fragmentShader: HORZ_FS,
				output: { rt: "horz" },
			},
			{
				name: "vert",
				inputs: {
					tDiffuse: "$rt:horz",
					tFilter: "$tex:filterMap",
					tNoise: "$tex:noiseMap",
				},
				fragmentShader: VERT_FS,
				output: { rt: "vert" },
			},
			{
				name: "bokeh0",
				resolutionScale: 0.55,
				inputs: { tDiffuse: "$rt:vert" },
				fragmentShader: BOKEH_FS,
				output: { rt: "bokeh0" },
			},
			{
				name: "bokeh1",
				resolutionScale: 0.55,
				inputs: { tDiffuse: "$rt:bokeh0" },
				fragmentShader: BOKEH_FS,
				output: { rt: "bokeh1" },
			},
			{
				name: "output",
				inputs: { tDiffuse: "$rt:bokeh1" },
				fragmentShader: OUTPUT_FS,
			},
		],
	};
}

export const BOKEH_GLOW_CUSTOM = createBokehGlowCustomDefinition();
