import * as THREE from 'three';
import { PMREMGenerator } from 'three/webgpu';

import { TransformControls } from 'three/addons/controls/TransformControls.js';

import { UIPanel } from './libs/ui.js';

import { EditorControls } from './EditorControls.js';

import { ViewportControls } from './Viewport.Controls.js';
import { ViewportInfo } from './Viewport.Info.js';
import { ViewportSafeFrame } from './Viewport.SafeFrame.js';
import { buildComposerForCamera, needsComposerRebuild, syncComposerParams, applyBokehSeekEnvelope, stackHasEnabledEffects } from './postprocessing/PostProcessStack.js?v=fcc-ui-231';
import {
	registerCustomEffectAssetResolver,
	registerCustomEffectTextureUpdateListener,
} from './postprocessing/CustomEffectRuntime.js?v=fcc-ui-231';
import { isTransparentBackground, applyBeautyClear, applyLetterboxChromeClear } from './postprocessing/BeautyClear.js?v=fcc-ui-111';
import { renderSceneWithColorOutput } from './postprocessing/SceneOutput.js?v=fcc-ui-111';
import { renderStickerMotionPreview } from './sticker-motion/StickerMotionPreview.js?v=fcc-ui-110';
import { normalizeStickerMotion, sampleStickerMotion } from './sticker-motion/StickerMotion.js?v=fcc-ui-110';
import { applyGlobalScreenParamsToMaterials, applyGlobalScreenParamsToObject3D } from './GlobalScreenParams.js?v=fcc-ui-110';
import { createUIOverlay } from './ui/UIOverlay.js?v=fcc-ui-180';
import {
	ensureTextLayerRenderTarget,
	renderOverlayTextLayerToRT,
	blitTextLayerToLetterbox,
	stackDataHasEnabledEffects,
	applyTextLayerFx,
} from './ui/TextLayerRT.js?v=fcc-ui-226';
import {
	isFccUI,
	getFccUI,
	isUIText,
	isUICanvas,
	getCanvasRenderMode,
	getOwningCanvasRenderMode,
	RENDER_MODE_CAMERA,
} from './ui/UIConstants.js?v=fcc-ui-111';
import { applyTextAnimsInScene } from './ui/TextAnimRuntime.js?v=fcc-ui-212';
import {
	applyTextStickersInScene,
	sceneHasFrontTextStickers,
	setTextStickerFrontRootsVisible,
	withTextContentHiddenExceptFrontStickers,
} from './ui/TextStickers.js?v=fcc-ui-211';
import { applyTextGeomFxInScene } from './ui/TextGeomFx.js?v=fcc-ui-146';
import { disposeFccMedia, fccVideoPlaying, updateFccVideos } from './media/FccVideo.js?v=fcc-ui-207';
import { FaceFxPreview } from './face-fx/FaceFxPreview.js?v=fcc-ui-252';
import { bindFccAudio, resumeAndRouteVideos, syncFccListenerToCamera } from './media/FccAudio.js?v=fcc-ui-110';

import { ViewHelper } from './Viewport.ViewHelper.js';
import { XR } from './Viewport.XR.js';

import { SetPositionCommand } from './commands/SetPositionCommand.js';
import { SetRotationCommand } from './commands/SetRotationCommand.js';
import { SetScaleCommand } from './commands/SetScaleCommand.js';
import { MultiCmdsCommand } from './commands/MultiCmdsCommand.js';

import { ColorEnvironment } from 'three/addons/environments/ColorEnvironment.js';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { ViewportPathtracer } from './Viewport.Pathtracer.js';

