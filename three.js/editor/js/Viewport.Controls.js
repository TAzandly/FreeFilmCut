import { UIPanel, UISelect } from './libs/ui.js';

/**
 * Viewport top-right camera / shading selectors.
 * Always keeps a way back to the default editor camera (editor.camera).
 */
function ViewportControls( editor ) {

	const signals = editor.signals;

	const container = new UIPanel();
	container.setPosition( 'absolute' );
	container.setRight( '10px' );
	container.setTop( '10px' );
	// Above #safe-frame (z-index 2) and the WebGL canvas so the menu stays clickable
	container.setZIndex( '5' );

	// camera

	const cameraSelect = new UISelect();
	cameraSelect.setMarginRight( '10px' );
	cameraSelect.onChange( function () {

		const value = this.getValue();
		// Prefer live editor.camera reference (uuid may change after fromJSON / setCameraType)
		if ( ! value || value === '__editor__' || value === editor.camera.uuid ) {

			editor.setViewportCamera( editor.camera.uuid );

		} else {

			editor.setViewportCamera( value );

		}

	} );
	container.add( cameraSelect );

	signals.cameraAdded.add( update );
	signals.cameraRemoved.add( update );
	signals.objectChanged.add( function ( object ) {

		if ( object && object.isCamera ) {

			updateCameraList();

		}

	} );
	signals.viewportCameraChanged.add( function () {

		// Keep dropdown in sync when viewport camera changes from elsewhere
		updateCameraList();

	} );

	// shading

	const shadingSelect = new UISelect();
	shadingSelect.setOptions( { 'realistic': 'realistic', 'solid': 'solid', 'normals': 'normals', 'wireframe': 'wireframe' } );
	shadingSelect.setValue( 'solid' );
	shadingSelect.onChange( function () {

		editor.setViewportShading( this.getValue() );

	} );
	container.add( shadingSelect );

	signals.editorCleared.add( function () {

		editor.setViewportCamera( editor.camera.uuid );

		shadingSelect.setValue( 'solid' );
		editor.setViewportShading( shadingSelect.getValue() );
		updateCameraList();

	} );

	signals.cameraResetted.add( update );

	update();

	//

	function editorCameraLabel() {

		const base = editor.camera.name || 'Camera';
		const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
		if ( lang === 'zh' ) return '[编辑器] ' + base;
		return '[ Editor ] ' + base;

	}

	function updateCameraList() {

		// Editor camera must always appear, even if it was dropped from the map
		if ( editor.cameras[ editor.camera.uuid ] !== editor.camera ) {

			editor.cameras[ editor.camera.uuid ] = editor.camera;

		}

		const options = {};

		// Editor camera first so it is easy to find / return to
		options[ editor.camera.uuid ] = editorCameraLabel();

		const cameras = editor.cameras;

		for ( const key in cameras ) {

			const camera = cameras[ key ];
			if ( ! camera || camera === editor.camera ) continue;
			options[ camera.uuid ] = camera.name || camera.type || camera.uuid.slice( 0, 8 );

		}

		cameraSelect.setOptions( options );

		const vp = editor.viewportCamera;
		const selectedUuid = ( vp && vp.uuid in options ) ? vp.uuid : editor.camera.uuid;

		cameraSelect.setValue( selectedUuid );

		return ( selectedUuid === editor.camera.uuid ) ? editor.camera : ( cameras[ selectedUuid ] || editor.camera );

	}

	function update() {

		const selectedCamera = updateCameraList();
		// Only force viewport camera when list refresh implies current vp is gone
		if ( editor.viewportCamera !== selectedCamera ) {

			editor.setViewportCamera( selectedCamera.uuid );

		}

	}

	return container;

}

export { ViewportControls };
