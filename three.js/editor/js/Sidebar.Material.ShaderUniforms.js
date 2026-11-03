import { UIButton, UICheckbox, UIColor, UINumber, UIPanel, UIRow, UISelect, UIText } from './libs/ui.js';
import { SetMaterialUniformCommand } from './commands/SetMaterialUniformCommand.js';
import {
	looksLikeColorUniformName,
	isBelowInputUniformName,
	BELOW_INPUT_UNIFORM_NAMES,
	applyEditorBelowPreview,
	applyEditorTransitionFromPreview,
	applyEditorTransitionToPreview,
	listPresentBelowInputNames,
	listPresentTransitionFromNames,
	listPresentTransitionToNames,
	isTransitionInputUniformName,
	TRANSITION_FROM_UNIFORM_NAMES,
	TRANSITION_TO_UNIFORM_NAMES,
	EDITOR_PREVIEW_INPUT_KEY,
	EDITOR_PREVIEW_FROM_KEY,
	EDITOR_PREVIEW_TO_KEY,
} from './FreeCapCutShaders.js?v=fcc-ui-198';
import {
	isUniformExposed,
	setUniformExposed,
} from './ExposedParams.js?v=fcc-ui-228';
import { listRenderTextureOptions, textureForRenderTextureUuid } from './media/FccVideo.js?v=fcc-ui-207';
import * as THREE from 'three';

/**
 * FreeFilmCut: show ShaderMaterial custom uniforms in the Material sidebar
 * (color pickers for vec3/Color like color2; numbers; booleans).
 * Skips map / color / opacity when those already have dedicated rows.
 *
 * Below-input samplers (uInput / belowInput / iChannel0) get an Editor-only
 * local image preview picker — NOT exported as the real NLE below source.
 */
