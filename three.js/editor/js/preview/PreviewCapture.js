import * as THREE from 'three';
import {
	buildComposerForCamera,
	stackHasEnabledEffects,
	syncComposerParams,
	applyBokehSeekEnvelope,
} from '../postprocessing/PostProcessStack.js?v=fcc-ui-231';
import { applyBeautyClear } from '../postprocessing/BeautyClear.js?v=fcc-ui-111';
import { renderSceneWithColorOutput } from '../postprocessing/SceneOutput.js?v=fcc-ui-111';
import { applyGlobalScreenParamsToMaterials, applyGlobalScreenParamsToObject3D } from '../GlobalScreenParams.js?v=fcc-ui-106';
import { updateFccVideos } from '../media/FccVideo.js?v=fcc-ui-207';
import { renderStickerMotionPreview } from '../sticker-motion/StickerMotionPreview.js?v=fcc-ui-106';
import { normalizeStickerMotion, sampleStickerMotion } from '../sticker-motion/StickerMotion.js?v=fcc-ui-106';
import { applyTextAnimsInScene } from '../ui/TextAnimRuntime.js?v=fcc-ui-212';
import { applyTextStickersInScene } from '../ui/TextStickers.js?v=fcc-ui-211';
import { applyTextGeomFxInScene } from '../ui/TextGeomFx.js?v=fcc-ui-146';

const MIN_SIZE = 16;
const MAX_SIZE = 1280;
const TEXTURE_WAIT_MS = 8000;

export function clampPreviewSize( value ) {

	const n = Math.round( Number( value ) || MIN_SIZE );
	return Math.max( MIN_SIZE, Math.min( MAX_SIZE, n ) );

}

function snapshotCamera( camera ) {

	return {
		aspect: camera.aspect,
		fov: camera.fov,
		left: camera.left,
		right: camera.right,
		top: camera.top,
		bottom: camera.bottom,
		zoom: camera.zoom,
	};

}

function restoreCamera( camera, saved ) {

	if ( ! camera || ! saved ) return;
	camera.aspect = saved.aspect;
	camera.fov = saved.fov;
	camera.left = saved.left;
	camera.right = saved.right;
	camera.top = saved.top;
	camera.bottom = saved.bottom;
	camera.zoom = saved.zoom;
	camera.updateProjectionMatrix();

}

function projectFrameSize( editor ) {

	const config = editor.config;
	const width = Math.max( 1, parseInt( config && config.getKey( 'project/resolution/width' ), 10 ) || 1920 );
	const height = Math.max( 1, parseInt( config && config.getKey( 'project/resolution/height' ), 10 ) || 1080 );
	return { width, height };

}

/** Fit the whole project frame inside the export pixels. */
function containFrame( exportW, exportH, frameW, frameH ) {

	const scale = Math.min( exportW / frameW, exportH / frameH );
	const dw = Math.max( 1, Math.round( frameW * scale ) );
	const dh = Math.max( 1, Math.round( frameH * scale ) );
	return {
		x: Math.floor( ( exportW - dw ) / 2 ),
		y: Math.floor( ( exportH - dh ) / 2 ),
		w: dw,
		h: dh,
	};

}

function fitCamera( camera, aspect ) {

	if ( camera.isPerspectiveCamera ) {

		camera.aspect = aspect;
		camera.updateProjectionMatrix();

	} else if ( camera.isOrthographicCamera ) {

		const frustumHeight = camera.top - camera.bottom;
		camera.left = - frustumHeight * aspect / 2;
		camera.right = frustumHeight * aspect / 2;
		camera.updateProjectionMatrix();

	}

}

function composerTexturesPending( built ) {

	if ( ! built || ! Array.isArray( built.bindings ) ) return false;
	for ( const binding of built.bindings ) {

		for ( const pass of binding.passes || [] ) {

			if ( ! pass ) continue;
			if ( typeof pass._texturesPending === 'function' ) {

				if ( pass._texturesPending() ) return true;

			} else if ( pass._texturesPending === true ) {

				return true;

			}

		}

	}

	return false;

}

function sleep( ms ) {

	return new Promise( ( resolve ) => setTimeout( resolve, ms ) );

}

async function waitForComposerTextures( built, timeoutMs = TEXTURE_WAIT_MS ) {

	if ( ! built || ! composerTexturesPending( built ) ) return;
	const start = ( typeof performance !== 'undefined' && performance.now ) ? performance.now() : Date.now();
	while ( composerTexturesPending( built ) ) {

		const now = ( typeof performance !== 'undefined' && performance.now ) ? performance.now() : Date.now();
		if ( now - start > timeoutMs ) {

			console.warn( '[FreeFilmCut] preview capture: effect textures still pending after wait — exporting anyway' );
			break;

		}

		await sleep( 16 );

	}

}