function Viewport( editor ) {

	const selector = editor.selector;
	const signals = editor.signals;

	// Same CustomEffectRuntime instance the composer uses — register here so
	// project-relative LUT/filter textures resolve even before the PP sidebar opens.
	registerCustomEffectAssetResolver( async ( path ) => {

		const pf = editor.projectFolder;
		if ( ! pf ) return null;
		const bin = await pf.readBinaryFile( path );
		if ( ! bin || ! bin.buffer ) return null;
		return URL.createObjectURL( new Blob( [ bin.buffer ], { type: bin.mime || 'image/png' } ) );

	} );
	registerCustomEffectTextureUpdateListener( () => {

		editor.signals.sceneGraphChanged.dispatch();

	} );

	const container = new UIPanel();
	container.setId( 'viewport' );
	// Dark checker chrome for Default (transparent beauty); do not wait for renderer.
	if ( editor.backgroundType === 'Default' ) container.dom.classList.add( 'fcc-bg-transparent' );
	container.setPosition( 'absolute' );

	bindFccAudio( editor );
	editor.faceFxPreview = new FaceFxPreview( editor );
	container.dom.addEventListener( 'pointerdown', function () {

		resumeAndRouteVideos( editor );

	} );

	container.add( new ViewportControls( editor ) );
	container.add( new ViewportInfo( editor ) );

	const safeFrame = new ViewportSafeFrame( editor );
	container.add( safeFrame );

	const uiOverlay = createUIOverlay( editor );

	editor.fccUIOverlay = uiOverlay;

	//

	let renderer = null;
	let pmremGenerator = null;
	let pathtracer = null;

	/** @type {{ composer: any, dispose: function, signature: string } | null} */
	let postComposerBuilt = null;
	let postComposerCameraUuid = null;

	let camera = editor.camera;
	const scene = editor.scene;
	const sceneHelpers = editor.sceneHelpers;

	// helpers

	const GRID_COLORS_LIGHT = [ 0x999999, 0x777777 ];
	const GRID_COLORS_DARK = [ 0x555555, 0x888888 ];

	const grid = new THREE.Group();

	const grid1 = new THREE.GridHelper( 30, 30 );
	grid1.material.color.setHex( GRID_COLORS_LIGHT[ 0 ] );
	grid1.material.vertexColors = false;
	grid.add( grid1 );

	const grid2 = new THREE.GridHelper( 30, 6 );
	grid2.material.color.setHex( GRID_COLORS_LIGHT[ 1 ] );
	grid2.material.vertexColors = false;
	grid.add( grid2 );

	const viewHelper = new ViewHelper( camera, container );

	//

	const box = new THREE.Box3();

	const selectionBox = new THREE.Box3Helper( box );
	selectionBox.material.depthTest = false;
	selectionBox.material.transparent = true;
	selectionBox.visible = false;
	sceneHelpers.add( selectionBox );

	let objectStatesOnDown = [];

	const transformControls = new TransformControls( camera );
	transformControls.addEventListener( 'axis-changed', function () {

		if ( editor.viewportShading !== 'realistic' ) render();

	} );
	transformControls.addEventListener( 'objectChange', function () {

		signals.objectChanged.dispatch( transformControls.object );

	} );
	transformControls.addEventListener( 'mouseDown', function () {

		const object = transformControls.object;

		const objects = ( object === selector.group ) ? selector.selection : [ object ];

		objectStatesOnDown = objects.map( ( object ) => ( {
			object: object,
			position: object.position.clone(),
			rotation: object.rotation.clone(),
			scale: object.scale.clone()
		} ) );

		controls.enabled = false;

	} );
	transformControls.addEventListener( 'mouseUp', function () {

		if ( transformControls.object !== undefined ) {

			const commands = [];

			for ( let i = 0; i < objectStatesOnDown.length; i ++ ) {

				const state = objectStatesOnDown[ i ];
				const object = state.object;

				if ( ! state.position.equals( object.position ) ) {

					commands.push( new SetPositionCommand( editor, object, object.position, state.position ) );

				}

				if ( ! state.rotation.equals( object.rotation ) ) {

					commands.push( new SetRotationCommand( editor, object, object.rotation, state.rotation ) );

				}

				if ( ! state.scale.equals( object.scale ) ) {

					commands.push( new SetScaleCommand( editor, object, object.scale, state.scale ) );

				}

			}

			if ( commands.length === 1 ) {

				editor.execute( commands[ 0 ] );

			} else if ( commands.length > 1 ) {

				editor.execute( new MultiCmdsCommand( editor, commands ) );

			}

		}

		controls.enabled = true;

	} );

	sceneHelpers.add( transformControls.getHelper() );

	//

	const xr = new XR( editor, transformControls ); // eslint-disable-line no-unused-vars

	// events


	const _blitCam = new THREE.OrthographicCamera( -1, 1, 1, -1, 0, 1 );
	// OutputPass already wrote display-encoded texels. This copy must not encode again.
	// Composer rgb is premultiplied over a transparent clear (blending + additive
	// bloom light whose alpha is linear energy), while the canvas is
	// premultipliedAlpha:false. Write straight alpha with a >= max(rgb) so the
	// page shows rgb + bg * (1 - a): identical to the opaque path over black.
	const _blitMat = new THREE.ShaderMaterial( {
		uniforms: { tDiffuse: { value: null } },
		vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
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


	/** Paint opaque letterbox bars; leave content rect untouched (may stay a=0). */
	function fillLetterboxBarsOpaque( renderer, contentLayout, canvasW, canvasH ) {

		const x = Math.floor( contentLayout.x );
		const y = Math.floor( contentLayout.y );
		const w = Math.floor( contentLayout.w );
		const h = Math.floor( contentLayout.h );
		applyLetterboxChromeClear( renderer );
		renderer.setScissorTest( true );
		// top (GL y grows up)
		const topH = canvasH - ( y + h );
		if ( topH > 0 ) {
			renderer.setViewport( 0, y + h, canvasW, topH );
			renderer.setScissor( 0, y + h, canvasW, topH );
			renderer.clear();
		}
		// bottom
		if ( y > 0 ) {
			renderer.setViewport( 0, 0, canvasW, y );
			renderer.setScissor( 0, 0, canvasW, y );
			renderer.clear();
		}
		// left
		if ( x > 0 ) {
			renderer.setViewport( 0, y, x, h );
			renderer.setScissor( 0, y, x, h );
			renderer.clear();
		}
		// right
		const rightX = x + w;
		if ( rightX < canvasW ) {
			renderer.setViewport( rightX, y, canvasW - rightX, h );
			renderer.setScissor( rightX, y, canvasW - rightX, h );
			renderer.clear();
		}
		renderer.setScissorTest( false );
		renderer.setViewport( 0, 0, canvasW, canvasH );

	}

	function presentComposerToLetterbox( composer, layout, compW, compH ) {

		const prevRTS = composer.renderToScreen;
		composer.renderToScreen = false;

		// UnrealBloom must sample linear HDR. OutputPass (wrapped in PostProcessStack)
		// temporarily restores the project's tone mapping for the final color transform.
		// composer RTs are project/safe-frame sized (compW x compH); blit into letterbox rect.
		const prevTM = renderer.toneMapping;
		const prevExp = renderer.toneMappingExposure;
		const prevAutoClear = renderer.autoClear;
		renderer.toneMapping = THREE.NoToneMapping;
		renderer.autoClear = false;

		renderer.setScissorTest( false );
		renderer.setViewport( 0, 0, compW, compH );
		applyBeautyClear( renderer, editor );
		composer.render();

		renderer.autoClear = prevAutoClear;
		renderer.toneMapping = prevTM;
		renderer.toneMappingExposure = prevExp;
		composer.renderToScreen = prevRTS;

		const tex = composer.readBuffer ? composer.readBuffer.texture : null;
		if ( ! tex ) return;

		_blitMat.uniforms.tDiffuse.value = tex;

		const prevAutoClearBlit = renderer.autoClear;
		renderer.autoClear = false;
		renderer.setRenderTarget( null );
		renderer.setViewport( layout.x, layout.y, layout.w, layout.h );
		renderer.setScissor( layout.x, layout.y, layout.w, layout.h );
		renderer.setScissorTest( true );
		renderer.render( _blitScene, _blitCam );
		renderer.autoClear = prevAutoClearBlit;
		_blitMat.uniforms.tDiffuse.value = null;

	}

	function getSafeFrameLayout() {

		const res = safeFrame.getResolution();
		const cw = container.dom.offsetWidth;
		const ch = container.dom.offsetHeight;

		if ( ! res.showFrame || cw < 1 || ch < 1 ) {

			return { show: false, x: 0, y: 0, w: cw, h: ch, aspect: cw / Math.max( ch, 1 ), res };

		}

		const rect = safeFrame.computeFrameRect( cw, ch, res.width, res.height );
		// WebGL viewport Y is from bottom
		const glY = ch - rect.y - rect.h;
		return {
			show: true,
			x: rect.x,
			y: glY,
			w: rect.w,
			h: rect.h,
			aspect: res.width / res.height,
			res
		};

	}

	function updateAspectRatio() {

		const layout = getSafeFrameLayout();
		const aspect = layout.w / Math.max( layout.h, 1 );

		for ( const uuid in editor.cameras ) {

			const camera = editor.cameras[ uuid ];

			if ( camera.isPerspectiveCamera ) {

				camera.aspect = aspect;

			} else {

				const frustumHeight = camera.top - camera.bottom;

				camera.left = - frustumHeight * aspect / 2;
				camera.right = frustumHeight * aspect / 2;

			}

			camera.updateProjectionMatrix();

			const cameraHelper = editor.helpers[ camera.id ];
			if ( cameraHelper ) cameraHelper.update();

		}

	}

	const onDownPosition = new THREE.Vector2();
	const onUpPosition = new THREE.Vector2();
	const onDoubleClickPosition = new THREE.Vector2();

	function getMousePosition( dom, x, y ) {

		const rect = dom.getBoundingClientRect();
		return [ ( x - rect.left ) / rect.width, ( y - rect.top ) / rect.height ];

	}

	function handleClick( event ) {

		if ( onDownPosition.distanceTo( onUpPosition ) === 0 ) {

			const intersects = selector.getPointerIntersects( onUpPosition, camera );
			signals.intersectionsDetected.dispatch( intersects, event.shiftKey );

			render();

		}

	}

	function onMouseDown( event ) {

		// event.preventDefault();

		if ( event.target !== renderer.domElement ) return;

		const array = getMousePosition( container.dom, event.clientX, event.clientY );
		onDownPosition.fromArray( array );

		document.addEventListener( 'mouseup', onMouseUp );

	}

	function onMouseUp( event ) {

		const array = getMousePosition( container.dom, event.clientX, event.clientY );
		onUpPosition.fromArray( array );

		handleClick( event );

		document.removeEventListener( 'mouseup', onMouseUp );

	}

	function onTouchStart( event ) {

		const touch = event.changedTouches[ 0 ];

		const array = getMousePosition( container.dom, touch.clientX, touch.clientY );
		onDownPosition.fromArray( array );

		document.addEventListener( 'touchend', onTouchEnd );

	}

	function onTouchEnd( event ) {

		const touch = event.changedTouches[ 0 ];

		const array = getMousePosition( container.dom, touch.clientX, touch.clientY );
		onUpPosition.fromArray( array );

		handleClick( event );

		document.removeEventListener( 'touchend', onTouchEnd );

	}

	function onDoubleClick( event ) {

		const array = getMousePosition( container.dom, event.clientX, event.clientY );
		onDoubleClickPosition.fromArray( array );

		const intersects = selector.getPointerIntersects( onDoubleClickPosition, camera );

		if ( intersects.length > 0 ) {

			const intersect = intersects[ 0 ];

			signals.objectFocused.dispatch( intersect.object );

		}

	}

	container.dom.addEventListener( 'mousedown', onMouseDown );
	container.dom.addEventListener( 'touchstart', onTouchStart, { passive: false } );
	container.dom.addEventListener( 'dblclick', onDoubleClick );

	// controls need to be added *after* main logic,
	// otherwise controls.enabled doesn't work.

	const controls = new EditorControls( camera );
	controls.addEventListener( 'change', function () {

		signals.cameraChanged.dispatch( camera );
		signals.refreshSidebarObject3D.dispatch( camera );

	} );
	viewHelper.center = controls.center;

	editor.controls = controls;

	// signals

	signals.editorCleared.add( function () {

		controls.center.set( 0, 0, 0 );
		if ( pathtracer ) pathtracer.reset();

		initPT();

		signals.sceneEnvironmentChanged.dispatch( editor.environmentType );

	} );

	signals.transformModeChanged.add( function ( mode ) {

		transformControls.setMode( mode );

		render();

	} );

	signals.snapChanged.add( function ( dist ) {

		transformControls.setTranslationSnap( dist );

	} );

	signals.spaceChanged.add( function ( space ) {

		transformControls.setSpace( space );

		render();

	} );

	signals.objectRemoved.add( function ( object ) {

		disposeFccMedia( object );

	} );

	signals.rendererUpdated.add( function () {

		scene.traverse( function ( child ) {

			if ( child.material !== undefined ) {

				child.material.needsUpdate = true;

			}

		} );

		render();

	} );

	signals.rendererCreated.add( function ( newRenderer ) {

		if ( renderer !== null ) {

			renderer.setAnimationLoop( null );

			try {

				pmremGenerator.dispose();

			} catch ( e ) {

				console.warn( 'PMREMGenerator dispose error:', e );

			}

			if ( postComposerBuilt ) {

				postComposerBuilt.dispose();
				postComposerBuilt = null;
				postComposerCameraUuid = null;

			}

			renderer.dispose();

			container.dom.removeChild( renderer.domElement );

		}

		controls.connect( newRenderer.domElement );
		transformControls.connect( newRenderer.domElement );

		renderer = newRenderer;
		editor.fccRenderer = renderer;
		editor.renderer = renderer; // console: editor.renderer === fcc viewport WebGLRenderer

		renderer.setAnimationLoop( animate );
		renderer.setClearColor( 0xaaaaaa );

		if ( window.matchMedia ) {

			const mediaQuery = window.matchMedia( '(prefers-color-scheme: dark)' );
			mediaQuery.addEventListener( 'change', function ( event ) {

				renderer.setClearColor( event.matches ? 0x333333 : 0xaaaaaa );
				updateGridColors( grid1, grid2, event.matches ? GRID_COLORS_DARK : GRID_COLORS_LIGHT );

				render();

			} );

			renderer.setClearColor( mediaQuery.matches ? 0x333333 : 0xaaaaaa );
			updateGridColors( grid1, grid2, mediaQuery.matches ? GRID_COLORS_DARK : GRID_COLORS_LIGHT );

		}

		renderer.getClearColor( editor.viewportColor );

		renderer.setPixelRatio( window.devicePixelRatio );
		renderer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );

		if ( renderer.isWebGLRenderer ) {

			pmremGenerator = new THREE.PMREMGenerator( renderer );
			pmremGenerator.compileEquirectangularShader();

			pathtracer = new ViewportPathtracer( renderer );

		} else {

			pmremGenerator = new PMREMGenerator( renderer );

			pathtracer = null;

		}

		container.dom.appendChild( renderer.domElement );
		if ( editor.backgroundType === 'Default' ) container.dom.classList.add( 'fcc-bg-transparent' );

		updateAspectRatio();

		signals.sceneEnvironmentChanged.dispatch( editor.environmentType );

		render();

	} );

	signals.rendererDetectKTX2Support.add( function ( ktx2Loader ) {

		ktx2Loader.detectSupport( renderer );

	} );

	signals.sceneGraphChanged.add( function () {

		initPT();
		render();

	} );

	signals.animationSampled.add( function () {

		render();

	} );

	signals.cameraChanged.add( function () {

		if ( pathtracer ) pathtracer.reset();

		render();

	} );

	signals.objectSelected.add( function ( object ) {

		selectionBox.visible = false;
		transformControls.detach();

		if ( selector.selection.length > 1 ) {

			selector.getSelectionBox( box );

			selectionBox.visible = true;
			transformControls.attach( selector.group );

		} else if ( object !== null && object !== scene && object !== camera ) {

			// UI overlay nodes are laid out in screen space — skip 3D gizmos.
			if ( ! isFccUI( object ) ) {

				box.setFromObject( object, true );

				if ( box.isEmpty() === false ) {

					selectionBox.visible = true;

				}

				transformControls.attach( object );

			}

		}

		render();

	} );

	signals.objectFocused.add( function ( object ) {

		controls.focus( object );

	} );

	signals.geometryChanged.add( function ( object ) {

		if ( object !== undefined ) {

			box.setFromObject( object, true );

		}

		initPT();
		render();

	} );

	signals.objectChanged.add( function ( object ) {

		if ( editor.selected === object ) {

			box.setFromObject( object, true );

		} else if ( selector.selection.length > 1 && ( object === selector.group || selector.selection.indexOf( object ) !== - 1 ) ) {

			selector.getSelectionBox( box );

		}

		if ( object.isPerspectiveCamera ) {

			object.updateProjectionMatrix();

		}

		const helper = editor.helpers[ object.id ];

		if ( helper !== undefined && helper.isSkeletonHelper !== true ) {

			helper.update();

		}

		// update light helper when light target is changed

		for ( const id in editor.helpers ) {

			const helper = editor.helpers[ id ];

			if ( helper.light && helper.light.target === object ) {

				helper.update();

			}

		}

		initPT();
		render();

	} );

	signals.objectRemoved.add( function ( object ) {

		controls.enabled = true; // see #14180

		if ( object === transformControls.object ) {

			transformControls.detach();

		}

	} );

	signals.materialChanged.add( function () {

		updatePTMaterials();
		render();

	} );

	// background

	signals.sceneBackgroundChanged.add( function ( backgroundType, backgroundColor, backgroundTexture, backgroundEquirectangularTexture, backgroundColorSpace, backgroundBlurriness, backgroundIntensity, backgroundRotation ) {

		editor.backgroundType = backgroundType;

		// Checker behind canvas when Default (alpha canvas shows it through).
		if ( container && container.dom ) {
			container.dom.classList.toggle( 'fcc-bg-transparent', backgroundType === 'Default' );
		}

		scene.background = null;

		switch ( backgroundType ) {

			case 'Color':

				scene.background = new THREE.Color( backgroundColor );
				// Keep viewportColor in sync (BeautyClear + text-anim pack export).
				// Do not leave it at chrome clear #aaaaaa / #333333.
				if ( editor.viewportColor && editor.viewportColor.isColor ) {

					editor.viewportColor.copy( scene.background );

				}

				break;

			case 'Texture':

				if ( backgroundTexture ) {

					backgroundTexture.colorSpace = backgroundColorSpace;
					backgroundTexture.needsUpdate = true;

					scene.background = backgroundTexture;

				}

				break;

			case 'Equirectangular':

				if ( backgroundEquirectangularTexture ) {

					backgroundEquirectangularTexture.mapping = THREE.EquirectangularReflectionMapping;
					backgroundEquirectangularTexture.colorSpace = backgroundColorSpace;
					backgroundEquirectangularTexture.needsUpdate = true;

					scene.background = backgroundEquirectangularTexture;
					scene.backgroundBlurriness = backgroundBlurriness;
					scene.backgroundIntensity = backgroundIntensity;
					scene.backgroundRotation.y = backgroundRotation * THREE.MathUtils.DEG2RAD;

				}

				break;

		}

		if ( useBackgroundAsEnvironment ) {

			signals.sceneEnvironmentChanged.dispatch( editor.environmentType );

		}

		updatePTBackground();
		render();

	} );

	// environment

	let useBackgroundAsEnvironment = false;

	signals.sceneEnvironmentChanged.add( function ( environmentType, environmentEquirectangularTexture ) {

		editor.environmentType = environmentType;

		scene.environment = null;

		useBackgroundAsEnvironment = false;

		switch ( environmentType ) {

			case 'Equirectangular':

				if ( environmentEquirectangularTexture ) {

					scene.environment = environmentEquirectangularTexture;
					scene.environment.mapping = THREE.EquirectangularReflectionMapping;

				}

				break;

			case 'Default':

				useBackgroundAsEnvironment = true;

				if ( scene.background !== null ) {

					if ( scene.background.isColor ) {

						scene.environment = pmremGenerator.fromScene( new ColorEnvironment( scene.background ), 0.04 ).texture;

					} else if ( scene.background.isTexture ) {

						scene.environment = scene.background;
						scene.environment.mapping = THREE.EquirectangularReflectionMapping;
						scene.environmentRotation.y = scene.backgroundRotation.y;

					}

				} else {

					scene.environment = pmremGenerator.fromScene( new RoomEnvironment(), 0.04 ).texture;

				}

				break;

		}

		updatePTEnvironment();
		render();

	} );

	// fog

	signals.sceneFogChanged.add( function ( fogType, fogColor, fogNear, fogFar, fogDensity ) {

		switch ( fogType ) {

			case 'None':
				scene.fog = null;
				break;
			case 'Fog':
				scene.fog = new THREE.Fog( fogColor, fogNear, fogFar );
				break;
			case 'FogExp2':
				scene.fog = new THREE.FogExp2( fogColor, fogDensity );
				break;

		}

		render();

	} );

	signals.sceneFogSettingsChanged.add( function ( fogType, fogColor, fogNear, fogFar, fogDensity ) {

		switch ( fogType ) {

			case 'Fog':
				scene.fog.color.setHex( fogColor );
				scene.fog.near = fogNear;
				scene.fog.far = fogFar;
				break;
			case 'FogExp2':
				scene.fog.color.setHex( fogColor );
				scene.fog.density = fogDensity;
				break;

		}

		render();

	} );

	signals.viewportCameraChanged.add( function () {

		const viewportCamera = editor.viewportCamera;

		if ( viewportCamera.isPerspectiveCamera || viewportCamera.isOrthographicCamera ) {

			updateAspectRatio();

		}

		// Editor navigation camera: enable orbit controls and re-bind helpers.
		// Scene cameras: lock EditorControls (view follows that camera's transform).
		const isEditorCam = ( viewportCamera === editor.camera );
		controls.enabled = isEditorCam;

		if ( isEditorCam ) {

			camera = editor.camera;
			controls.setCamera( camera );
			transformControls.camera = camera;
			viewHelper.camera = camera;

		}

		syncFccListenerToCamera( editor );
		initPT();
		render();

	} );

	signals.viewportShadingChanged.add( function () {

		const viewportShading = editor.viewportShading;

		switch ( viewportShading ) {

			case 'realistic':
				if ( pathtracer ) pathtracer.init( scene, editor.viewportCamera );
				break;

			case 'solid':
				scene.overrideMaterial = null;
				break;

			case 'normals':
				scene.overrideMaterial = new THREE.MeshNormalMaterial();
				break;

			case 'wireframe':
				scene.overrideMaterial = new THREE.MeshBasicMaterial( { color: 0x000000, wireframe: true } );
				break;

		}

		render();

	} );

	//

	signals.resolutionChanged.add( function () {

		updateAspectRatio();
		if ( safeFrame && safeFrame.update ) safeFrame.update();
		render();

	} );

	signals.windowResize.add( function () {

		updateAspectRatio();

		if ( renderer === null ) return;

		renderer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );
		if ( pathtracer ) pathtracer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );

		render();

	} );

	signals.animationPanelResized.add( function () {

		updateAspectRatio();
		if ( safeFrame && safeFrame.update ) safeFrame.update();
		if ( renderer !== null ) {
			renderer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );
			if ( pathtracer ) pathtracer.setSize( container.dom.offsetWidth, container.dom.offsetHeight );
		}
		render();

	} );

	signals.showHelpersChanged.add( function ( appearanceStates ) {

		grid.visible = appearanceStates.gridHelper;

		sceneHelpers.traverse( function ( object ) {

			switch ( object.type ) {

				case 'CameraHelper':

				{

					object.visible = appearanceStates.cameraHelpers;
					break;

				}

				case 'PointLightHelper':
				case 'DirectionalLightHelper':
				case 'SpotLightHelper':
				case 'HemisphereLightHelper':

				{

					object.visible = appearanceStates.lightHelpers;
					break;

				}

				case 'SkeletonHelper':

				{

					object.visible = appearanceStates.skeletonHelpers;
					break;

				}

				default:

				{

					// not a helper, skip.

				}

			}

		} );


		render();

	} );

	signals.cameraResetted.add( function () {

		if ( camera !== editor.camera ) {

			camera = editor.camera;

			controls.setCamera( camera );
			transformControls.camera = camera;
			viewHelper.camera = camera;

		}

		updateAspectRatio();
		render();

	} );

	// animations

	let prevActionsInUse = 0;

	const timer = new THREE.Timer(); // only used for animations
	let lastAnimDelta = 0;

	function animate() {

		timer.update();

		const mixer = editor.mixer;
		const delta = timer.getDelta();
		lastAnimDelta = delta;

		let needsUpdate = false;

		// Animations

		const actions = mixer.stats.actions;

		if ( actions.inUse > 0 || prevActionsInUse > 0 ) {

			prevActionsInUse = actions.inUse;

			mixer.update( delta );
			needsUpdate = true;

			if ( editor.selected !== null ) {

				editor.selected.updateWorldMatrix( false, true ); // avoid frame late effect for certain skinned meshes (e.g. Michelle.glb)
				selectionBox.box.setFromObject( editor.selected, true ); // selection box should reflect current animation state

			}

			signals.morphTargetsUpdated.dispatch();

		}

		// View Helper

		if ( viewHelper.animating === true ) {

			viewHelper.update( delta );
			needsUpdate = true;

		}

		if ( renderer.xr.isPresenting === true ) {

			needsUpdate = true;

		}

		if ( fccVideoPlaying( scene ) ) needsUpdate = true;

		if ( editor.fccTimelineEditor && editor.fccTimelineEditor.sampleIfPlaying ) {

			editor.fccTimelineEditor.sampleIfPlaying( delta );
			if ( editor.fccTimelineEditor.isPlaying && editor.fccTimelineEditor.isPlaying() ) needsUpdate = true;

		}

		if ( editor.stickerMotionPreview && typeof editor.advanceStickerMotion === 'function' ) {

			if ( editor.advanceStickerMotion( delta ) ) needsUpdate = true;

		}

		if ( editor.faceFxPreview && editor.faceFxPreview.enabled ) needsUpdate = true;

		if ( needsUpdate === true ) render();

		updatePT();

	}

	function initPT() {

		if ( pathtracer && editor.viewportShading === 'realistic' ) {

			pathtracer.init( scene, editor.viewportCamera );

		}

	}

	function updatePTBackground() {

		if ( pathtracer && editor.viewportShading === 'realistic' ) {

			pathtracer.setBackground( scene.background, scene.backgroundBlurriness );

		}

	}

	function updatePTEnvironment() {

		if ( pathtracer && editor.viewportShading === 'realistic' ) {

			pathtracer.setEnvironment( scene.environment );

		}

	}

	function updatePTMaterials() {

		if ( pathtracer && editor.viewportShading === 'realistic' ) {

			pathtracer.updateMaterials();

		}

	}

	function updatePT() {

		if ( pathtracer && editor.viewportShading === 'realistic' ) {

			pathtracer.update();
			editor.signals.pathTracerUpdated.dispatch( pathtracer.getSamples() );

		}

	}

	//

	let startTime = 0;
	let endTime = 0;

	function render() {

		if ( renderer === null ) return;
		// PreviewCapture holds the GL context while waiting on PP textures /
		// reading pixels — skip so setSize / composers are not stomped mid-export.
		if ( editor.__fccSuspendViewportRender ) return;

		syncFccListenerToCamera( editor );
		updateFccVideos( renderer, scene );
		if ( editor.faceFxPreview && editor.faceFxPreview.enabled ) {

			editor.faceFxPreview.update( renderer, scene, lastAnimDelta );

		}

		// Char poses first, then text-scope bend / wipe in the Troika materials
		// (they read the posed char matrices). Values come from the last .anim
		// sample (animation panel / timeline), see TextAnimOverrides.
		applyTextAnimsInScene( scene );
		// Stickers follow posed glyph AABB (after char anim, before geom fx / TextFx).
		applyTextStickersInScene( scene, editor.materials );
		applyTextGeomFxInScene( scene, {
			enabled: ! stickerPreviewActive( editor ),
			debug: !! editor.textAnimWipeDebug,
		} );

		startTime = performance.now();

		const cw = container.dom.offsetWidth;
		const ch = container.dom.offsetHeight;
		const layout = getSafeFrameLayout();

		// Canvas clear: Default => fully transparent (checker/page shows through empty beauty).
		// Color/Texture => opaque chrome; letterbox bars filled opaque below when Default.
		renderer.setScissorTest( false );
		renderer.setViewport( 0, 0, cw, ch );
		if ( isTransparentBackground( editor ) ) {
			renderer.setClearColor( 0x000000, 0 );
		} else {
			applyLetterboxChromeClear( renderer );
		}
		renderer.clear();
		if ( isTransparentBackground( editor ) ) {
			fillLetterboxBarsOpaque( renderer, layout, cw, ch );
		}

		const vpCam = editor.viewportCamera;
		// SS-Camera contract: prepareCameraMode enables UI_CAMERA_LAYER on vpCam so
		// RenderPass beauty = scene meshes + Camera-mode UI, then Bloom/DeepGlow see both.
		// Overlay UI is drawn AFTER present (intentionally NOT in this stack).
		// usePost reads ONLY vpCam.userData.postProcessStack (editor nav cam never keeps one).
		const usePost = stackHasEnabledEffects( vpCam );
		const projectRes = layout.res || safeFrame.getResolution();
		// Global screen uniforms (uResolution / uScreenParams) = project/safe-frame pixels.
		applyGlobalScreenParamsToMaterials( editor.materials, projectRes.width, projectRes.height );
		applyGlobalScreenParamsToObject3D( scene, projectRes.width, projectRes.height );

		// Post-process must match the camera image inside the safe frame (project
		// resolution), not the full canvas or on-screen letterbox CSS size — otherwise
		// bloom kernels scale with window resize / safe-frame toggle and diverge from OpenCut.
		const wantAspect = usePost
			? ( projectRes.width / Math.max( projectRes.height, 1 ) )
			: ( layout.w / Math.max( layout.h, 1 ) );

		if ( vpCam.isPerspectiveCamera ) {
			if ( Math.abs( ( vpCam.aspect || 0 ) - wantAspect ) > 1e-6 ) {
				vpCam.aspect = wantAspect;
				vpCam.updateProjectionMatrix();
			}
		} else if ( vpCam.isOrthographicCamera ) {
			const frustumHeight = vpCam.top - vpCam.bottom;
			const wantLeft = - frustumHeight * wantAspect / 2;
			const wantRight = frustumHeight * wantAspect / 2;
			if ( Math.abs( vpCam.left - wantLeft ) > 1e-6 || Math.abs( vpCam.right - wantRight ) > 1e-6 ) {
				vpCam.left = wantLeft;
				vpCam.right = wantRight;
				vpCam.updateProjectionMatrix();
			}
		}

		// Screen Space–Camera UI: lay out in front of beauty cam and enable layer
		// so RenderPass / non-PP beauty includes UI (before post-process).
		uiOverlay.prepareCameraMode( projectRes.width, projectRes.height );

		const stickerPreviewOn = stickerPreviewActive( editor );

		if ( stickerPreviewOn ) {

			const pose = sampleStickerMotion(
				normalizeStickerMotion( editor.stickerMotion ),
				editor.stickerMotionTime || 0,
			);
			renderStickerMotionPreview( {
				renderer,
				scene,
				camera: vpCam,
				rect: layout,
				pose,
				overlay: uiOverlay,
				projectRes,
			} );

		} else if ( usePost ) {

			// Composer FBO = project / safe-frame pixel size (not full canvas, not CSS letterbox).
			// Window-offset scissor during composer.render() still clips FBO passes empty.
			const compW = Math.max( 1, Math.floor( projectRes.width ) );
			const compH = Math.max( 1, Math.floor( projectRes.height ) );

			// Present destination = safe-frame content rect on screen (letterboxed).
			// Even if the overlay is hidden, blit into the same content rect so bars
			// stay clear and bloom never samples outside the camera image.
			let presentLayout = layout;
			if ( ! layout.show ) {
				const rect = safeFrame.computeFrameRect( cw, ch, projectRes.width, projectRes.height );
				presentLayout = {
					x: rect.x,
					y: ch - rect.y - rect.h,
					w: rect.w,
					h: rect.h,
				};
			}

			if (
				needsComposerRebuild( postComposerBuilt, vpCam, compW, compH, renderer ) ||
				postComposerCameraUuid !== vpCam.uuid
			) {
				if ( postComposerBuilt ) postComposerBuilt.dispose();
				postComposerBuilt = buildComposerForCamera( {
					renderer,
					scene,
					camera: vpCam,
					width: compW,
					height: compH,
				} );
				postComposerCameraUuid = vpCam.uuid;
			} else if ( postComposerBuilt ) {
				// Param-only changes (threshold / strength / radius):
				// apply onto live passes — do not dispose/rebuild the composer.
				syncComposerParams( postComposerBuilt, vpCam );
			}
			// CapCut SeekModeScript: while timeline owns the playhead, fade
			// 超级大光斑 with (1-progress)^4 so play matches hover-GIF export.
			if ( postComposerBuilt && editor.timelinePreviewOwnsAnim && editor.fccTimelineEditor
				&& typeof editor.fccTimelineEditor.getExportState === 'function' ) {

				const tl = editor.fccTimelineEditor.getExportState();
				if ( tl && tl.duration > 1e-6 ) {

					applyBokehSeekEnvelope( postComposerBuilt, vpCam, tl.time / tl.duration );

				}

			}

			renderer.setScissorTest( false );
			renderer.setViewport( 0, 0, cw, ch );
			if ( isTransparentBackground( editor ) ) {
				renderer.setClearColor( 0x000000, 0 );
			} else {
				applyLetterboxChromeClear( renderer );
			}
			renderer.clear();
			if ( isTransparentBackground( editor ) ) {
				fillLetterboxBarsOpaque( renderer, presentLayout, cw, ch );
			}

			if ( postComposerBuilt && postComposerBuilt.composer ) {
				presentComposerToLetterbox( postComposerBuilt.composer, presentLayout, compW, compH );
			} else {
				renderSceneWithColorOutput( renderer, scene, vpCam, presentLayout );
			}

		} else {

			if ( postComposerBuilt ) {
				postComposerBuilt.dispose();
				postComposerBuilt = null;
				postComposerCameraUuid = null;
			}

			if ( isTransparentBackground( editor ) ) {
				fillLetterboxBarsOpaque( renderer, layout, cw, ch );
			}
			applyBeautyClear( renderer, editor );

			// Linear scene, then one sRGB (and tone-map) present. Same final step as OutputPass.
			renderSceneWithColorOutput( renderer, scene, vpCam, layout );

		}

		uiOverlay.restoreCameraMode();

		if ( camera === editor.viewportCamera && ! stickerPreviewOn ) {

			renderer.autoClear = false;
			if ( grid.visible === true ) renderer.render( grid, camera );
			if ( sceneHelpers.visible === true ) renderer.render( sceneHelpers, camera );
			renderer.autoClear = true;

		}

		// FreeFilmCut UGUI: draw Screen-Space Overlay AFTER post-process / 3D
		// (and after editor helpers), still inside the safe-frame letterbox.
		// Sticker-motion preview already drew overlay into the motion buffer.
		if ( ! stickerPreviewOn ) {
			let uiLayout = layout;
			if ( usePost && ! layout.show ) {
				const rect = safeFrame.computeFrameRect( cw, ch, projectRes.width, projectRes.height );
				uiLayout = {
					x: rect.x,
					y: ch - rect.y - rect.h,
					w: rect.w,
					h: rect.h,
				};
			}
			// CSS (top-left) letterbox rect for Selector overlay picking.
			editor.fccUIPickLayout = {
				x: uiLayout.x,
				y: ch - uiLayout.y - uiLayout.h,
				w: uiLayout.w,
				h: uiLayout.h,
				cssW: cw,
				cssH: ch,
			};
			// Overlay: Text→RT→TextFx→blit when preview toggle / TextFx on.
			// Bend / wipeReveal are already in the Troika materials.
			const hasOverlayUI = sceneHasOverlayCanvas( scene );
			let textFxStack = null;
			const sel = editor.selected;
			if ( hasOverlayUI && sel && isUIText( sel )
				&& getOwningCanvasRenderMode( sel ) !== RENDER_MODE_CAMERA ) {

				const ui = getFccUI( sel );
				textFxStack = ( ui && ui.textFxStack ) ? ui.textFxStack : null;

			}

			const wantTextRT = hasOverlayUI && (
				editor.textLayerRTPreview === true
				|| stackDataHasEnabledEffects( textFxStack )
			);

			if ( wantTextRT ) {

				// Front stickers must sit above text + TextFx stack. Keep them out of
				// the RT so bloom/glow cannot cover them; present them after blit.
				const hasFrontStickers = sceneHasFrontTextStickers( scene );
				if ( hasFrontStickers ) setTextStickerFrontRootsVisible( scene, false );
				try {

					const textRT = ensureTextLayerRenderTarget( projectRes.width, projectRes.height );
					renderOverlayTextLayerToRT( {
						renderer,
						uiOverlay,
						resW: projectRes.width,
						resH: projectRes.height,
						target: textRT,
					} );

					const outTex = applyTextLayerFx( {
						renderer,
						target: textRT,
						stack: textFxStack,
					} ) || textRT.texture;
					blitTextLayerToLetterbox( {
						renderer,
						texture: outTex,
						rect: uiLayout,
						opacity: 1,
					} );

					if ( hasFrontStickers ) {

						setTextStickerFrontRootsVisible( scene, true );
						withTextContentHiddenExceptFrontStickers( scene, () => {

							uiOverlay.present( renderer, uiLayout, projectRes.width, projectRes.height );

						} );

					}

				} finally {

					if ( hasFrontStickers ) setTextStickerFrontRootsVisible( scene, true );

				}

			} else {

				uiOverlay.render( renderer, uiLayout, projectRes.width, projectRes.height );

			}
		}

		if ( camera === editor.viewportCamera ) {

			renderer.autoClear = false;
			if ( renderer.xr.isPresenting !== true ) viewHelper.render( renderer );
			renderer.autoClear = true;

		}

		renderer.setScissorTest( false );

		endTime = performance.now();
		editor.signals.sceneRendered.dispatch( endTime - startTime );

	}

	return container;

}

function stickerPreviewActive( editor ) {

	return editor.stickerMotionPreview === true
		&& !! editor.config
		&& editor.config.getKey( 'project/vfxpack/type' ) === 'sticker-anim';

}

function sceneHasOverlayCanvas( scene ) {

	let found = false;
	scene.traverse( ( o ) => {

		if ( found || ! isUICanvas( o ) ) return;
		// Nested canvases are laid out by their parent; only roots count.
		if ( o.parent && isUICanvas( o.parent ) ) return;
		if ( getCanvasRenderMode( o ) !== RENDER_MODE_CAMERA ) found = true;

	} );
	return found;

}

function updateGridColors( grid1, grid2, colors ) {

	grid1.material.color.setHex( colors[ 0 ] );
	grid2.material.color.setHex( colors[ 1 ] );

}

export { Viewport };
