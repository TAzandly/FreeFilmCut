/**
 * Built-in post-process effects for FreeFilmCut Editor.
 * Bloom = stock UnrealBloomPass; Deep Glow = JY Deep_Glow algorithm rewrite; Film + FXAA + Invert.
 *
 * Unified Registry: same effect types drive camera.postProcessStack AND fccUI.textFxStack
 * (texture-input composer). Descriptors default to inputs: camera + texture.
 */

import * as THREE from 'three';
import { FilmPass } from 'three/addons/postprocessing/FilmPass.js';
import { FXAAPass } from 'three/addons/postprocessing/FXAAPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { registerEffect, getEffectDescriptor } from './PostProcessRegistry.js?v=fcc-ui-124'; // MUST share the same ?v= as sidebars or registry Map splits
import { InvertColorPass } from './InvertColorPass.js?v=fcc-ui-111';
import { DeepGlowPass } from './DeepGlowPass.js?v=fcc-ui-112';
import { BokehGlowPass } from './BokehGlowPass.js';


function patchUnrealBloomAlpha( pass ) {

	if ( ! pass || pass.__fccAlphaPatched ) return;
	pass.__fccAlphaPatched = true;

	const blurReplace = 'gl_FragColor = vec4( diffuseSum, 1.0 );';
	const blurFixed = [
		'float srcA = texture2D( colorTexture, vUv ).a;',
		'gl_FragColor = vec4( diffuseSum, srcA );',
	].join( '\n\t\t\t\t\t' );

	if ( pass.separableBlurMaterials ) {
		for ( let i = 0; i < pass.separableBlurMaterials.length; i ++ ) {
			const m = pass.separableBlurMaterials[ i ];
			if ( m.fragmentShader && m.fragmentShader.indexOf( blurReplace ) !== - 1 ) {
				m.fragmentShader = m.fragmentShader.replace( blurReplace, blurFixed );
				m.needsUpdate = true;
			}
			m.toneMapped = false;
		}
	}

	// Composite: bloomAlpha from rgb is fine for empty (0); keep as-is.
	// Soften: multiply bloom alpha by coverage so empty stays 0 (already).
	if ( pass.compositeMaterial && pass.compositeMaterial.fragmentShader ) {
		const c = pass.compositeMaterial;
		const bad = 'float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );\n\t\t\t\t\tgl_FragColor = vec4( bloom, bloomAlpha );';
		const good = [
			'float bloomAlpha = max( bloom.r, max( bloom.g, bloom.b ) );',
			// Keep a=0 when no bloom energy (transparent Default bg).
			'gl_FragColor = vec4( bloom, bloomAlpha );',
		].join( '\n\t\t\t\t\t' );
		// no structural change needed if blur preserves a and empty rgb=0
		c.toneMapped = false;
	}

	if ( pass.materialHighPassFilter ) pass.materialHighPassFilter.toneMapped = false;
	if ( pass.blendMaterial ) {
		pass.blendMaterial.toneMapped = false;
		// Additive premultiplied: zero bloom must not lift dst alpha incorrectly.
		// CopyShader outputs bloom texel; empty is (0,0,0,0) after our blur/composite.
	}
	if ( pass._basic ) pass._basic.toneMapped = false;

}

let registered = false;


/** Parse Deep Glow tint: '#rrggbb' | [r,g,b] 0..1 | {r,g,b}. Default white. */
function parseGlowColor( v, target ) {

	const out = target || new THREE.Vector3( 1, 1, 1 );
	if ( v == null ) {
		out.set( 1, 1, 1 );
		return out;
	}
	if ( typeof v === 'string' ) {
		let hex = v.trim();
		if ( hex.charAt( 0 ) === '#' ) hex = hex.slice( 1 );
		if ( hex.length === 3 ) {
			hex = hex[ 0 ] + hex[ 0 ] + hex[ 1 ] + hex[ 1 ] + hex[ 2 ] + hex[ 2 ];
		}
		const n = parseInt( hex, 16 );
		if ( Number.isFinite( n ) ) {
			out.set(
				( ( n >> 16 ) & 255 ) / 255,
				( ( n >> 8 ) & 255 ) / 255,
				( n & 255 ) / 255,
			);
			return out;
		}
	}
	if ( Array.isArray( v ) && v.length >= 3 ) {
		out.set( Number( v[ 0 ] ) || 0, Number( v[ 1 ] ) || 0, Number( v[ 2 ] ) || 0 );
		return out;
	}
	if ( typeof v === 'object' ) {
		const r = v.r != null ? v.r : v.x;
		const g = v.g != null ? v.g : v.y;
		const b = v.b != null ? v.b : v.z;
		if ( r != null && g != null && b != null ) {
			out.set( Number( r ), Number( g ), Number( b ) );
			return out;
		}
	}
	out.set( 1, 1, 1 );
	return out;
}

