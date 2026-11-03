/**
 * FreeFilmCut UGUI:
 * - Overlay: layout + ortho render after PP (clear depth only).
 * - Screen Space Camera: layout as plane in front of target camera;
 *   beauty camera enables UI_CAMERA_LAYER so RenderPass / non-PP beauty
 *   includes UI (before post-process).
 *
 * Nulls scene.background/fog for the Overlay UI pass so Three.js does not
 * redraw the background and wipe the already-presented 3D/PP color buffer.
 */

import * as THREE from 'three';

import { UI_LAYER, UI_CAMERA_LAYER, RENDER_MODE_CAMERA } from './UIConstants.js?v=fcc-ui-111';
import { layoutAllCanvases } from './UIRectLayout.js?v=fcc-ui-150';
import { rebindAllUI } from './UIFactory.js?v=fcc-ui-179';
import { applyTextStickersInScene } from './TextStickers.js?v=fcc-ui-211';

function createUICamera() {

	const cam = new THREE.OrthographicCamera( 0, 1, 1, 0, - 1000, 1000 );
	cam.name = 'UIOverlayCamera';
	cam.layers.set( UI_LAYER );
	cam.position.set( 0, 0, 10 );
	cam.lookAt( 0, 0, 0 );
	return cam;

}

function resolveEditorCamera( editor, uuid ) {

	if ( uuid ) {

		let found = null;
		editor.scene.traverse( function ( o ) {

			if ( found ) return;
			if ( o.uuid === uuid && ( o.isCamera || o.isPerspectiveCamera || o.isOrthographicCamera ) ) {

				found = o;

			}

		} );
		if ( found ) return found;

	}

	return editor.viewportCamera || null;

}

function sceneHasMode( scene, mode ) {

	let found = false;
	scene.traverse( function ( o ) {

		if ( found ) return;
		const ui = o.userData && o.userData.fccUI;
		if ( ! ui || ui.type !== 'canvas' ) return;
		const m = ui.renderMode === RENDER_MODE_CAMERA ? 'camera' : 'overlay';
		if ( m === mode ) found = true;

	} );
	return found;

}

/**
 * @returns {{
 *   render: Function,
 *   present: Function,
 *   dispose: Function,
 *   camera: THREE.OrthographicCamera,
 *   prepareCameraMode: Function,
 *   restoreCameraMode: Function,
 * }}
 */
