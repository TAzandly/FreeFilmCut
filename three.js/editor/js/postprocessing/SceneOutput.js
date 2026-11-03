/**
 * Unity-style camera output for the editor viewport and GIF/PNG capture.
 *
 * The scene is drawn into a linear buffer (no sRGB encode, no tone map).
 * One fullscreen pass then applies the project's tone mapping and the
 * renderer's output transfer (sRGB). Post-processing effects, when enabled,
 * run on that linear image and finish with the same OutputPass, so turning
 * a stack on does not add a second encode.
 */

import * as THREE from 'three';
import { FullScreenQuad } from 'three/addons/postprocessing/Pass.js';
import { OutputShader } from 'three/addons/shaders/OutputShader.js';

const TONE_MAPPING_DEFINES = {
	[ THREE.LinearToneMapping ]: 'LINEAR_TONE_MAPPING',
	[ THREE.ReinhardToneMapping ]: 'REINHARD_TONE_MAPPING',
	[ THREE.CineonToneMapping ]: 'CINEON_TONE_MAPPING',
	[ THREE.ACESFilmicToneMapping ]: 'ACES_FILMIC_TONE_MAPPING',
	[ THREE.AgXToneMapping ]: 'AGX_TONE_MAPPING',
	[ THREE.NeutralToneMapping ]: 'NEUTRAL_TONE_MAPPING',
	[ THREE.CustomToneMapping ]: 'CUSTOM_TONE_MAPPING',
};

const material = new THREE.RawShaderMaterial( {
	name: 'SceneOutput',
	uniforms: THREE.UniformsUtils.clone( OutputShader.uniforms ),
	vertexShader: OutputShader.vertexShader,
	fragmentShader: OutputShader.fragmentShader,
	depthTest: false,
	depthWrite: false,
} );

const quad = new FullScreenQuad( material );

let target = null;
let targetSamples = - 1;
let syncedColorSpace = null;
let syncedToneMapping = null;

function antialiasSamples( renderer ) {

	const gl = renderer.getContext && renderer.getContext();
	const attrs = gl && gl.getContextAttributes && gl.getContextAttributes();
	return attrs && attrs.antialias ? 4 : 0;

}

function ensureTarget( width, height, samples ) {

	if ( target && target.width === width && target.height === height && targetSamples === samples ) return target;

	if ( target ) target.dispose();

	target = new THREE.WebGLRenderTarget( width, height, {
		type: THREE.HalfFloatType,
		depthBuffer: true,
		stencilBuffer: false,
		samples,
	} );
	target.texture.colorSpace = THREE.NoColorSpace;
	target.texture.name = 'SceneOutput.linear';
	targetSamples = samples;
	return target;

}

function syncDefines( renderer ) {

	const colorSpace = renderer.outputColorSpace;
	const toneMapping = renderer.toneMapping;
	if ( syncedColorSpace === colorSpace && syncedToneMapping === toneMapping ) return;

	syncedColorSpace = colorSpace;
	syncedToneMapping = toneMapping;
	material.defines = {};

	if ( THREE.ColorManagement.getTransfer( colorSpace ) === THREE.SRGBTransfer ) {

		material.defines.SRGB_TRANSFER = '';

	}

	const toneDefine = TONE_MAPPING_DEFINES[ toneMapping ];
	if ( toneDefine ) material.defines[ toneDefine ] = '';

	material.needsUpdate = true;

}

/**
 * Tone-map and encode a linear texture into `rect` on the canvas.
 * `rect` is in CSS pixels; the renderer scales by pixel ratio.
 *
 * @param {object} renderer
 * @param {THREE.Texture} texture
 * @param {{ x: number, y: number, w: number, h: number }} rect
 */
function blitLinearToScreen( renderer, texture, rect ) {

	syncDefines( renderer );

	material.uniforms.tDiffuse.value = texture;
	material.uniforms.toneMappingExposure.value = renderer.toneMappingExposure;

	renderer.setRenderTarget( null );
	renderer.setViewport( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissor( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissorTest( true );
	quad.render( renderer );

	material.uniforms.tDiffuse.value = null;

}

/**
 * Render the scene in linear space, then one output transform into `rect`.
 *
 * @param {object} renderer
 * @param {THREE.Scene} scene
 * @param {THREE.Camera} camera
 * @param {{ x: number, y: number, w: number, h: number }} rect CSS-pixel destination on the canvas
 */
export function renderSceneWithColorOutput( renderer, scene, camera, rect ) {

	const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
	const tw = Math.max( 1, Math.round( rect.w * pr ) );
	const th = Math.max( 1, Math.round( rect.h * pr ) );
	const rt = ensureTarget( tw, th, antialiasSamples( renderer ) );

	const prevAutoClear = renderer.autoClear;
	renderer.setRenderTarget( rt );
	renderer.setViewport( 0, 0, tw, th );
	renderer.setScissorTest( false );
	renderer.autoClear = true;
	renderer.clear();
	renderer.render( scene, camera );
	renderer.autoClear = prevAutoClear;
	renderer.setRenderTarget( null );

	blitLinearToScreen( renderer, rt.texture, rect );

}
