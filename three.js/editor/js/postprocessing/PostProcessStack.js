/**
 * Builds / rebuilds a Three.js EffectComposer from camera.userData.postProcessStack.
 *
 * Chain: RenderPass(scene) → effect passes… → OutputPass (tone map / color space)
 * FXAA (if present) is placed AFTER OutputPass because it expects sRGB input.
 *
 * Bloom needs LINEAR input from RenderPass. We force NoToneMapping for the beauty/bloom
 * stages and only apply the project's tone mapping inside OutputPass (see outputPass wrap).
 *
 * When OutputPass toneMapping is NoToneMapping (authoring "none"), insert an LDR clamp
 * pass immediately before bloom/deepGlow so wipe edgeIntensity etc. cannot create HDR
 * spikes that explode UnrealBloom. Neutral/ACES packs keep full HDR bloom (no clamp).
 *
 * Structure changes (effect list / order / enable / size) → full rebuild.
 * Param tweaks (threshold / strength / …) → applyParams on live passes (no rebuild).
 */

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

import {
	getEffectDescriptor,
	stackHasEnabledEffects as stackHasEnabledEffectsRaw,
	stackDataHasEnabledEffects as stackDataHasEnabledEffectsRaw,
	normalizeEffectStack,
} from './PostProcessRegistry.js?v=fcc-ui-124';
import { registerBuiltinEffects } from './BuiltinEffects.js?v=fcc-ui-124';
import {
	registerCustomEffectsFromStackData,
	definitionFingerprint,
	migrateEntryTextureBindings,
} from './CustomEffectRuntime.js?v=fcc-ui-231';
import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

/**
 * Register custom:<id> defs from the stack, then query the registry.
 * Viewport gates the whole PP path on this — must not return false for a
 * custom-only stack just because descriptors were not registered yet.
 */
export function stackDataHasEnabledEffects( stack ) {

	registerCustomEffectsFromStackData( stack );
	return stackDataHasEnabledEffectsRaw( stack );

}

export function stackHasEnabledEffects( camera ) {

	const stack = camera && camera.userData && camera.userData.postProcessStack;
	return stackDataHasEnabledEffects( stack );

}

/**
 * Straight-alpha copy into EffectComposer readBuffer (no TexturePass premultipliedAlpha).
 * Text RT must keep transparent padding as a=0.
 */
class TextFxInputPass extends Pass {

	constructor( map ) {

		super();
		this.map = map;
		this.needsSwap = false;
		this.clear = true;
		this.uniforms = {
			tDiffuse: { value: null },
		};
		this.material = new THREE.ShaderMaterial( {
			name: 'TextFxInputPass',
			uniforms: this.uniforms,
			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4( position.xy, 0.0, 1.0 );
				}
			`,
			fragmentShader: /* glsl */`
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					gl_FragColor = texture2D( tDiffuse, vUv );
				}
			`,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
			transparent: false,
			blending: THREE.NoBlending,
		} );
		this._fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer ) {

		this.uniforms.tDiffuse.value = this.map;
		renderer.setRenderTarget( this.renderToScreen ? null : readBuffer );
		if ( this.clear ) {

			renderer.setClearColor( 0x000000, 0 );
			renderer.clear( true, true, true );

		}

		this._fsQuad.render( renderer );

	}

	dispose() {

		this.material.dispose();
		this._fsQuad.dispose();

	}

}



/**
 * Clamp beauty RGB to [0,1] before UnrealBloom / DeepGlow when OutputPass is NoToneMapping.
 * Enables none+Bloom authoring without Neutral remap: LDR bloom, OutputPass only sRGB.
 */
class LdrPreBloomClampPass extends Pass {

	constructor() {

		super();
		this.needsSwap = true;
		this.uniforms = {
			tDiffuse: { value: null },
		};
		this.material = new THREE.ShaderMaterial( {
			name: 'LdrPreBloomClampPass',
			uniforms: this.uniforms,
			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4( position.xy, 0.0, 1.0 );
				}
			`,
			fragmentShader: /* glsl */`
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					vec4 c = texture2D( tDiffuse, vUv );
					// Hard clamp: [0,1] unchanged; HDR peaks (wipe blade) -> LDR for bloom.
					gl_FragColor = vec4( clamp( c.rgb, 0.0, 1.0 ), c.a );
				}
			`,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
			transparent: false,
			blending: THREE.NoBlending,
		} );
		this._fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer /*, deltaTime, maskActive */ ) {

		this.uniforms.tDiffuse.value = readBuffer.texture;
		renderer.setRenderTarget( this.renderToScreen ? null : writeBuffer );
		this._fsQuad.render( renderer );

	}

	dispose() {

		this.material.dispose();
		this._fsQuad.dispose();

	}

}

