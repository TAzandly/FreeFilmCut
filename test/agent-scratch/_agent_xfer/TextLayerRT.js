/**
 * Editor Text layer → WebGLRenderTarget → shared Registry Fx → blit.
 * Aligns with OpenCut vfxpack/text-layer-rt (same registry types as camera PP).
 *
 * Step-1: RT + composite.
 * Step-2: TextFxStack (fccUI.textFxStack) runs via buildTextureFxComposer /
 * renderTextureFx AFTER full Troika/Flower stencil composite.
 * Do NOT put per-text FX on camera.postProcessStack.
 *
 * Text-scope bend / wipeReveal are NOT here: they run inside the Troika
 * materials (TextGeomFx.js), so this RT only carries TextFx.
 */

import * as THREE from 'three';
import {
	renderTextureFx,
	stackDataHasEnabledEffects,
} from '../postprocessing/PostProcessStack.js?v=fcc-ui-163';
import { shouldReuseTextLayerRtSize } from './TextLayerAabb.js?v=fcc-ui-164';
import { registerBuiltinEffects } from '../postprocessing/BuiltinEffects.js?v=fcc-ui-112';

registerBuiltinEffects();


/** @type {THREE.WebGLRenderTarget|null} */
let pooledTarget = null;

/** @type {THREE.ShaderMaterial|null} */
let blitMat = null;
/** @type {THREE.Mesh|null} */
let blitMesh = null;
/** @type {THREE.OrthographicCamera|null} */
let blitCam = null;
/** @type {THREE.Scene|null} */
let blitScene = null;

/** Mutable cache for renderTextureFx composer. */
const fxCache = { built: null };


/**
 * @param {number} width
 * @param {number} height
 * @returns {THREE.WebGLRenderTarget}
 */
export function ensureTextLayerRenderTarget( width, height, opts ) {

	const w = Math.max( 1, Math.round( width ) );
	const h = Math.max( 1, Math.round( height ) );
	const fit = !!( opts && opts.fit );
	if ( pooledTarget && pooledTarget.texture.type === THREE.HalfFloatType ) {

		if ( ! fit && pooledTarget.width === w && pooledTarget.height === h ) return pooledTarget;
		if ( fit && shouldReuseTextLayerRtSize( pooledTarget.width, pooledTarget.height, w, h ) ) return pooledTarget;

	}

	if ( pooledTarget ) pooledTarget.dispose();

	pooledTarget = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.HalfFloatType,
		format: THREE.RGBAFormat,
		depthBuffer: true,
		stencilBuffer: true,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	} );
	pooledTarget.texture.colorSpace = THREE.SRGBColorSpace;
	pooledTarget.texture.flipY = false;
	pooledTarget.texture.generateMipmaps = false;
	pooledTarget.texture.minFilter = THREE.LinearFilter;
	pooledTarget.texture.magFilter = THREE.LinearFilter;
	pooledTarget.texture.wrapS = THREE.ClampToEdgeWrapping;
	pooledTarget.texture.wrapT = THREE.ClampToEdgeWrapping;
	pooledTarget.texture.name = 'FreeFilmCut.TextLayerRT';
	return pooledTarget;

}

/**
 * Apply shared-registry Text Fx after RT rasterization.
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.WebGLRenderTarget} args.target
 * @param {object|null|undefined} args.stack fccUI.textFxStack
 * @returns {THREE.Texture}
 */
export function applyTextLayerFx( args ) {

	const renderer = args.renderer;
	const target = args.target;
	const stack = args.stack;
	const input = args.inputTexture || ( target ? target.texture : null );
	if ( ! renderer || ! input ) return input;
	const width = args.width || ( target ? target.width : 0 );
	const height = args.height || ( target ? target.height : 0 );
	if ( ! stackDataHasEnabledEffects( stack ) ) return input;
	if ( !( width > 0 ) || !( height > 0 ) ) return input;

	return renderTextureFx( {
		renderer,
		inputTexture: input,
		width,
		height,
		stack,
		cache: fxCache,
	} );

}

/** @deprecated use applyTextLayerFx — kept as Step-2 hook name from audit */
export function applyTextLayerFxPlaceholder( target ) {

	return null;

}

/**
 * @param {THREE.WebGLRenderTarget} target
 * @param {object} [opts]
 * @param {THREE.WebGLRenderer} [opts.renderer]
 * @param {object|null} [opts.stack]
 * @returns {THREE.Texture}
 */
export function textLayerCompositeSource( target, opts ) {

	if ( opts && opts.renderer && opts.stack ) {

		return applyTextLayerFx( {
			renderer: opts.renderer,
			target,
			stack: opts.stack,
		} );

	}

	const fx = applyTextLayerFxPlaceholder( target );
	return fx || target.texture;

}

export { stackDataHasEnabledEffects };

function ensureBlit() {

	if ( blitMat ) return;
	blitMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.blit',
		uniforms: {
			tDiffuse: { value: null },
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
			uniform sampler2D tDiffuse;
			uniform float uOpacity;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, clamp( vUv, vec2( 0.0 ), vec2( 1.0 ) ) );
				// Straight alpha; skip empty padding so 3D/letterbox shows through.
				if ( c.a < 0.001 ) discard;
				gl_FragColor = vec4( c.rgb, c.a * uOpacity );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NormalBlending,
	} );
	blitMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), blitMat );
	blitScene = new THREE.Scene();
	blitScene.add( blitMesh );
	blitCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}

