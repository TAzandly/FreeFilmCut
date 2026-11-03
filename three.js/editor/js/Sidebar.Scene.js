import * as THREE from 'three';

import { UIPanel, UIBreak, UIRow, UIColor, UISelect, UIText, UINumber, UICheckbox } from './libs/ui.js';
import { UIOutliner, UITexture } from './libs/ui.three.js?v=fcc-ui-106';

import {
	objectHasAnimController,
	collectAnimTargetUuids,
	attachAnimController,
	detachAnimController,
	countObjectAnimKeys,
	releaseEmptyCanvasControllers,
} from './anim/FreeCapCutAnimCore.js?v=fcc-anim-20';
import { listenerSettings, setFccListenerSettings, resumeAndRouteVideos, ensureFccAudioListener } from './media/FccAudio.js?v=fcc-ui-106';

function SidebarScene( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;

	const container = new UIPanel();
	container.setBorderTop( '0' );
	container.setPaddingTop( '20px' );

	// outliner

	const nodeStates = new WeakMap();

	let animTargetUuids = new Set();

	function refreshAnimTargetCache() {

		releaseEmptyCanvasControllers( editor );
		animTargetUuids = collectAnimTargetUuids( editor );

	}


	function fccVisibleChildCount( object ) {

		let n = 0;
		for ( let i = 0; i < object.children.length; i ++ ) {

			const c = object.children[ i ];
			if ( c && c.name && String( c.name ).indexOf( '__fcc' ) === 0 ) continue;
			n ++;

		}
		return n;

	}

	function buildOption( object, draggable ) {

		const option = document.createElement( 'div' );
		option.draggable = draggable;
		option.innerHTML = buildHTML( object );
		option.value = object.id;

		// opener

		if ( nodeStates.has( object ) ) {

			const state = nodeStates.get( object );

			const opener = document.createElement( 'span' );
			opener.classList.add( 'opener' );

			if ( fccVisibleChildCount( object ) > 0 ) {

				opener.classList.add( state ? 'open' : 'closed' );

			}

			opener.addEventListener( 'click', function ( event ) {

				event.preventDefault();
				event.stopPropagation();
				nodeStates.set( object, nodeStates.get( object ) === false ); // toggle
				refreshUI();

			} );

			option.insertBefore( opener, option.firstChild );

		}

		const animBtn = option.querySelector( '[data-fcc-anim]' );
		if ( animBtn ) {

			animBtn.addEventListener( 'click', function ( event ) {

				event.preventDefault();
				event.stopPropagation();
				toggleAnimControllerForObject( object );

			} );

		}

		return option;

	}

	function getMaterialName( material ) {

		if ( Array.isArray( material ) ) {

			const array = [];

			for ( let i = 0; i < material.length; i ++ ) {

				array.push( material[ i ].name );

			}

			return array.join( ',' );

		}

		return material.name;

	}

	function escapeHTML( html ) {

		return html
			.replace( /&/g, '&amp;' )
			.replace( /"/g, '&quot;' )
			.replace( /'/g, '&#39;' )
			.replace( /</g, '&lt;' )
			.replace( />/g, '&gt;' );

	}

	function getObjectType( object ) {

		if ( object.isScene ) return 'Scene';
		if ( object.isCamera ) return 'Camera';
		if ( object.isLight ) return 'Light';
		if ( object.isMesh ) return 'Mesh';
		if ( object.isLine ) return 'Line';
		if ( object.isPoints ) return 'Points';

		return 'Object3D';

	}

	function buildHTML( object ) {

		let html = `<span class="type ${ getObjectType( object ) }"></span> ${ escapeHTML( object.name ) }`;

		if ( object.isMesh ) {

			const geometry = object.geometry;
			const material = object.material;

			html += ` <span class="type Geometry"></span> ${ escapeHTML( geometry.name ) }`;
			html += ` <span class="type Material"></span> ${ escapeHTML( getMaterialName( material ) ) }`;

		}

		html += getScript( object.uuid );
		html += getAnimCtrl( object );

		return html;

	}

	function getScript( uuid ) {

		if ( editor.scripts[ uuid ] === undefined ) return '';

		if ( editor.scripts[ uuid ].length === 0 ) return '';

		return ' <span class="type Script"></span>';

	}

	function getAnimCtrl( object ) {

		if ( ! object || object === editor.scene ) return '';

		const on = objectHasAnimController( object ) || countObjectAnimKeys( editor, object.uuid ) > 0;
		const title = on
			? ( strings.getKey( 'sidebar/scene/animRemove' ) || '\u79fb\u9664\u52a8\u753b\u63a7\u5236\u5668' )
			: ( strings.getKey( 'sidebar/scene/animAdd' ) || '\u6dfb\u52a0\u52a8\u753b\u63a7\u5236\u5668' );
		const label = on ? '\u52a8' : '+';
		const cls = on ? 'AnimCtrl on' : 'AnimCtrl';
		return ` <span class="${ cls }" data-fcc-anim="1" title="${ escapeHTML( title ) }">${ label }</span>`;

	}

	function toggleAnimControllerForObject( object ) {

		if ( ! object || object === editor.scene ) return;

		const on = objectHasAnimController( object ) || countObjectAnimKeys( editor, object.uuid ) > 0;
		if ( on ) {

			const keys = countObjectAnimKeys( editor, object.uuid );
			if ( keys > 0 ) {

				const msg = ( strings.getKey( 'sidebar/scene/animRemoveConfirm' ) || '\u8be5\u5bf9\u8c61\u5df2\u6709 {n} \u4e2a\u5173\u952e\u5e27\uff0c\u79fb\u9664\u63a7\u5236\u5668\u5c06\u540c\u65f6\u5220\u9664\u8f68\u9053\u3002\u7ee7\u7eed\uff1f' ).replace( '{n}', String( keys ) );
				if ( ! window.confirm( msg ) ) return;

			}
			detachAnimController( editor, object, { removeTracks: true } );
			signals.objectChanged.dispatch( object );
			if ( signals.freecapcutAnimsChanged ) signals.freecapcutAnimsChanged.dispatch();
			refreshAnimTargetCache();
			signals.sceneGraphChanged.dispatch();

		} else {

			attachAnimController( editor, object );
			signals.objectChanged.dispatch( object );
			refreshAnimTargetCache();
			// refresh this row
			signals.sceneGraphChanged.dispatch();
			if ( typeof editor.openAnimationPanel === 'function' ) {

				editor.openAnimationPanel();

			} else if ( typeof editor.toggleAnimationPanel === 'function' ) {

				editor.toggleAnimationPanel();

			}

		}

	}

	let ignoreObjectSelectedSignal = false;

	const outliner = new UIOutliner( editor );
	outliner.setId( 'outliner' );
	outliner.onChange( function ( event ) {

		const raw = outliner.getValue();
		const id = typeof raw === 'number' ? raw : parseInt( raw, 10 );
		if ( ! Number.isFinite( id ) ) return;

		if ( event && event.shiftKey === true && editor.selector.selection.length > 0 && editor.selected !== editor.scene && editor.selected !== editor.camera ) {

			const object = ( id === editor.camera.id ) ? editor.camera : editor.scene.getObjectById( id );

			// scene and main camera can't be part of a group selection

			if ( object && object !== editor.scene && object !== editor.camera ) {

				editor.selector.toggle( object );
				return;

			}

		}

		ignoreObjectSelectedSignal = true;

		editor.selectById( id );

		ignoreObjectSelectedSignal = false;

	} );
	outliner.onDblClick( function () {

		editor.focusById( parseInt( outliner.getValue() ) );

	} );
	container.add( outliner );
	container.add( new UIBreak() );

	const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
	const isZh = lang === 'zh';

	const audioTitle = new UIRow();
	audioTitle.add( new UIText( isZh ? '音频监听' : 'Audio Listener' ).setTextTransform( 'uppercase' ) );
	container.add( audioTitle );

	const audioVolumeRow = new UIRow();
	audioVolumeRow.add( new UIText( isZh ? '总音量' : 'Volume' ).setClass( 'Label' ) );
	const audioVolume = new UINumber( 1 ).setPrecision( 2 ).setRange( 0, 1 ).setWidth( '50px' ).onChange( function () {

		setFccListenerSettings( editor, { volume: audioVolume.getValue() } );
		resumeAndRouteVideos( editor );

	} );
	audioVolumeRow.add( audioVolume );
	container.add( audioVolumeRow );

	const audioMuteRow = new UIRow();
	audioMuteRow.add( new UIText( isZh ? '总静音' : 'Mute' ).setClass( 'Label' ) );
	const audioMute = new UICheckbox( false ).onChange( function () {

		setFccListenerSettings( editor, { muted: audioMute.getValue() === true } );
		resumeAndRouteVideos( editor );

	} );
	audioMuteRow.add( audioMute );
	container.add( audioMuteRow );

	function refreshAudioListener() {

		const s = listenerSettings( editor );
		audioVolume.setValue( s.volume );
		audioMute.setValue( s.muted );
		ensureFccAudioListener( editor );

	}

	refreshAudioListener();
	signals.sceneGraphChanged.add( refreshAudioListener );

	container.add( new UIBreak() );

	// background

	const backgroundRow = new UIRow();

	const backgroundType = new UISelect().setOptions( {

		'Default': 'Default',
		'Color': 'Color',
		'Texture': 'Texture',
		'Equirectangular': 'Equirect'

	} ).setWidth( '150px' );
	backgroundType.setValue( 'Default' );
	backgroundType.onChange( function () {

		onBackgroundChanged();
		refreshBackgroundUI();

	} );

	backgroundRow.add( new UIText( strings.getKey( 'sidebar/scene/background' ) ).setClass( 'Label' ) );
	backgroundRow.add( backgroundType );

	const backgroundColor = new UIColor().setValue( '#000000' ).setMarginLeft( '8px' ).onInput( onBackgroundChanged );
	backgroundRow.add( backgroundColor );

	const backgroundTexture = new UITexture( editor ).setMarginLeft( '8px' ).onChange( onBackgroundChanged );
	backgroundTexture.setDisplay( 'none' );
	backgroundRow.add( backgroundTexture );

	const backgroundEquirectangularTexture = new UITexture( editor ).setMarginLeft( '8px' ).onChange( onBackgroundChanged );
	backgroundEquirectangularTexture.setDisplay( 'none' );
	backgroundRow.add( backgroundEquirectangularTexture );

	const backgroundColorSpaceRow = new UIRow();
	backgroundColorSpaceRow.setDisplay( 'none' );
	backgroundColorSpaceRow.setMarginLeft( '120px' );

	const backgroundColorSpace = new UISelect().setOptions( {

		[ THREE.NoColorSpace ]: 'No Color Space',
		[ THREE.LinearSRGBColorSpace ]: 'srgb-linear',
		[ THREE.SRGBColorSpace ]: 'srgb',

	} ).setWidth( '150px' );
	backgroundColorSpace.setValue( THREE.NoColorSpace );
	backgroundColorSpace.onChange( onBackgroundChanged );
	backgroundColorSpaceRow.add( backgroundColorSpace );

	container.add( backgroundRow );
	container.add( backgroundColorSpaceRow );

	const backgroundEquirectRow = new UIRow();
	backgroundEquirectRow.setDisplay( 'none' );
	backgroundEquirectRow.setMarginLeft( '120px' );

	const backgroundBlurriness = new UINumber( 0 ).setWidth( '40px' ).setRange( 0, 1 ).onChange( onBackgroundChanged );
	backgroundEquirectRow.add( backgroundBlurriness );

	const backgroundIntensity = new UINumber( 1 ).setWidth( '40px' ).setRange( 0, Infinity ).onChange( onBackgroundChanged );
	backgroundEquirectRow.add( backgroundIntensity );

	const backgroundRotation = new UINumber( 0 ).setWidth( '40px' ).setRange( - 180, 180 ).setStep( 10 ).setNudge( 0.1 ).setUnit( '°' ).onChange( onBackgroundChanged );
	backgroundEquirectRow.add( backgroundRotation );

	container.add( backgroundEquirectRow );

	function onBackgroundChanged() {

		signals.sceneBackgroundChanged.dispatch(
			backgroundType.getValue(),
			backgroundColor.getHexValue(),
			backgroundTexture.getValue(),
			backgroundEquirectangularTexture.getValue(),
			backgroundColorSpace.getValue(),
			backgroundBlurriness.getValue(),
			backgroundIntensity.getValue(),
			backgroundRotation.getValue()
		);

	}

	function refreshBackgroundUI() {

		const type = backgroundType.getValue();

		backgroundType.setWidth( type === 'Default' ? '150px' : '110px' );
		backgroundColor.setDisplay( type === 'Color' ? '' : 'none' );
		backgroundTexture.setDisplay( type === 'Texture' ? '' : 'none' );
		backgroundEquirectangularTexture.setDisplay( type === 'Equirectangular' ? '' : 'none' );
		backgroundEquirectRow.setDisplay( type === 'Equirectangular' ? '' : 'none' );

		if ( type === 'Texture' || type === 'Equirectangular' ) {

			backgroundColorSpaceRow.setDisplay( '' );

		} else {

			backgroundColorSpaceRow.setDisplay( 'none' );

		}

	}

	// environment

	const environmentRow = new UIRow();

	const environmentType = new UISelect().setOptions( {

		'Default': 'Default',
		'Equirectangular': 'Equirect',
		'None': 'None'

	} ).setWidth( '150px' );
	environmentType.setValue( 'Default' );
	environmentType.onChange( function () {

		onEnvironmentChanged();
		refreshEnvironmentUI();

	} );

	environmentRow.add( new UIText( strings.getKey( 'sidebar/scene/environment' ) ).setClass( 'Label' ) );
	environmentRow.add( environmentType );

	const environmentEquirectangularTexture = new UITexture( editor ).setMarginLeft( '8px' ).onChange( onEnvironmentChanged );
	environmentEquirectangularTexture.setDisplay( 'none' );
	environmentRow.add( environmentEquirectangularTexture );

	container.add( environmentRow );

	function onEnvironmentChanged() {

		signals.sceneEnvironmentChanged.dispatch(
			environmentType.getValue(),
			environmentEquirectangularTexture.getValue()
		);

	}

	function refreshEnvironmentUI() {

		const type = environmentType.getValue();

		environmentType.setWidth( type !== 'Equirectangular' ? '150px' : '110px' );
		environmentEquirectangularTexture.setDisplay( type === 'Equirectangular' ? '' : 'none' );

	}

	// fog

	function onFogChanged() {

		signals.sceneFogChanged.dispatch(
			fogType.getValue(),
			fogColor.getHexValue(),
			fogNear.getValue(),
			fogFar.getValue(),
			fogDensity.getValue()
		);

	}

	function onFogSettingsChanged() {

		signals.sceneFogSettingsChanged.dispatch(
			fogType.getValue(),
			fogColor.getHexValue(),
			fogNear.getValue(),
			fogFar.getValue(),
			fogDensity.getValue()
		);

	}

	const fogTypeRow = new UIRow();
	const fogType = new UISelect().setOptions( {

		'None': 'None',
		'Fog': 'Linear',
		'FogExp2': 'Exponential'

	} ).setWidth( '150px' );
	fogType.onChange( function () {

		onFogChanged();
		refreshFogUI();

	} );

	fogTypeRow.add( new UIText( strings.getKey( 'sidebar/scene/fog' ) ).setClass( 'Label' ) );
	fogTypeRow.add( fogType );

	container.add( fogTypeRow );

	// fog color

	const fogPropertiesRow = new UIRow();
	fogPropertiesRow.setDisplay( 'none' );
	fogPropertiesRow.setMarginLeft( '120px' );
	container.add( fogPropertiesRow );

	const fogColor = new UIColor().setValue( '#aaaaaa' );
	fogColor.onInput( onFogSettingsChanged );
	fogPropertiesRow.add( fogColor );

	// fog near

	const fogNear = new UINumber( 0.1 ).setWidth( '40px' ).setRange( 0, Infinity ).onChange( onFogSettingsChanged );
	fogPropertiesRow.add( fogNear );

	// fog far

	const fogFar = new UINumber( 50 ).setWidth( '40px' ).setRange( 0, Infinity ).onChange( onFogSettingsChanged );
	fogPropertiesRow.add( fogFar );

	// fog density

	const fogDensity = new UINumber( 0.05 ).setWidth( '40px' ).setRange( 0, 0.1 ).setStep( 0.001 ).setPrecision( 3 ).onChange( onFogSettingsChanged );
	fogPropertiesRow.add( fogDensity );

	//

	function refreshUI() {

		refreshAnimTargetCache();

		const camera = editor.camera;
		const scene = editor.scene;

		const options = [];

		options.push( buildOption( camera, false ) );
		options.push( buildOption( scene, false ) );

		( function addObjects( objects, pad ) {

			for ( let i = 0, l = objects.length; i < l; i ++ ) {

				const object = objects[ i ];

				// Ephemeral UGUI render helpers (Image mesh / Text Effect-stack Troika passes)
				if ( object.name && String( object.name ).indexOf( '__fcc' ) === 0 ) continue;

				if ( nodeStates.has( object ) === false ) {

					nodeStates.set( object, false );

				}

				const option = buildOption( object, true );
				option.style.paddingLeft = ( pad * 18 ) + 'px';
				options.push( option );

				if ( nodeStates.get( object ) === true ) {

					addObjects( object.children, pad + 1 );

				}

			}

		} )( scene.children, 0 );

		outliner.setOptions( options );

		if ( editor.selected !== null ) {

			outliner.setValue( editor.selected.id );

		} else {

			const selection = editor.selector.selection;

			if ( selection.length > 1 ) {

				// restore highlights of a group selection (e.g. after a graph change)

				outliner.setValues( selection.map( ( object ) => object.id ) );

			}

		}

		backgroundType.setValue( editor.backgroundType );

		switch ( editor.backgroundType ) {

			case 'Color':
				if ( scene.background && scene.background.isColor ) {

					backgroundColor.setHexValue( scene.background.getHex() );

				}
				break;

			case 'Texture':
				if ( scene.background && scene.background.isTexture ) {

					backgroundTexture.setValue( scene.background );
					backgroundColorSpace.setValue( scene.background.colorSpace );

				}
				break;

			case 'Equirectangular':
				if ( scene.background && scene.background.isTexture ) {

					backgroundEquirectangularTexture.setValue( scene.background );
					backgroundBlurriness.setValue( scene.backgroundBlurriness );
					backgroundIntensity.setValue( scene.backgroundIntensity );
					backgroundColorSpace.setValue( scene.background.colorSpace );

				}
				break;

			default:
				backgroundTexture.setValue( null );
				backgroundEquirectangularTexture.setValue( null );
				backgroundColorSpace.setValue( THREE.NoColorSpace );

		}

		environmentType.setValue( editor.environmentType );

		if ( editor.environmentType === 'Equirectangular' ) {

			environmentEquirectangularTexture.setValue( scene.environment );

		} else {

			environmentEquirectangularTexture.setValue( null );

		}

		if ( scene.fog ) {

			fogColor.setHexValue( scene.fog.color.getHex() );

			if ( scene.fog.isFog ) {

				fogType.setValue( 'Fog' );
				fogNear.setValue( scene.fog.near );
				fogFar.setValue( scene.fog.far );

			} else if ( scene.fog.isFogExp2 ) {

				fogType.setValue( 'FogExp2' );
				fogDensity.setValue( scene.fog.density );

			}

		} else {

			fogType.setValue( 'None' );

		}

		refreshBackgroundUI();
		refreshEnvironmentUI();
		refreshFogUI();

	}

	function refreshFogUI() {

		const type = fogType.getValue();

		fogPropertiesRow.setDisplay( type === 'None' ? 'none' : '' );
		fogNear.setDisplay( type === 'Fog' ? '' : 'none' );
		fogFar.setDisplay( type === 'Fog' ? '' : 'none' );
		fogDensity.setDisplay( type === 'FogExp2' ? '' : 'none' );

	}

	refreshUI();

	// events

	signals.editorCleared.add( refreshUI );

	signals.sceneGraphChanged.add( refreshUI );

	signals.cameraResetted.add( refreshUI );

	signals.objectChanged.add( function ( object ) {

		const options = outliner.options;

		for ( let i = 0; i < options.length; i ++ ) {

			const option = options[ i ];

			if ( option.value === object.id ) {

				const openerElement = option.querySelector( ':scope > .opener' );

				option.innerHTML = buildHTML( object );

				if ( openerElement !== null ) option.insertBefore( openerElement, option.firstChild );

				const animBtn = option.querySelector( '[data-fcc-anim]' );
				if ( animBtn ) {

					animBtn.addEventListener( 'click', function ( event ) {

						event.preventDefault();
						event.stopPropagation();
						toggleAnimControllerForObject( object );

					} );

				}

				return;

			}

		}

	} );

	signals.scriptAdded.add( function () {

		if ( editor.selected !== null ) signals.objectChanged.dispatch( editor.selected );

	} );

	if ( signals.freecapcutAnimsChanged ) {

		signals.freecapcutAnimsChanged.add( function () {

			refreshUI();

		} );

	}

	signals.scriptRemoved.add( function () {

		if ( editor.selected !== null ) signals.objectChanged.dispatch( editor.selected );

	} );


	function expandAncestors( object ) {

		let needsRefresh = false;
		let parent = object.parent;

		while ( parent !== editor.scene ) {

			if ( nodeStates.get( parent ) !== true ) {

				nodeStates.set( parent, true );
				needsRefresh = true;

			}

			parent = parent.parent;

		}

		return needsRefresh;

	}

	signals.objectSelected.add( function ( object ) {

		if ( ignoreObjectSelectedSignal === true ) return;

		const selection = editor.selector.selection;

		if ( selection.length > 1 ) {

			// highlight all members of a group selection

			let needsRefresh = false;

			const values = [];

			for ( let i = 0; i < selection.length; i ++ ) {

				values.push( selection[ i ].id );
				needsRefresh = expandAncestors( selection[ i ] ) || needsRefresh;

			}

			if ( needsRefresh ) refreshUI();

			outliner.setValues( values );

		} else if ( object !== null && object.parent !== null ) {

			if ( expandAncestors( object ) ) refreshUI();

			outliner.setValue( object.id );

		} else {

			outliner.setValue( null );

		}

	} );

	signals.sceneBackgroundChanged.add( function () {

		if ( environmentType.getValue() === 'Background' ) {

			onEnvironmentChanged();
			refreshEnvironmentUI();

		}

	} );

	return container;

}

export { SidebarScene };