/**
 * Captures the raw camera beauty right after RenderPass into a dedicated RT so
 * custom-effect passes can bind it via the '$camera' reserved source — even
 * when the effect sits after other effects (uInput would be the chain input).
 */
class BeautyCapturePass extends Pass {

	constructor( rt ) {

		super();
		this.rt = rt;
		this.needsSwap = false;
		this.uniforms = {
			tDiffuse: { value: null },
		};
		this.material = new THREE.ShaderMaterial( {
			name: 'FccBeautyCapture',
			uniforms: this.uniforms,
			vertexShader: /* glsl */`
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4( position.xy, 0.0, 1.0 );
				}
			`,
			fragmentShader: /* glsl */`
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					gl_FragColor = texture2D( tDiffuse, vUv );
				}
			`,
			depthTest: false,
			depthWrite: false,
			toneMapped: false,
			transparent: false,
			blending: THREE.NoBlending,
		} );
		this._fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer ) {

		this.uniforms.tDiffuse.value = readBuffer.texture;
		renderer.setRenderTarget( this.rt );
		this._fsQuad.render( renderer );

	}

	setSize( width, height ) {

		this.rt.setSize( Math.max( 1, Math.floor( width ) ), Math.max( 1, Math.floor( height ) ) );

	}

	dispose() {

		this.material.dispose();
		this._fsQuad.dispose();

	}

}

registerBuiltinEffects();

/**
 * One-shot migration of the old FreeFilmCut bloom default threshold 0.85.
 * Never re-clamp user values on every apply/rebuild.
 */
function migrateBloomParamsOnce( stack ) {

	if ( ! stack || stack._bloomThresholdMigrated ) return;
	stack._bloomThresholdMigrated = true;

	for ( const entry of stack.effects || [] ) {

		if ( ! entry || entry.type !== 'bloom' ) continue;
		if ( ! entry.params || typeof entry.params !== 'object' ) entry.params = {};
		const th = entry.params.threshold;
		// Only the historical default (and missing) — not every value >= 0.8
		if ( th === undefined || th === null || Number( th ) === 0.85 ) {

			entry.params.threshold = 0.0;

		}

		// blurIterations removed from Bloom — drop stale pack/editor params
		if ( 'blurIterations' in entry.params ) delete entry.params.blurIterations;

		if ( entry.params.strength === undefined || entry.params.strength === null ) {

			entry.params.strength = 1.5;

		}

	}

}

/** Structure only — effect identity / enable / order / size / custom def content. Params excluded. */
function structureSignature( stack, w, h, outputToneMapping, outputExposure ) {

	return JSON.stringify( {
		w, h,
		enabled: stack.enabled,
		effects: ( stack.effects || [] ).map( ( e ) => ( {
			id: e.id, type: e.type, enabled: e.enabled !== false,
			// custom effects: definition content participates (shader edits must rebuild)
			def: e.definition ? definitionFingerprint( e.definition ) : 0,
		} ) ),
		outputToneMapping,
		outputExposure,
	} );

}

function paramsSignature( stack ) {

	return JSON.stringify(
		( stack.effects || [] ).map( ( e ) => ( {
			id: e.id, params: e.params || {},
		} ) ),
	);

}

/**
 * Push current stack params onto live passes (no composer rebuild).
 * @returns {boolean} true if params were applied
 */
export function syncComposerParams( built, camera ) {

	if ( ! built || ! built.bindings || ! camera ) return false;
	const stack = camera.userData && camera.userData.postProcessStack;
	if ( ! stack ) return false;

	const nextParamsSig = paramsSignature( stack );
	if ( built.paramsSignature === nextParamsSig ) return false;

	for ( const binding of built.bindings ) {

		const entry = ( stack.effects || [] ).find( ( e ) => e && e.id === binding.entryId );
		if ( ! entry || entry.enabled === false ) continue;
		const desc = getEffectDescriptor( binding.type );
		if ( ! desc || typeof desc.applyParams !== 'function' ) continue;
		const params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
		desc.applyParams( binding.passes, params );

	}

	built.paramsSignature = nextParamsSig;
	return true;

}