/** Push live stack params + optional SeekMode envelope before each captured frame. */
function prepareComposerForCapture( built, camera, session ) {

	if ( ! built || ! camera ) return;
	syncComposerParams( built, camera );
	if ( session && session.applyBokehEnvelope && typeof session.timelineProgress === 'number' ) {

		applyBokehSeekEnvelope( built, camera, session.timelineProgress );

	}

	const t = session && typeof session.effectTime === 'number' ? session.effectTime : null;
	if ( t === null ) return;
	for ( const binding of built.bindings || [] ) {

		for ( const pass of binding.passes || [] ) {

			if ( pass ) pass.__fccEffectTime = t;

		}

	}

}

// Same LDR present blit as Viewport (HalfFloat composer → displayable bytes).
const _blitCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
const _blitMat = new THREE.ShaderMaterial( {
	uniforms: { tDiffuse: { value: null } },
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
			// Match Viewport.presentComposerToLetterbox: OutputPass already
			// wrote display-referred sRGB; copy bytes — do not encode again.
			vec3 rgb = clamp( c.rgb, 0.0, 1.0 );
			float a = clamp( max( c.a, max( rgb.r, max( rgb.g, rgb.b ) ) ), 0.0, 1.0 );
			gl_FragColor = vec4( a > 1e-5 ? rgb / a : vec3( 0.0 ), a );
		}
	`,
	depthTest: false,
	depthWrite: false,
	blending: THREE.NoBlending,
	toneMapped: false,
} );
const _blitMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), _blitMat );
const _blitScene = new THREE.Scene();
_blitScene.add( _blitMesh );

let _ldrRT = null;

function ensureLdrRT( w, h ) {

	if ( _ldrRT && _ldrRT.width === w && _ldrRT.height === h ) return _ldrRT;
	if ( _ldrRT ) _ldrRT.dispose();
	// NoColorSpace / RGBA8: OutputPass already applied sRGB. Marking this RT
	// SRGBColorSpace made the GPU encode again → washed PNG vs viewport.
	_ldrRT = new THREE.WebGLRenderTarget( w, h, {
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		depthBuffer: false,
		stencilBuffer: false,
		colorSpace: THREE.NoColorSpace,
	} );
	_ldrRT.texture.colorSpace = THREE.NoColorSpace;
	_ldrRT.texture.generateMipmaps = false;
	_ldrRT.texture.name = 'FccPreviewCaptureLDR';
	return _ldrRT;

}

/** Flip GL bottom-up RGBA into top-down ImageData bytes. */
function flipYRgba( raw, w, h ) {

	const out = new Uint8ClampedArray( w * h * 4 );
	const stride = w * 4;
	for ( let y = 0; y < h; y ++ ) {

		out.set( raw.subarray( ( h - 1 - y ) * stride, ( h - y ) * stride ), y * stride );

	}

	return out;

}

/**
 * Composite project frame into export size. For opaque covers, fill empty
 * letterbox with black so transparent Default backgrounds don't look "empty".
 */
function letterboxToExport( srcTopDown, srcW, srcH, exportW, exportH, present ) {

	const src = document.createElement( 'canvas' );
	src.width = srcW;
	src.height = srcH;
	src.getContext( '2d' ).putImageData( new ImageData( srcTopDown, srcW, srcH ), 0, 0 );

	const out = document.createElement( 'canvas' );
	out.width = exportW;
	out.height = exportH;
	const ctx = out.getContext( '2d', { willReadFrequently: true } );
	ctx.fillStyle = '#000000';
	ctx.fillRect( 0, 0, exportW, exportH );
	ctx.drawImage( src, 0, 0, srcW, srcH, present.x, present.y, present.w, present.h );
	return ctx.getImageData( 0, 0, exportW, exportH ).data;

}

/**
 * Grab the current camera picture (no grid, no helpers) at width × height.
 * Matches Viewport PP path: offscreen composer → LDR blit → readPixels.
 * Suspends viewport render for the whole capture so awaits cannot race setSize.
 *
 * @param {object} [session] `{ built }` reuse bag for GIF frames.
 */
export async function capturePreviewFrame( editor, width, height, session = null ) {

	const renderer = editor.fccRenderer;
	const scene = editor.scene;
	const camera = editor.viewportCamera;
	if ( ! renderer || ! scene || ! camera ) {

		throw new Error( 'viewport is not ready' );

	}

	const w = clampPreviewSize( width );
	const h = clampPreviewSize( height );
	const frame = projectFrameSize( editor );
	const present = containFrame( w, h, frame.width, frame.height );
	const compW = Math.max( 1, Math.floor( frame.width ) );
	const compH = Math.max( 1, Math.floor( frame.height ) );

	const prevRatio = renderer.getPixelRatio();
	const prevSize = new THREE.Vector2();
	renderer.getSize( prevSize );
	const prevTarget = renderer.getRenderTarget();
	const prevViewport = new THREE.Vector4();
	const prevScissor = new THREE.Vector4();
	renderer.getViewport( prevViewport );
	renderer.getScissor( prevScissor );
	const prevScissorTest = renderer.getScissorTest();
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();
	const prevAutoClear = renderer.autoClear;
	const prevTM = renderer.toneMapping;
	const prevExp = renderer.toneMappingExposure;
	const camSaved = snapshotCamera( camera );
	const prevSuspend = editor.__fccSuspendViewportRender;
	editor.__fccSuspendViewportRender = true;

	let built = session && session.built ? session.built : null;

	try {

		fitCamera( camera, frame.width / Math.max( frame.height, 1 ) );
		applyGlobalScreenParamsToMaterials( editor.materials, frame.width, frame.height );
		applyGlobalScreenParamsToObject3D( scene, frame.width, frame.height );

		updateFccVideos( renderer, scene );

		const overlay = editor.fccUIOverlay;
		if ( overlay && overlay.prepareCameraMode ) overlay.prepareCameraMode( frame.width, frame.height );

		const packType = editor.config && editor.config.getKey( 'project/vfxpack/type' );
		const stickerAnim = packType === 'sticker-anim';

		if ( ! stickerAnim ) {

			applyTextAnimsInScene( scene );
			applyTextStickersInScene( scene, editor.materials );
			applyTextGeomFxInScene( scene, {
				enabled: true,
				debug: !! editor.textAnimWipeDebug,
			} );
			updateFccVideos( renderer, scene );

		}

		// Build composer before any canvas resize; wait for textures while
		// viewport is suspended so RAF cannot stomp the GL context.
		if ( ! stickerAnim && stackHasEnabledEffects( camera ) ) {

			if ( ! built ) {

				built = buildComposerForCamera( {
					renderer,
					scene,
					camera,
					width: compW,
					height: compH,
				} );
				if ( session ) session.built = built;

			}

			if ( built ) await waitForComposerTextures( built );
			prepareComposerForCapture( built, camera, session );

		}

		// ---- synchronous GL capture (no await below) ----
		renderer.setPixelRatio( 1 );
		// Keep drawing buffer ≥ project frame so viewport(0,0,compW,compH) is valid.
		const bufW = Math.max( compW, Math.floor( prevSize.x ) || 1 );
		const bufH = Math.max( compH, Math.floor( prevSize.y ) || 1 );
		renderer.setSize( bufW, bufH, false );
		renderer.setRenderTarget( null );
		renderer.setScissorTest( false );
		renderer.autoClear = true;

		const fullRect = { x: 0, y: 0, w: compW, h: compH };
		let topDown = null;

		if ( stickerAnim ) {

			renderer.setViewport( 0, 0, compW, compH );
			applyBeautyClear( renderer, editor );
			renderer.clear();
			const pose = sampleStickerMotion(
				normalizeStickerMotion( editor.stickerMotion ),
				editor.stickerMotionTime || 0,
			);
			renderStickerMotionPreview( {
				renderer,
				scene,
				camera,
				rect: fullRect,
				pose,
				overlay,
				projectRes: frame,
			} );
			if ( overlay && overlay.restoreCameraMode ) overlay.restoreCameraMode();
			const raw = new Uint8Array( compW * compH * 4 );
			const gl = renderer.getContext();
			gl.readPixels( 0, 0, compW, compH, gl.RGBA, gl.UNSIGNED_BYTE, raw );
			topDown = flipYRgba( raw, compW, compH );

		} else if ( built && built.composer ) {

			// Mirror Viewport.presentComposerToLetterbox: compose into HalfFloat
			// RTs, then LDR-blit (OutputPass already did toneMap/sRGB).
			const composer = built.composer;
			const prevRTS = composer.renderToScreen;
			composer.renderToScreen = false;
			renderer.toneMapping = THREE.NoToneMapping;
			renderer.autoClear = false;
			renderer.setViewport( 0, 0, compW, compH );
			applyBeautyClear( renderer, editor );
			composer.render();
			composer.renderToScreen = prevRTS;
			renderer.toneMapping = prevTM;
			renderer.toneMappingExposure = prevExp;
			renderer.autoClear = prevAutoClear;

			const srcTex = composer.readBuffer ? composer.readBuffer.texture : null;
			if ( ! srcTex ) throw new Error( 'composer readBuffer missing' );

			const ldr = ensureLdrRT( compW, compH );
			_blitMat.uniforms.tDiffuse.value = srcTex;
			renderer.setRenderTarget( ldr );
			renderer.setViewport( 0, 0, compW, compH );
			renderer.setScissorTest( false );
			renderer.clear();
			renderer.render( _blitScene, _blitCam );
			_blitMat.uniforms.tDiffuse.value = null;
			renderer.setRenderTarget( null );

			if ( overlay && overlay.restoreCameraMode ) overlay.restoreCameraMode();
			// UI overlay is screen-space; skip for PP cover (camera beauty only).

			const raw = new Uint8Array( compW * compH * 4 );
			renderer.readRenderTargetPixels( ldr, 0, 0, compW, compH, raw );
			topDown = flipYRgba( raw, compW, compH );

		} else {

			renderer.setViewport( 0, 0, compW, compH );
			applyBeautyClear( renderer, editor );
			renderer.clear();
			renderSceneWithColorOutput( renderer, scene, camera, fullRect );
			if ( overlay && overlay.restoreCameraMode ) overlay.restoreCameraMode();
			if ( overlay && overlay.render ) overlay.render( renderer, fullRect, frame.width, frame.height );
			const raw = new Uint8Array( compW * compH * 4 );
			const gl = renderer.getContext();
			gl.readPixels( 0, 0, compW, compH, gl.RGBA, gl.UNSIGNED_BYTE, raw );
			topDown = flipYRgba( raw, compW, compH );

		}

		if ( w === compW && h === compH ) return topDown;
		return letterboxToExport( topDown, compW, compH, w, h, present );

	} finally {

		editor.__fccSuspendViewportRender = prevSuspend;

		if ( editor.fccUIOverlay && editor.fccUIOverlay.restoreCameraMode ) {

			editor.fccUIOverlay.restoreCameraMode();

		}

		if ( ! session && built ) {

			try {

				built.dispose();

			} catch ( e ) { /* ignore */ }

		}

		restoreCamera( camera, camSaved );
		renderer.autoClear = prevAutoClear;
		renderer.toneMapping = prevTM;
		renderer.toneMappingExposure = prevExp;
		renderer.setRenderTarget( prevTarget );
		renderer.setScissorTest( prevScissorTest );
		renderer.setViewport( prevViewport );
		renderer.setScissor( prevScissor );
		renderer.setClearColor( prevClear, prevAlpha );
		renderer.setPixelRatio( prevRatio );
		renderer.setSize( prevSize.x, prevSize.y, false );

		if ( editor.signals && editor.signals.sceneGraphChanged ) {

			try {

				editor.signals.sceneGraphChanged.dispatch();

			} catch ( error ) {

				console.warn( '[FreeFilmCut] preview refresh', error );

			}

		}

	}

}

/** Dispose a `{ built }` session from GIF multi-frame capture. */
export function disposePreviewCaptureSession( session ) {

	if ( session && session.built ) {

		try {

			session.built.dispose();

		} catch ( e ) { /* ignore */ }

		session.built = null;

	}

}

export function frameToPngBytes( rgba, width, height ) {

	const canvas = document.createElement( 'canvas' );
	canvas.width = width;
	canvas.height = height;
	const ctx = canvas.getContext( '2d' );
	const image = new ImageData( new Uint8ClampedArray( rgba ), width, height );
	ctx.putImageData( image, 0, 0 );
	return new Promise( ( resolve ) => {

		canvas.toBlob( ( blob ) => resolve( blob ), 'image/png' );

	} );

}

export function bytesToDataUrl( bytes, mime ) {

	let binary = '';
	const chunk = 0x8000;
	for ( let i = 0; i < bytes.length; i += chunk ) {

		binary += String.fromCharCode.apply( null, bytes.subarray( i, Math.min( i + chunk, bytes.length ) ) );

	}

	return 'data:' + mime + ';base64,' + btoa( binary );

}