export function registerBuiltinEffects() {

	// Re-run if this module stayed cached while PostProcessRegistry.js reloaded
	// under a new ?v= (empty Map) — otherwise bloom/etc. look "missing".
	if ( registered && getEffectDescriptor( 'bloom' ) ) return;
	registered = true;

	registerEffect( 'bloom', {
		label: 'Bloom',
		labelZh: '泛光 Bloom',
		createDefaultParams() {
			return {
				strength: 2.0,
				radius: 0.5,
				threshold: 0.0,
			};
		},
		createPasses( ctx ) {
			const pass = new UnrealBloomPass(
				new THREE.Vector2( Math.max( 1, ctx.width ), Math.max( 1, ctx.height ) ),
				2.0,
				0.5,
				0.0,
			);
			pass.needsSwap = false;
			patchUnrealBloomAlpha( pass );
			return [ pass ];
		},
		applyParams( passes, params ) {
			const pass = passes[ 0 ];
			if ( ! pass ) return;
			const strength = params.strength !== undefined ? Number( params.strength ) : 2.0;
			const radius = params.radius !== undefined ? Number( params.radius ) : 0.5;
			const threshold = params.threshold !== undefined ? Number( params.threshold ) : 0.0;
			pass.strength = strength;
			pass.radius = radius;
			pass.threshold = threshold;
			pass.needsSwap = false;
			// blurIterations removed — ignore if old packs/stacks still carry it
		},
		paramSchema: [
			{ key: 'threshold', label: 'Threshold', labelZh: '阈值', min: 0, max: 1, step: 0.01 },
			{ key: 'strength', label: 'Strength', labelZh: '强度', min: 0, max: 5, step: 0.01 },
			{ key: 'radius', label: 'Radius', labelZh: '半径', min: 0, max: 1, step: 0.01 },
		],
	} );

	registerEffect( 'deepGlow', {
		label: 'Deep Glow',
		labelZh: '深发光 Deep Glow',
		inputs: [ 'camera', 'texture' ],
		createDefaultParams() {
			return {
				intensity: 1.2,
				threshold: 0.0,
				radius: 1.0,
				color: '#ffffff',
			};
		},
		createPasses( ctx ) {
			const pass = new DeepGlowPass(
				new THREE.Vector2( Math.max( 1, ctx.width ), Math.max( 1, ctx.height ) ),
				1.2,
				0.0,
				1.0,
			);
			return [ pass ];
		},
		applyParams( passes, params ) {
			const pass = passes[ 0 ];
			if ( ! pass ) return;
			if ( params.intensity !== undefined ) pass.intensity = Number( params.intensity );
			if ( params.threshold !== undefined ) pass.threshold = Number( params.threshold );
			if ( params.radius !== undefined ) pass.radius = Number( params.radius );
			if ( params.color !== undefined && pass.glowColor ) {
				parseGlowColor( params.color, pass.glowColor );
			}
		},
		paramSchema: [
			{ key: 'intensity', label: 'Intensity', labelZh: '强度', min: 0, max: 5, step: 0.01 },
			{ key: 'threshold', label: 'Threshold', labelZh: '阈值', min: 0, max: 1, step: 0.01 },
			{ key: 'radius', label: 'Radius', labelZh: '光晕范围', min: 0.1, max: 8, step: 0.01 },
			{ key: 'color', label: 'Glow Color', labelZh: '发光颜色', type: 'color' },
		],
	} );

	registerEffect( 'bokehGlow', {
		label: 'Bokeh Glow',
		labelZh: '超级大光斑',
		inputs: [ 'camera', 'texture' ],
		createDefaultParams() {
			return {
				size: 1.0,
				number: 0.1,
				intensity: 0.6,
				filter: 0.2,
				timeIntensity: 1.0,
			};
		},
		createPasses( ctx ) {
			const pass = new BokehGlowPass(
				new THREE.Vector2( Math.max( 1, ctx.width ), Math.max( 1, ctx.height ) ),
			);
			return [ pass ];
		},
		applyParams( passes, params ) {
			const pass = passes[ 0 ];
			if ( ! pass ) return;
			// ImageBusinessSlider.lua remaps: size→blurIntensity/numIntensity,
			// number→noiseIns/blurIns/horzR, intensity→lightIns, filter→filterIns.
			// timeIntensity = CapCut SeekModeScript envelope (0=无光斑, 1=满光斑).
			// Clamped to the 0..1 UI range the sliders use.
			if ( params.size !== undefined ) {
				pass.size = Math.min( 1, Math.max( 0, Number( params.size ) || 0 ) );
			}
			if ( params.number !== undefined ) {
				pass.number = Math.min( 1, Math.max( 0, Number( params.number ) || 0 ) );
			}
			if ( params.intensity !== undefined ) {
				pass.intensity = Math.min( 1, Math.max( 0, Number( params.intensity ) || 0 ) );
			}
			if ( params.filter !== undefined ) {
				pass.filter = Math.min( 1, Math.max( 0, Number( params.filter ) || 0 ) );
			}
			if ( params.timeIntensity !== undefined ) {
				pass.timeIntensity = Math.min( 1, Math.max( 0, Number( params.timeIntensity ) || 0 ) );
			}
		},
		paramSchema: [
			{ key: 'timeIntensity', label: 'Amount', labelZh: '光斑量', min: 0, max: 1, step: 0.01 },
			{ key: 'size', label: 'Size', labelZh: '作用范围', min: 0, max: 1, step: 0.01 },
			{ key: 'number', label: 'Number', labelZh: '数量', min: 0, max: 1, step: 0.01 },
			{ key: 'intensity', label: 'Intensity', labelZh: '强度', min: 0, max: 1, step: 0.01 },
			{ key: 'filter', label: 'Filter', labelZh: '滤镜', min: 0, max: 1, step: 0.01 },
		],
	} );

	registerEffect( 'film', {
		label: 'Film Grain',
		labelZh: '胶片颗粒',
		createDefaultParams() {
			return { intensity: 0.35, grayscale: false };
		},
		createPasses() {
			return [ new FilmPass( 0.35, false ) ];
		},
		applyParams( passes, params ) {
			const pass = passes[ 0 ];
			if ( ! pass || ! pass.uniforms ) return;
			if ( params.intensity !== undefined ) pass.uniforms.intensity.value = params.intensity;
			if ( params.grayscale !== undefined ) pass.uniforms.grayscale.value = !! params.grayscale;
		},
		paramSchema: [
			{ key: 'intensity', label: 'Intensity', labelZh: '强度', min: 0, max: 1, step: 0.01 },
			{ key: 'grayscale', label: 'Grayscale', labelZh: '灰度', type: 'boolean' },
		],
	} );

	registerEffect( 'invert', {
		label: 'Color Invert',
		labelZh: '颜色反转',
		createDefaultParams() {
			return { intensity: 1.0 };
		},
		createPasses() {
			return [ new InvertColorPass( 1.0 ) ];
		},
		applyParams( passes, params ) {
			const pass = passes[ 0 ];
			if ( ! pass || ! pass.uniforms ) return;
			if ( params.intensity !== undefined ) {
				pass.uniforms.intensity.value = Math.max( 0, Math.min( 1, Number( params.intensity ) ) );
			}
		},
		paramSchema: [
			{ key: 'intensity', label: 'Mix', labelZh: '混合强度', min: 0, max: 1, step: 0.01 },
		],
	} );

	registerEffect( 'fxaa', {
		label: 'FXAA',
		labelZh: 'FXAA 抗锯齿',
		createDefaultParams() {
			return {};
		},
		createPasses() {
			return [ new FXAAPass() ];
		},
		applyParams() {},
		paramSchema: [],
	} );

}