/**
 * CapCut SeekModeScript envelope: timeIntensity = amount * (1-progress)^4.
 * Call after syncComposerParams while a timeline owns the playhead so viewport
 * play and hover-GIF export share the 满光斑→无光斑 fade.
 *
 * @param {object} built from buildComposerForCamera
 * @param {object} camera
 * @param {number} progress01 timeline t / duration in [0,1]
 * @returns {boolean} true if any bokeh pass was updated
 */
export function applyBokehSeekEnvelope( built, camera, progress01 ) {

	if ( ! built || ! built.bindings || ! camera ) return false;
	const p = Math.min( 1, Math.max( 0, Number( progress01 ) || 0 ) );
	const env = Math.pow( 1 - p, 4 );
	const stack = camera.userData && camera.userData.postProcessStack;
	const effects = ( stack && stack.effects ) || [];
	let hit = false;

	for ( const binding of built.bindings ) {

		const entry = effects.find( ( e ) => e && e.id === binding.entryId );
		if ( ! entry || entry.enabled === false ) continue;
		const type = entry.type || binding.type || '';
		if ( type !== 'bokehGlow' && type !== 'custom:bokeh-glow' ) continue;

		const base = entry.params && entry.params.timeIntensity !== undefined
			? Number( entry.params.timeIntensity )
			: 1;
		const v = Math.min( 1, Math.max( 0, ( Number.isFinite( base ) ? base : 1 ) * env ) );

		for ( const pass of binding.passes || [] ) {

			if ( ! pass ) continue;
			if ( 'timeIntensity' in pass ) pass.timeIntensity = v;
			if ( pass.uniforms && pass.uniforms.timeIntensity ) {

				pass.uniforms.timeIntensity.value = v;

			}
			hit = true;

		}

	}

	return hit;

}

/**
 * @returns {{ composer: EffectComposer, dispose: function, signature: string, paramsSignature: string, bindings: Array, outputToneMapping: number, outputExposure: number } | null }
 */