/**
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.Texture} args.texture
 * @param {{x:number,y:number,w:number,h:number}} args.rect
 * @param {number} [args.opacity]
 */
export function blitTextLayerToLetterbox( args ) {

	const renderer = args.renderer;
	const texture = args.texture;
	const rect = args.rect;
	const opacity = args.opacity !== undefined ? args.opacity : 1;
	if ( ! renderer || ! texture || ! rect ) return;

	ensureBlit();
	blitMat.uniforms.tDiffuse.value = texture;
	blitMat.uniforms.uOpacity.value = opacity;

	const prevTarget = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	renderer.setRenderTarget( null );
	renderer.autoClear = false;
	renderer.setViewport( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissor( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissorTest( true );
	renderer.render( blitScene, blitCam );
	renderer.autoClear = prevAuto;
	renderer.setRenderTarget( prevTarget );
	blitMat.uniforms.tDiffuse.value = null;

}

/**
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {{render: Function}} args.uiOverlay
 * @param {number} args.resW
 * @param {number} args.resH
 * @param {THREE.WebGLRenderTarget} args.target
 */
export function renderOverlayTextLayerToRT( args ) {

	const renderer = args.renderer;
	const uiOverlay = args.uiOverlay;
	const resW = args.resW;
	const resH = args.resH;
	const target = args.target;
	if ( ! renderer || ! uiOverlay || ! target ) return;

	const prevTarget = renderer.getRenderTarget();
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget( target );
	renderer.setViewport( 0, 0, target.width, target.height );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, true, true );

	// Editor overlay TextFx still full project RT (SS-camera PP is scene-wide).
	// Tight AABB path is landed on OpenCut clip first; see TextLayerAabb.js.
	uiOverlay.render(
		renderer,
		{ x: 0, y: 0, w: target.width, h: target.height },
		resW,
		resH,
		target,
	);

	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );

}

/* ------------------------------------------------------------------------- *
 * Screen-Space–Camera UI capture
 *
 * Overlay canvases live on a dedicated ortho camera; SS-Camera canvases are
 * drawn by the beauty camera, in front of the frustum at planeDistance. Both
 * end up filling the safe-frame rect, so the same project-res RT works for
 * either — only the camera differs. Reusing the overlay RT keeps the TextFx
 * stack and the blit byte-identical between the two modes.
 * ------------------------------------------------------------------------- */

/** Cached clone of the render camera, used only for UI capture. */
let uiCaptureCamera = null;

function captureCameraFrom( source, layerMask ) {

	if ( ! source ) return null;
	if ( ! uiCaptureCamera || uiCaptureCamera.type !== source.type ) {

		uiCaptureCamera = source.clone();

	} else {

		uiCaptureCamera.copy( source );

	}

	if ( layerMask != null ) uiCaptureCamera.layers.set( layerMask );
	uiCaptureCamera.matrixAutoUpdate = true;
	return uiCaptureCamera;

}

/**
 * Render the scene's UI layer (only `layers`) into `target`, matching what the
 * beauty camera draws, with the background/fog suppressed.
 *
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.Scene} args.scene
 * @param {THREE.Camera} args.camera beauty/viewport camera (never mutated)
 * @param {number} args.width
 * @param {number} args.height
 * @param {THREE.WebGLRenderTarget} args.target
 * @param {number} [args.layers] layer bitmask to keep visible (camera.layers)
 * @returns {boolean} true when something was rendered
 */
export function renderUILayerToRT( args ) {

	const renderer = args.renderer;
	const scene = args.scene;
	const target = args.target;
	if ( ! renderer || ! scene || ! target || ! args.camera ) return false;

	const cam = captureCameraFrom( args.camera, args.layers );
	if ( ! cam ) return false;

	const prevTarget = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();
	const prevBackground = scene.background;
	const prevFog = scene.fog;
	const prevOverride = scene.overrideMaterial;

	scene.background = null;
	scene.fog = null;
	scene.overrideMaterial = null;

	renderer.setRenderTarget( target );
	renderer.setViewport( 0, 0, target.width, target.height );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.autoClear = false;
	// Manual clear so depth+stencil start empty (inner-shadow compares stencil).
	renderer.clear( true, true, true );
	renderer.render( scene, cam );

	scene.background = prevBackground;
	scene.fog = prevFog;
	scene.overrideMaterial = prevOverride;
	renderer.autoClear = prevAuto;
	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );

	return true;

}

export function disposeTextLayerRT() {

	if ( fxCache.built && typeof fxCache.built.dispose === 'function' ) {

		fxCache.built.dispose();
		fxCache.built = null;

	}

	if ( pooledTarget ) {

		pooledTarget.dispose();
		pooledTarget = null;

	}

	if ( blitMat ) {

		blitMat.dispose();
		blitMat = null;

	}

	if ( blitMesh ) {

		blitMesh.geometry.dispose();
		blitMesh = null;

	}

	blitScene = null;
	blitCam = null;

}