export function createUIOverlay( editor ) {

	const uiCamera = createUICamera();
	let lastW = - 1;
	let lastH = - 1;
	/** @type {THREE.Camera|null} */
	let beautyCamEnabled = null;

	function syncCamera( resW, resH ) {

		if ( lastW === resW && lastH === resH ) return;
		lastW = resW;
		lastH = resH;
		uiCamera.left = 0;
		uiCamera.right = resW;
		uiCamera.top = resH;
		uiCamera.bottom = 0;
		uiCamera.updateProjectionMatrix();

	}

	/**
	 * Layout Screen Space–Camera canvases into the world and enable
	 * UI_CAMERA_LAYER on the beauty / viewport camera for the upcoming
	 * RenderPass / non-PP beauty.
	 */
	function prepareCameraMode( resW, resH ) {

		if ( ! editor.scene ) return;
		// Avoid Troika sync with dead blob: fonts while fromJSON is still restoring.
		if ( editor.isLoadingState ) return;
		rebindAllUI( editor.scene );

		if ( ! sceneHasMode( editor.scene, 'camera' ) ) {

			restoreCameraMode();
			return;

		}

		layoutAllCanvases( editor.scene, resW, resH, {
			forMode: 'camera',
			resolveCamera: function ( uuid ) {

				return resolveEditorCamera( editor, uuid );

			},
		} );
		// Stickers need post-layout glyphBounds / carets (rebind+layout above).
		applyTextStickersInScene( editor.scene, editor.materials );

		const cam = editor.viewportCamera;
		if ( cam ) {

			cam.layers.enable( UI_CAMERA_LAYER );
			beautyCamEnabled = cam;

		}

	}

	function restoreCameraMode() {

		if ( beautyCamEnabled ) {

			beautyCamEnabled.layers.disable( UI_CAMERA_LAYER );
			beautyCamEnabled = null;

		} else if ( editor.viewportCamera ) {

			editor.viewportCamera.layers.disable( UI_CAMERA_LAYER );

		}

	}

	/**
	 * Overlay-only pass after PP / 3D.
	 * @param {THREE.WebGLRenderer} renderer
	 * @param {{x:number,y:number,w:number,h:number}} presentLayout letterbox in GL coords (y from bottom)
	 * @param {number} resW project resolution width
	 * @param {number} resH project resolution height
	 * @param {THREE.WebGLRenderTarget|null} [target=null] optional offscreen RT (Text→RT preview / OpenCut-aligned path)
	 */
	function render( renderer, presentLayout, resW, resH, target = null ) {

		if ( ! renderer || ! editor.scene ) return;
		if ( editor.isLoadingState ) return;

		const scene = editor.scene;
		rebindAllUI( scene );

		if ( ! sceneHasMode( scene, 'overlay' ) ) return;

		layoutAllCanvases( scene, resW, resH, { forMode: 'overlay' } );
		// Stickers after rebind+layout so scale/offset/glyph AABB take effect.
		applyTextStickersInScene( scene, editor.materials );
		syncCamera( resW, resH );

		const prevAutoClear = renderer.autoClear;
		const prevClearColor = new THREE.Color();
		const prevClearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevClearColor );
		const prevTarget = renderer.getRenderTarget();

		const prevBackground = scene.background;
		const prevFog = scene.fog;
		scene.background = null;
		scene.fog = null;

		if ( target ) renderer.setRenderTarget( target );

		renderer.setViewport( presentLayout.x, presentLayout.y, presentLayout.w, presentLayout.h );
		renderer.setScissor( presentLayout.x, presentLayout.y, presentLayout.w, presentLayout.h );
		renderer.setScissorTest( true );

		renderer.autoClear = false;
		renderer.clearDepth();
		// Face writes stencil=1; inner shadow tests Equal (needs stencil:true on renderer / RT).
		if ( typeof renderer.clearStencil === 'function' ) renderer.clearStencil();
		renderer.render( scene, uiCamera );

		scene.background = prevBackground;
		scene.fog = prevFog;
		renderer.autoClear = prevAutoClear;
		renderer.setClearColor( prevClearColor, prevClearAlpha );
		if ( target ) renderer.setRenderTarget( prevTarget );

	}


	/**
	 * Draw the current overlay UI with the ortho camera — no rebind / layout /
	 * stickers apply. Used after Text→RT→TextFx blit to composite front stickers
	 * alone on top of the effect stack without rebuilding Troika.
	 */
	function present( renderer, presentLayout, resW, resH, target = null ) {

		if ( ! renderer || ! editor.scene ) return;
		if ( editor.isLoadingState ) return;
		if ( ! presentLayout ) return;

		const scene = editor.scene;
		syncCamera( resW, resH );

		const prevAutoClear = renderer.autoClear;
		const prevClearColor = new THREE.Color();
		const prevClearAlpha = renderer.getClearAlpha();
		renderer.getClearColor( prevClearColor );
		const prevTarget = renderer.getRenderTarget();

		const prevBackground = scene.background;
		const prevFog = scene.fog;
		scene.background = null;
		scene.fog = null;

		if ( target ) renderer.setRenderTarget( target );

		renderer.setViewport( presentLayout.x, presentLayout.y, presentLayout.w, presentLayout.h );
		renderer.setScissor( presentLayout.x, presentLayout.y, presentLayout.w, presentLayout.h );
		renderer.setScissorTest( true );

		renderer.autoClear = false;
		renderer.clearDepth();
		if ( typeof renderer.clearStencil === 'function' ) renderer.clearStencil();
		renderer.render( scene, uiCamera );

		scene.background = prevBackground;
		scene.fog = prevFog;
		renderer.autoClear = prevAutoClear;
		renderer.setClearColor( prevClearColor, prevClearAlpha );
		if ( target ) renderer.setRenderTarget( prevTarget );

	}

	function dispose() {

		restoreCameraMode();

	}

	return {
		render,
		present,
		dispose,
		camera: uiCamera,
		prepareCameraMode,
		restoreCameraMode,
	};

}