export function buildComposerForCamera( {
	renderer,
	scene,
	camera,
	width,
	height,
} ) {

	if ( ! renderer || ! scene || ! camera ) return null;

	const stack = camera.userData.postProcessStack;
	// Custom ('custom:<id>') must be registered BEFORE stackHasEnabledEffects —
	// otherwise a custom-only stack looks empty and we return null (never register).
	registerCustomEffectsFromStackData( stack );
	if ( ! stackHasEnabledEffects( camera ) ) return null;
	const w = Math.max( 1, Math.floor( width ) );
	const h = Math.max( 1, Math.floor( height ) );

	migrateBloomParamsOnce( stack );

	// Tone mapping applied ONLY in OutputPass, and only the project's setting.
	// NoToneMapping stays NoToneMapping: the pass still does the sRGB encode.
	// Forcing a filmic curve here changed the picture as soon as any effect was enabled.
	const outputToneMapping = renderer.toneMapping;
	const outputExposure = renderer.toneMappingExposure;

	const composer = new EffectComposer( renderer );
	composer.setSize( w, h );
	// Project/safe-frame pixel size already — do not multiply by devicePixelRatio again
	// (that blew RTs to 2x/3x and desynced bloom kernels from OpenCut).
	composer.setPixelRatio( 1 );

	const renderPass = new RenderPass( scene, camera );
	composer.addPass( renderPass );

	// '$camera' support: when any enabled custom effect references it, capture
	// the raw beauty immediately after RenderPass (cheap one copy, only on use).
	let beautyRT = null;
	const customUsesCamera = ( stack.effects || [] ).some( ( e ) =>

		e && e.enabled !== false && typeof e.type === 'string' && e.type.indexOf( 'custom:' ) === 0 &&
		e.definition && Array.isArray( e.definition.passes ) &&
		e.definition.passes.some( ( p ) => p && p.inputs && Object.values( p.inputs ).indexOf( '$camera' ) !== - 1 )

	);
	if ( customUsesCamera ) {

		beautyRT = new THREE.WebGLRenderTarget( w, h, {
			type: THREE.HalfFloatType,
			format: THREE.RGBAFormat,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			depthBuffer: false,
			stencilBuffer: false,
		} );
		beautyRT.texture.colorSpace = THREE.NoColorSpace;
		beautyRT.texture.generateMipmaps = false;
		beautyRT.texture.name = 'FccCameraBeauty';
		composer.addPass( new BeautyCapturePass( beautyRT ) );

	}

	const latePasses = []; // e.g. FXAA after OutputPass
	const bindings = [];
	const ctx = { THREE, width: w, height: h, scene, camera, renderer };
	if ( beautyRT ) ctx.__fccBeautyTexture = beautyRT.texture;
	// none => LDR bloom: clamp beauty before first bloom/deepGlow (HDR packs skip).
	const useLdrBloom = outputToneMapping === THREE.NoToneMapping;
	let ldrClampInserted = false;

	for ( const entry of stack.effects ) {

		if ( ! entry || entry.enabled === false ) continue;
		const desc = getEffectDescriptor( entry.type );
		if ( ! desc ) continue;

		// Custom effects: migrate legacy inline rtUuid → entry.textureBindings
		// and expose the scene-instance bindings to createPasses via ctx (the
		// per-frame resolution closure keeps the object reference).
		if ( typeof entry.type === 'string' && entry.type.startsWith( 'custom:' ) && typeof migrateEntryTextureBindings === 'function' ) {

			migrateEntryTextureBindings( entry );
			ctx.__fccTextureBindings = entry.textureBindings || {};

		}

		const params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
		const passes = desc.createPasses( ctx ) || [];
		if ( typeof desc.applyParams === 'function' ) {

			desc.applyParams( passes, params );

		}

		bindings.push( { entryId: entry.id, type: entry.type, passes } );

		for ( const pass of passes ) {

			pass.enabled = true;
			if ( entry.type === 'fxaa' ) {

				latePasses.push( { pass, entry, desc, params } );

			} else {

				if ( useLdrBloom && ! ldrClampInserted && ( entry.type === 'bloom' || entry.type === 'deepGlow' ) ) {

					composer.addPass( new LdrPreBloomClampPass() );
					ldrClampInserted = true;

				}

				composer.addPass( pass );

			}

		}

	}

	const outputPass = new OutputPass();
	// Transparent BeautyClear (Default): OutputPass must REPLACE writeBuffer.
	// Stock NormalBlending + clear=false leaves opaque black in empty (a=0) pixels.
	if ( outputPass.material ) {
		outputPass.material.blending = THREE.NoBlending;
		outputPass.material.transparent = false;
		outputPass.material.depthTest = false;
		outputPass.material.depthWrite = false;
	}
	const _outputRender = outputPass.render.bind( outputPass );
	outputPass.render = function ( renderer, writeBuffer, readBuffer, deltaTime, maskActive ) {

		const prevTM = renderer.toneMapping;
		const prevExp = renderer.toneMappingExposure;
		renderer.toneMapping = outputToneMapping;
		renderer.toneMappingExposure = outputExposure;
		_outputRender( renderer, writeBuffer, readBuffer, deltaTime, maskActive );
		renderer.toneMapping = prevTM;
		renderer.toneMappingExposure = prevExp;

	};
	composer.addPass( outputPass );

	for ( const late of latePasses ) {

		if ( typeof late.pass.setSize === 'function' ) {

			late.pass.setSize( w, h );

		}

		composer.addPass( late.pass );

	}

	const signature = structureSignature( stack, w, h, outputToneMapping, outputExposure );
	const pSig = paramsSignature( stack );

	if ( typeof window !== 'undefined' && window.__FREECAPCUT_DEBUG_POSTPROCESS__ ) {

		console.warn( '[FreeFilmCut postprocess] built', {
			camera: camera.name,
			uuid: camera.uuid,
			size: w + 'x' + h,
			outputToneMapping,
			outputExposure,
			effects: ( stack.effects || [] ).filter( ( e ) => e && e.enabled !== false ).map( ( e ) => e.type + ':' + JSON.stringify( e.params || {} ) ),
		} );

	}

	return {
		composer,
		signature,
		paramsSignature: pSig,
		bindings,
		outputToneMapping,
		outputExposure,
		dispose() {

			try {

				composer.dispose();

			} catch ( e ) {

				/* ignore */

			}

			if ( beautyRT ) {

				try {

					beautyRT.dispose();

				} catch ( e ) {

					/* ignore */

				}

			}

		},
	};

}