function SidebarMaterialShaderUniforms( editor ) {

	const signals = editor.signals;
	const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
	const isZh = lang === 'zh';

	const container = new UIPanel();
	container.setDisplay( 'none' );

	const header = new UIRow();
	header.add( new UIText( 'Shader Uniforms' ).setClass( 'Label' ).setColor( '#aaa' ) );
	container.add( header );

	const belowHint = new UIRow();
	belowHint.setDisplay( 'none' );
	belowHint.add( new UIText(
		isZh
			? '下层输入：声明 uniform sampler2D uInput（别名 belowInput / iChannel0）。OpenCut 在 filter/effect + scope:below 时每帧绑定时间线下层合成。'
			: 'Below input: declare uniform sampler2D uInput (aliases: belowInput, iChannel0). NLE auto-binds the track composite under this pack when type is filter/effect and scope is below.'
	).setFontSize( '10px' ).setColor( '#8af' ).setWidth( '240px' ) );
	container.add( belowHint );

	// --- Editor-only uInput preview ---
	const previewPanel = new UIPanel();
	previewPanel.setDisplay( 'none' );
	previewPanel.setMarginTop( '6px' );
	previewPanel.setPadding( '6px' );
	previewPanel.setBackgroundColor( '#1a2332' );

	const previewTitle = new UIRow();
	previewTitle.add( new UIText(
		isZh ? 'uInput 预览（仅 Editor）' : 'uInput preview (Editor only)'
	).setFontSize( '11px' ).setFontWeight( 'bold' ).setColor( '#9cf' ) );
	previewPanel.add( previewTitle );

	const previewWarn = new UIRow();
	previewWarn.add( new UIText(
		isZh
			? '本地图仅用于调 Bloom/着色器，不写入 .vfxpack 下层源；OpenCut 仍绑定真实 below 合成。'
			: 'Local image is for tuning bloom/shaders only — does NOT export into .vfxpack as the below source. OpenCut still binds the real below composite.'
	).setFontSize( '10px' ).setColor( '#fa8' ).setWidth( '240px' ) );
	previewPanel.add( previewWarn );

	const previewRow = new UIRow().setMarginTop( '4px' );
	const previewCanvas = document.createElement( 'canvas' );
	previewCanvas.width = 48;
	previewCanvas.height = 32;
	previewCanvas.style.border = '1px solid #668';
	previewCanvas.style.marginRight = '6px';
	previewCanvas.style.verticalAlign = 'middle';
	previewCanvas.style.background = '#111';
	previewRow.dom.appendChild( previewCanvas );

	const fileInput = document.createElement( 'input' );
	fileInput.type = 'file';
	fileInput.accept = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
	fileInput.style.display = 'none';
	previewRow.dom.appendChild( fileInput );

	const pickBtn = new UIButton( isZh ? '选择图片…' : 'Pick image…' ).onClick( () => {

		fileInput.value = '';
		fileInput.click();

	} );
	previewRow.add( pickBtn );

	const clearBtn = new UIButton( isZh ? '清除' : 'Clear' ).setMarginLeft( '4px' ).onClick( () => {

		clearPreview();

	} );
	previewRow.add( clearBtn );
	previewPanel.add( previewRow );

	const previewStatus = new UIRow();
	const previewStatusText = new UIText( isZh ? '（空）' : '(empty)' ).setFontSize( '10px' ).setColor( '#888' );
	previewStatus.add( previewStatusText );
	previewPanel.add( previewStatus );

	const aliasRow = new UIRow();
	const aliasText = new UIText( '' ).setFontSize( '10px' ).setColor( '#8af' );
	aliasRow.add( aliasText );
	previewPanel.add( aliasRow );

	container.add( previewPanel );

	function makeSamplerPreview( { title, warn, emptyText, nameList, storeKey, apply } ) {

		const panel = new UIPanel();
		panel.setDisplay( 'none' );
		panel.setMarginTop( '6px' );
		panel.setPadding( '6px' );
		panel.setBackgroundColor( '#1a2332' );

		const titleRow = new UIRow();
		titleRow.add( new UIText( title ).setFontSize( '11px' ).setFontWeight( 'bold' ).setColor( '#9cf' ) );
		panel.add( titleRow );

		const warnRow = new UIRow();
		warnRow.add( new UIText( warn ).setFontSize( '10px' ).setColor( '#fa8' ).setWidth( '240px' ) );
		panel.add( warnRow );

		const row = new UIRow().setMarginTop( '4px' );
		const canvas = document.createElement( 'canvas' );
		canvas.width = 48;
		canvas.height = 32;
		canvas.style.border = '1px solid #668';
		canvas.style.marginRight = '6px';
		canvas.style.verticalAlign = 'middle';
		canvas.style.background = '#111';
		row.dom.appendChild( canvas );

		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = 'image/jpeg,image/png,image/webp,image/gif,.jpg,.jpeg,.png,.webp,.gif';
		input.style.display = 'none';
		row.dom.appendChild( input );

		const statusText = new UIText( emptyText ).setFontSize( '10px' ).setColor( '#888' );
		const aliasLabel = new UIText( '' ).setFontSize( '10px' ).setColor( '#8af' );

		function draw( texture ) {

			const ctx = canvas.getContext( '2d' );
			ctx.fillStyle = '#111';
			ctx.fillRect( 0, 0, canvas.width, canvas.height );
			if ( ! texture || ! texture.image ) return;
			try {

				ctx.drawImage( texture.image, 0, 0, canvas.width, canvas.height );

			} catch ( e ) { /* not ready */ }

		}

		function refresh() {

			if ( ! material ) return;
			const names = nameList.filter( ( n ) => {

				const src = String( material.fragmentShader || '' ) + String( material.vertexShader || '' );
				const hasUniform = material.uniforms && ( n in material.uniforms );
				return hasUniform || new RegExp( '\\buniform\\s+sampler2D\\s+' + n + '\\b' ).test( src );

			} );
			aliasLabel.setValue( names.length ? ( isZh ? '绑定别名: ' : 'Aliases: ' ) + names.join( ', ' ) : '' );
			const meta = material.userData && material.userData.editorPreviewInputs &&
				material.userData.editorPreviewInputs[ storeKey ];
			let tex = null;
			for ( const n of nameList ) {

				const v = material.uniforms && material.uniforms[ n ] && material.uniforms[ n ].value;
				if ( v && v.isTexture ) {

					tex = v;
					break;

				}

			}

			if ( tex ) {

				draw( tex );
				const label = ( meta && meta.fileName ) || tex.sourceFile || ( isZh ? '已设置' : 'set' );
				statusText.setValue( ( isZh ? '预览: ' : 'Preview: ' ) + label );
				statusText.setColor( '#aea' );

			} else {

				draw( null );
				statusText.setValue( emptyText );
				statusText.setColor( '#888' );

			}

		}

		function loadFile( file ) {

			if ( ! file || ! material ) return;
			const ext = ( file.name.split( '.' ).pop() || '' ).toLowerCase();
			if ( ! [ 'jpg', 'jpeg', 'png', 'webp', 'gif' ].includes( ext ) ) return;
			const reader = new FileReader();
			reader.addEventListener( 'load', function () {

				const dataUrl = reader.result;
				new THREE.TextureLoader().load( dataUrl, function ( texture ) {

					texture.colorSpace = THREE.SRGBColorSpace;
					texture.flipY = true;
					texture.needsUpdate = true;
					texture.sourceFile = file.name;
					texture.userData = texture.userData || {};
					texture.userData.editorBelowPreview = true;
					apply( material, texture, { fileName: file.name, dataUrl } );
					editor.signals.materialChanged.dispatch( object, materialSlot );
					if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();
					refresh();

				} );

			} );
			reader.readAsDataURL( file );

		}

		row.add( new UIButton( isZh ? '选择图片…' : 'Pick image…' ).onClick( () => {

			input.value = '';
			input.click();

		} ) );
		row.add( new UIButton( isZh ? '清除' : 'Clear' ).setMarginLeft( '4px' ).onClick( () => {

			if ( ! material ) return;
			const old = [];
			for ( const n of nameList ) {

				const v = material.uniforms && material.uniforms[ n ] && material.uniforms[ n ].value;
				if ( v && v.isTexture ) old.push( v );

			}

			apply( material, null, null );
			for ( const t of old ) {

				if ( t.userData && t.userData.editorBelowPreview ) {

					try { t.dispose(); } catch ( e ) { /* ignore */ }

				}

			}

			editor.signals.materialChanged.dispatch( object, materialSlot );
			if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();
			refresh();

		} ) );
		panel.add( row );
		const statusRow = new UIRow();
		statusRow.add( statusText );
		panel.add( statusRow );
		const aliasRow2 = new UIRow();
		aliasRow2.add( aliasLabel );
		panel.add( aliasRow2 );
		input.addEventListener( 'change', ( event ) => {

			const f = event.target.files && event.target.files[ 0 ];
			if ( f ) loadFile( f );

		} );
		container.add( panel );
		return { panel, refresh };

	}

	const fromPreview = makeSamplerPreview( {
		title: isZh ? '源贴图 uTransitionFrom（仅 Editor）' : 'Source uTransitionFrom (Editor only)',
		warn: isZh
			? '本地图只用于调试转场。剪辑端仍绑定切点左侧画面，不会把这张图打进包。'
			: 'Local image is for tuning only. The NLE still binds the outgoing clip and this image is not packed.',
		emptyText: isZh ? '（空）— 选一张图当作 A' : '(empty) — pick an image for A',
		nameList: TRANSITION_FROM_UNIFORM_NAMES,
		storeKey: EDITOR_PREVIEW_FROM_KEY,
		apply: applyEditorTransitionFromPreview,
	} );

	const toPreview = makeSamplerPreview( {
		title: isZh ? '目标贴图 uTransitionTo（仅 Editor）' : 'Target uTransitionTo (Editor only)',
		warn: isZh
			? '本地图只用于调试转场。剪辑端仍绑定切点右侧画面，不会把这张图打进包。'
			: 'Local image is for tuning only. The NLE still binds the incoming clip and this image is not packed.',
		emptyText: isZh ? '（空）— 选一张图当作 B' : '(empty) — pick an image for B',
		nameList: TRANSITION_TO_UNIFORM_NAMES,
		storeKey: EDITOR_PREVIEW_TO_KEY,
		apply: applyEditorTransitionToPreview,
	} );

	const rowsPanel = new UIPanel();
	container.add( rowsPanel );

	let object = null;
	let materialSlot = 0;
	let material = null;
	let lastSig = '';
	const controls = new Map(); // name -> { kind, widget }

	const SKIP = new Set( [ 'map' ] );

	function classifyUniform( name, value ) {

		if ( SKIP.has( name ) ) return null;
		if ( isBelowInputUniformName( name ) ) return null; // handled by preview panel
		if ( isTransitionInputUniformName( name ) ) return null;
		if ( value && value.isCubeTexture ) return null;
		if ( value && value.isTexture ) return 'texture';

		if ( name === 'color' && material && material.color && material.color.isColor ) return null;
		if ( name === 'opacity' && material && typeof material.opacity === 'number' ) return null;

		if ( value && value.isColor ) return 'color';
		if ( value && value.isVector3 && looksLikeColorUniformName( name ) ) return 'color';
		if ( typeof value === 'number' && Number.isFinite( value ) ) return 'number';
		if ( typeof value === 'boolean' ) return 'boolean';

		return null;

	}

	function readColorHex( value ) {

		if ( value && value.isColor ) return value.getHex();
		if ( value && value.isVector3 ) return new THREE.Color( value.x, value.y, value.z ).getHex();
		return 0xffffff;

	}

	function onColorInput( name ) {

		const ctrl = controls.get( name );
		if ( ! ctrl || ! material ) return;
		const hex = ctrl.widget.getHexValue();
		const current = material.uniforms[ name ] && material.uniforms[ name ].value;
		const curHex = readColorHex( current );
		if ( curHex !== hex ) {

			editor.execute( new SetMaterialUniformCommand( editor, object, name, hex, materialSlot, 'color' ) );

		}

	}

	function onNumberChange( name ) {

		const ctrl = controls.get( name );
		if ( ! ctrl || ! material ) return;
		const next = ctrl.widget.getValue();
		const current = material.uniforms[ name ] && material.uniforms[ name ].value;
		if ( current !== next ) {

			editor.execute( new SetMaterialUniformCommand( editor, object, name, next, materialSlot, 'number' ) );

		}

	}

	function onTextureChange( name ) {

		const ctrl = controls.get( name );
		if ( ! ctrl || ! material || ! material.uniforms || ! material.uniforms[ name ] ) return;
		const uuid = ctrl.widget.getValue();
		const next = uuid ? textureForRenderTextureUuid( editor, uuid ) : null;
		material.uniforms[ name ].value = next;
		material.needsUpdate = true;
		editor.signals.materialChanged.dispatch( object, materialSlot );

	}

	function onBoolChange( name ) {

		const ctrl = controls.get( name );
		if ( ! ctrl || ! material ) return;
		const next = ctrl.widget.getValue();
		const current = material.uniforms[ name ] && material.uniforms[ name ].value;
		if ( current !== next ) {

			editor.execute( new SetMaterialUniformCommand( editor, object, name, next, materialSlot, 'boolean' ) );

		}

	}

	function drawPreviewThumb( texture ) {

		const ctx = previewCanvas.getContext( '2d' );
		ctx.fillStyle = '#111';
		ctx.fillRect( 0, 0, previewCanvas.width, previewCanvas.height );
		if ( ! texture || ! texture.image ) return;
		try {

			const img = texture.image;
			ctx.drawImage( img, 0, 0, previewCanvas.width, previewCanvas.height );

		} catch ( e ) {

			/* cross-origin / not ready */

		}

	}

	function refreshPreviewUI() {

		if ( ! material ) return;
		const names = listPresentBelowInputNames( material );
		aliasText.setValue(
			names.length
				? ( isZh ? '绑定别名: ' : 'Aliases: ' ) + names.join( ', ' )
				: ''
		);

		const meta = material.userData && material.userData.editorPreviewInputs &&
			material.userData.editorPreviewInputs[ EDITOR_PREVIEW_INPUT_KEY ];
		let tex = null;
		for ( const n of BELOW_INPUT_UNIFORM_NAMES ) {

			const v = material.uniforms && material.uniforms[ n ] && material.uniforms[ n ].value;
			if ( v && v.isTexture ) {

				tex = v;
				break;

			}

		}

		if ( tex ) {

			drawPreviewThumb( tex );
			const label = ( meta && meta.fileName ) || tex.sourceFile || ( isZh ? '已设置' : 'set' );
			previewStatusText.setValue( ( isZh ? '预览: ' : 'Preview: ' ) + label );
			previewStatusText.setColor( '#aea' );

		} else {

			drawPreviewThumb( null );
			previewStatusText.setValue( isZh ? '（空）— 选本地图以预览 bloom/着色器' : '(empty) — pick a local image to preview bloom/shaders' );
			previewStatusText.setColor( '#888' );

		}

	}

	function loadPreviewFile( file ) {

		if ( ! file || ! material ) return;
		const ext = ( file.name.split( '.' ).pop() || '' ).toLowerCase();
		if ( ! [ 'jpg', 'jpeg', 'png', 'webp', 'gif' ].includes( ext ) ) {

			console.warn( '[FreeFilmCut] Editor uInput preview: unsupported image type', ext );
			return;

		}

		const reader = new FileReader();
		reader.addEventListener( 'load', function () {

			const dataUrl = reader.result;
			const loader = new THREE.TextureLoader();
			loader.load( dataUrl, function ( texture ) {

				texture.colorSpace = THREE.SRGBColorSpace;
				texture.flipY = true;
				texture.needsUpdate = true;
				texture.sourceFile = file.name;
				texture.userData = texture.userData || {};
				texture.userData.editorBelowPreview = true;

				applyEditorBelowPreview( material, texture, {
					fileName: file.name,
					dataUrl: dataUrl,
				} );

				editor.signals.materialChanged.dispatch( object, materialSlot );
				if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();
				refreshPreviewUI();

			} );

		} );
		reader.readAsDataURL( file );

	}

	function clearPreview() {

		if ( ! material ) return;
		const oldTex = [];
		for ( const n of BELOW_INPUT_UNIFORM_NAMES ) {

			const v = material.uniforms && material.uniforms[ n ] && material.uniforms[ n ].value;
			if ( v && v.isTexture ) oldTex.push( v );

		}

		applyEditorBelowPreview( material, null, null );

		for ( const t of oldTex ) {

			if ( t.userData && t.userData.editorBelowPreview ) {

				try {

					t.dispose();

				} catch ( e ) { /* ignore */ }

			}

		}

		editor.signals.materialChanged.dispatch( object, materialSlot );
		if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();
		refreshPreviewUI();

	}

	fileInput.addEventListener( 'change', function ( event ) {

		const f = event.target.files && event.target.files[ 0 ];
		if ( f ) loadPreviewFile( f );

	} );

	function rebuild( names ) {

		rowsPanel.clear();
		controls.clear();

		if ( names.length === 0 ) {

			const empty = new UIRow();
			empty.add( new UIText( isZh ? '（无可编辑 uniform — 可在 Info 中添加）' : '(no editable uniforms — add in Info)' ).setFontSize( '10px' ).setColor( '#666' ) );
			rowsPanel.add( empty );
			return;

		}

		for ( const name of names ) {

			const value = material.uniforms[ name ].value;
			const kind = classifyUniform( name, value );
			if ( ! kind ) continue;

			const row = new UIRow();
			row.add( new UIText( name ).setClass( 'Label' ) );

			if ( kind === 'color' ) {

				const color = new UIColor().onInput( function () {

					onColorInput( name );

				} );
				color.setHexValue( readColorHex( value ) );
				row.add( color );
				controls.set( name, { kind, widget: color } );

			} else if ( kind === 'number' ) {

				const number = new UINumber( value ).setWidth( '60px' ).setPrecision( 3 ).onChange( function () {

					onNumberChange( name );

				} );
				row.add( number );
				controls.set( name, { kind, widget: number } );

			} else if ( kind === 'boolean' ) {

				const box = new UICheckbox( value ).onChange( function () {

					onBoolChange( name );

				} );
				row.add( box );
				controls.set( name, { kind, widget: box } );

			} else if ( kind === 'texture' ) {

				const select = new UISelect().setWidth( '120px' ).onChange( function () {

					onTextureChange( name );

				} );
				select.setOptions( listRenderTextureOptions( editor.scene ) );
				const uuid = value && value.userData && value.userData.fccRenderTextureUuid;
				select.setValue( uuid || '' );
				row.add( select );
				controls.set( name, { kind, widget: select } );

			}

			const exposeLab = new UIText( isZh ? '剪辑端' : 'NLE' )
				.setFontSize( '10px' )
				.setColor( '#8af' )
				.setMarginLeft( '6px' );
			const exposeCb = new UICheckbox( isUniformExposed( material, name ) ).onChange( function () {

				setUniformExposed( material, name, exposeCb.getValue() );
				editor.signals.materialChanged.dispatch( object, materialSlot );
				if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();

			} );
			row.add( exposeLab );
			row.add( exposeCb );

			rowsPanel.add( row );

		}

	}

	function refreshValues() {

		for ( const [ name, ctrl ] of controls ) {

			const entry = material.uniforms && material.uniforms[ name ];
			if ( ! entry ) continue;
			const value = entry.value;

			if ( ctrl.kind === 'color' ) {

				ctrl.widget.setHexValue( readColorHex( value ) );

			} else if ( ctrl.kind === 'number' ) {

				ctrl.widget.setValue( value );

			} else if ( ctrl.kind === 'boolean' ) {

				ctrl.widget.setValue( value );

			} else if ( ctrl.kind === 'texture' ) {

				ctrl.widget.setOptions( listRenderTextureOptions( editor.scene ) );
				const uuid = value && value.userData && value.userData.fccRenderTextureUuid;
				ctrl.widget.setValue( uuid || '' );

			}

		}

	}

	function listNames() {

		if ( ! material || ! material.uniforms ) return [];
		const names = [];
		for ( const name of Object.keys( material.uniforms ) ) {

			const value = material.uniforms[ name ] && material.uniforms[ name ].value;
			if ( classifyUniform( name, value ) ) names.push( name );

		}

		names.sort();
		return names;

	}

	function update( currentObject, currentMaterialSlot = 0 ) {

		object = currentObject;
		materialSlot = currentMaterialSlot;

		if ( object === null || object.material === undefined ) {

			container.setDisplay( 'none' );
			lastSig = '';
			return;

		}

		material = editor.getObjectMaterial( object, materialSlot );

		const isShader = material && ( material.isShaderMaterial || material.isRawShaderMaterial );
		if ( ! isShader ) {

			container.setDisplay( 'none' );
			lastSig = '';
			return;

		}

		container.setDisplay( '' );

		const belowNames = listPresentBelowInputNames( material );
		const fromNames = listPresentTransitionFromNames( material );
		const toNames = listPresentTransitionToNames( material );
		const showBelow = belowNames.length > 0;
		const showFrom = fromNames.length > 0;
		const showTo = toNames.length > 0;
		belowHint.setDisplay( showBelow ? '' : 'none' );
		previewPanel.setDisplay( showBelow ? '' : 'none' );
		fromPreview.panel.setDisplay( showFrom ? '' : 'none' );
		toPreview.panel.setDisplay( showTo ? '' : 'none' );
		if ( showBelow ) refreshPreviewUI();
		if ( showFrom ) fromPreview.refresh();
		if ( showTo ) toPreview.refresh();

		const names = listNames();
		const sig = names.join( '|' )
			+ ( showBelow ? '|below:' + belowNames.join( ',' ) : '' )
			+ ( showFrom ? '|from:' + fromNames.join( ',' ) : '' )
			+ ( showTo ? '|to:' + toNames.join( ',' ) : '' );
		if ( sig !== lastSig ) {

			lastSig = sig;
			rebuild( names );

		} else {

			refreshValues();

		}

	}

	signals.objectSelected.add( update );
	signals.materialChanged.add( update );

	return container;

}

export { SidebarMaterialShaderUniforms };