/** True when effect list / order / enable / size / camera tone mapping changed. */
export function needsComposerRebuild( built, camera, width, height, renderer ) {

	if ( ! built ) return true;
	const stack = camera.userData && camera.userData.postProcessStack;
	registerCustomEffectsFromStackData( stack );
	if ( ! stackHasEnabledEffects( camera ) ) return true;
	const w = Math.max( 1, Math.floor( width ) );
	const h = Math.max( 1, Math.floor( height ) );
	const toneMapping = renderer ? renderer.toneMapping : built.outputToneMapping;
	const exposure = renderer ? renderer.toneMappingExposure : built.outputExposure;
	const signature = structureSignature( stack, w, h, toneMapping, exposure );
	return built.signature !== signature;

}


/**
 * Texture-input EffectComposer from the SAME registry as camera PP.
 * Chain: TexturePass(input) → effect passes… → (optional OutputPass)
 *
 * Used by Text → RT → Fx → blit. Do NOT route per-text FX through camera stack.
 *
 * Text RT is typically sRGB8+stencil already composited; skip OutputPass by default
 * to preserve alpha and avoid a second tone-map/encode. Bloom on LDR text is
 * "reasonable" not HDR-accurate (registry id/params still shared with camera).
 *
 * @returns {{ composer: EffectComposer, dispose: function, signature: string, bindings: Array, getOutputTexture: function } | null}
 */
export function buildTextureFxComposer( {
	renderer,
	inputTexture,
	width,
	height,
	stack,
	includeOutputPass = false,
} ) {

	if ( ! renderer || ! inputTexture ) return null;
	const normalized = normalizeEffectStack( stack );
	registerCustomEffectsFromStackData( normalized );
	if ( ! stackDataHasEnabledEffects( normalized ) ) return null;

	const w = Math.max( 1, Math.floor( width ) );
	const h = Math.max( 1, Math.floor( height ) );

	migrateBloomParamsOnce( normalized );

	// Raw bytes through the chain — avoid sRGB decode/encode on every pass (washes Invert).
	// HalfFloat: UnrealBloom soft falloff bands hard in UnsignedByte ping-pong.
	const rtParams = {
		type: THREE.HalfFloatType,
		format: THREE.RGBAFormat,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		depthBuffer: false,
		stencilBuffer: false,
	};
	const rt = new THREE.WebGLRenderTarget( w, h, rtParams );
	rt.texture.colorSpace = THREE.NoColorSpace;
	rt.texture.flipY = false;
	rt.texture.generateMipmaps = false;
	rt.texture.name = 'FreeFilmCut.TextFxComposer';

	const composer = new EffectComposer( renderer, rt );
	composer.setSize( w, h );
	composer.setPixelRatio( 1 );
	// clone() may not keep NoColorSpace on some three versions
	if ( composer.renderTarget2 && composer.renderTarget2.texture ) {

		composer.renderTarget2.texture.colorSpace = THREE.NoColorSpace;
		composer.renderTarget2.texture.flipY = false;
		composer.renderTarget2.texture.generateMipmaps = false;

	}

	const inputPass = new TextFxInputPass( inputTexture );
	composer.addPass( inputPass );

	const latePasses = [];
	const bindings = [];
	const ctx = {
		THREE,
		width: w,
		height: h,
		renderer,
		input: 'texture',
		scene: null,
		camera: null,
		// '$camera' in a texture-FX chain = the input texture itself
		__fccBeautyTexture: inputTexture,
	};

	for ( const entry of normalized.effects ) {

		if ( ! entry || entry.enabled === false ) continue;
		const desc = getEffectDescriptor( entry.type );
		if ( ! desc ) continue;
		if ( desc.inputs && desc.inputs.indexOf( 'texture' ) === - 1 ) continue;

		if ( typeof entry.type === 'string' && entry.type.startsWith( 'custom:' ) ) {

			migrateEntryTextureBindings( entry );
			ctx.__fccTextureBindings = entry.textureBindings || {};

		}

		const params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
		const passes = desc.createPasses( ctx ) || [];
		if ( typeof desc.applyParams === 'function' ) {

			desc.applyParams( passes, params );

		}

		bindings.push( { entryId: entry.id, type: entry.type, passes } );

		for ( const pass of passes ) {

			pass.enabled = true;
			// Force shader materials off tone-map for text LDR path
			if ( pass.material ) pass.material.toneMapped = false;
			if ( entry.type === 'fxaa' && includeOutputPass ) {

				latePasses.push( pass );

			} else {

				composer.addPass( pass );

			}

		}

	}

	if ( includeOutputPass ) {

		const outputPass = new OutputPass();
	// Transparent BeautyClear (Default): OutputPass must REPLACE writeBuffer.
	// Stock NormalBlending + clear=false leaves opaque black in empty (a=0) pixels.
	if ( outputPass.material ) {
		outputPass.material.blending = THREE.NoBlending;
		outputPass.material.transparent = false;
		outputPass.material.depthTest = false;
		outputPass.material.depthWrite = false;
	}
		composer.addPass( outputPass );
		for ( const pass of latePasses ) composer.addPass( pass );

	}

	for ( const pass of composer.passes ) {

		pass.renderToScreen = false;

	}

	const signature = structureSignature( normalized, w, h, - 1, - 1 );

	return {
		composer,
		signature,
		bindings,
		inputPass,
		stack: normalized,
		getOutputTexture() {

			const tex = composer.readBuffer && composer.readBuffer.texture
				? composer.readBuffer.texture
				: null;
			if ( tex ) {

				// Blit path expects one sRGB decode onto the canvas.
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.flipY = false;

			}

			return tex;

		},
		dispose() {

			try {

				composer.dispose();

			} catch ( e ) {

				/* ignore */

			}

			try {

				rt.dispose();

			} catch ( e ) {

				/* ignore */

			}

			try {

				inputPass.dispose();

			} catch ( e ) {

				/* ignore */

			}

		},
	};

}

/**
 * Run texture FX once; returns output texture or inputTexture if no FX.
 */
export function renderTextureFx( args ) {

	const renderer = args.renderer;
	const inputTexture = args.inputTexture;
	const stack = args.stack;
	const w = args.width;
	const h = args.height;
	if ( ! renderer || ! inputTexture ) return inputTexture;
	if ( ! stackDataHasEnabledEffects( stack ) ) return inputTexture;

	const nextSig = structureSignature( normalizeEffectStack( stack ), Math.floor( w ), Math.floor( h ), - 1, - 1 );
	let built = args.cache && args.cache.built;

	const prevInputCS = inputTexture.colorSpace;

	if ( ! built || built.signature !== nextSig ) {

		if ( built && typeof built.dispose === 'function' ) built.dispose();
		built = buildTextureFxComposer( {
			renderer,
			inputTexture,
			width: w,
			height: h,
			stack,
			includeOutputPass: false,
		} );
		if ( args.cache ) args.cache.built = built;

	} else {

		built.inputPass.map = inputTexture;
		for ( const binding of built.bindings || [] ) {

			const entry = ( stack.effects || [] ).find( ( e ) => e && e.id === binding.entryId );
			if ( ! entry || entry.enabled === false ) continue;
			const desc = getEffectDescriptor( binding.type );
			if ( ! desc || typeof desc.applyParams !== 'function' ) continue;
			const params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
			desc.applyParams( binding.passes, params );

		}

	}

	if ( ! built ) return inputTexture;

	// Sample text RT as raw bytes (already encoded for display).
	inputTexture.colorSpace = THREE.NoColorSpace;

	const prevTM = renderer.toneMapping;
	const prevAuto = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.autoClear = false;
	renderer.setClearColor( 0x000000, 0 );

	built.composer.render();

	renderer.toneMapping = prevTM;
	renderer.autoClear = prevAuto;
	renderer.setClearColor( prevClear, prevAlpha );
	inputTexture.colorSpace = prevInputCS;

	const out = built.getOutputTexture();
	return out || inputTexture;

}
