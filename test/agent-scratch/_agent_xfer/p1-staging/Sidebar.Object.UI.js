/**
 * FreeFilmCut UGUI: RectTransform + Canvas render mode + Image/Text helpers.
 */

import { UIPanel, UIRow, UIText, UINumber, UIButton, UIDiv, UISelect, UIInput, UIColor, UICheckbox, UITextArea } from './libs/ui.js';

import { SetValueCommand } from './commands/SetValueCommand.js';
import {
	isFccUI,
	isUICanvas,
	isUIImage,
	isUIText,
	getFccUI,
	stretchFillRectData,
	RENDER_MODE_OVERLAY,
	RENDER_MODE_CAMERA,
	DEFAULT_PLANE_DISTANCE,
	DEFAULT_TEXT_FONT_URL,
} from './ui/UIConstants.js?v=fcc-ui-18';
import { rebindCanvasSubtree } from './ui/UIRectLayout.js?v=fcc-ui-18';
import { syncUITextContent } from './ui/UIText.js?v=fcc-ui-18';
import { isTextParamExposed, setTextParamExposed } from './ExposedParams.js?v=fcc-ui-19';


/** Browser-fetchable font URL only (blob/data/http(s)/relative). Not Windows paths. */
function isUsableFontUrl( url ) {

	if ( ! url || typeof url !== 'string' ) return false;
	const u = url.trim();
	if ( ! u ) return false;
	if ( u.startsWith( 'blob:' ) || u.startsWith( 'data:' ) ) return true;
	if ( u.startsWith( 'http://' ) || u.startsWith( 'https://' ) ) return true;
	// file:// and absolute FS paths cannot be fetched by the page
	if ( u.startsWith( 'file:' ) || /^[a-zA-Z]:[\\/]/.test( u ) || u.startsWith( '\\\\' ) ) return false;
	// relative pack/editor paths e.g. fonts/foo.ttf
	if ( u.includes( '/' ) && ! u.includes( '\\\\' ) ) return true;
	return false;

}

function revokeBlobUrl( url ) {

	if ( url && typeof url === 'string' && url.startsWith( 'blob:' ) ) {

		try { URL.revokeObjectURL( url ); } catch ( e ) { /* ignore */ }

	}

}

function vec2Field( label, onCommit ) {

	const row = new UIRow();
	row.add( new UIText( label ).setClass( 'Label' ).setWidth( '90px' ) );
	const x = new UINumber().setPrecision( 3 ).setWidth( '50px' ).onChange( onCommit );
	const y = new UINumber().setPrecision( 3 ).setWidth( '50px' ).onChange( onCommit );
	row.add( x );
	row.add( y );
	return { row, x, y };

}

function vec3Field( label, onCommit, precision = 3 ) {

	const row = new UIRow();
	row.add( new UIText( label ).setClass( 'Label' ).setWidth( '90px' ) );
	const x = new UINumber().setPrecision( precision ).setWidth( '42px' ).onChange( onCommit );
	const y = new UINumber().setPrecision( precision ).setWidth( '42px' ).onChange( onCommit );
	const z = new UINumber().setPrecision( precision ).setWidth( '42px' ).onChange( onCommit );
	row.add( x );
	row.add( y );
	row.add( z );
	return { row, x, y, z };

}

function SidebarObjectUI( editor ) {

	const strings = editor.strings;
	const signals = editor.signals;

	const container = new UIPanel();
	container.setBorderTop( '1px solid #444' );
	container.setMarginTop( '12px' );
	container.setPaddingTop( '10px' );
	container.setDisplay( 'none' );

	const title = new UIText( 'UI / RectTransform' ).setFontWeight( 'bold' );
	container.add( title );

	const typeRow = new UIRow().setMarginTop( '6px' );
	const typeLabel = new UIText( '' ).setColor( '#aaa' );
	typeRow.add( new UIText( '类型' ).setClass( 'Label' ) );
	typeRow.add( typeLabel );
	container.add( typeRow );

	// ---- Canvas render mode ----
	const modeRow = new UIRow().setMarginTop( '6px' );
	modeRow.add( new UIText( '渲染模式' ).setClass( 'Label' ).setWidth( '90px' ) );
	const modeSelect = new UISelect().setWidth( '150px' ).setOptions( {
		overlay: 'Overlay',
		camera: 'SS-Camera',
	} ).onChange( function () {

		const object = editor.selected;
		if ( ! isUICanvas( object ) ) return;
		const ui = { ...getFccUI( object ) };
		ui.renderMode = modeSelect.getValue() === RENDER_MODE_CAMERA
			? RENDER_MODE_CAMERA
			: RENDER_MODE_OVERLAY;
		if ( ui.planeDistance === undefined || ui.planeDistance === null ) {

			ui.planeDistance = DEFAULT_PLANE_DISTANCE;

		}

		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		rebindCanvasSubtree( object );
		updateModeRows( object );
		signals.sceneGraphChanged.dispatch();

	} );
	modeRow.add( modeSelect );
	container.add( modeRow );

	const camRow = new UIRow();
	camRow.add( new UIText( '目标相机' ).setClass( 'Label' ).setWidth( '90px' ) );
	const camSelect = new UISelect().setWidth( '150px' ).onChange( function () {

		const object = editor.selected;
		if ( ! isUICanvas( object ) ) return;
		const ui = { ...getFccUI( object ) };
		const v = camSelect.getValue();
		ui.cameraUuid = ( ! v || v === '__viewport__' ) ? null : v;
		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		signals.sceneGraphChanged.dispatch();

	} );
	camRow.add( camSelect );
	container.add( camRow );

	const distRow = new UIRow();
	distRow.add( new UIText( '平面距离' ).setClass( 'Label' ).setWidth( '90px' ) );
	const distNum = new UINumber( DEFAULT_PLANE_DISTANCE ).setPrecision( 2 ).setRange( 0.01, 1e6 ).setWidth( '70px' ).onChange( function () {

		const object = editor.selected;
		if ( ! isUICanvas( object ) ) return;
		const ui = { ...getFccUI( object ) };
		ui.planeDistance = distNum.getValue();
		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		signals.sceneGraphChanged.dispatch();

	} );
	distRow.add( distNum );
	container.add( distRow );

	// ---- Text props ----
	const textBlock = new UIDiv();
	textBlock.setDisplay( 'none' );
	container.add( textBlock );

	const exposeBoxes = new Map();

	function addExpose( row, key ) {

		const lab = new UIText( '剪辑端' ).setFontSize( '10px' ).setColor( '#8af' ).setMarginLeft( '6px' );
		const cb = new UICheckbox( false ).onChange( function () {

			const object = editor.selected;
			if ( ! isUIText( object ) ) return;
			const ui = { ...getFccUI( object ) };
			setTextParamExposed( ui, key, cb.getValue() );
			const next = { ...object.userData, fccUI: ui };
			editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
			signals.sceneGraphChanged.dispatch();

		} );
		row.add( lab );
		row.add( cb );
		exposeBoxes.set( key, cb );
		return cb;

	}

	const textRow = new UIRow().setMarginTop( '6px' );
	textRow.add( new UIText( '文本' ).setClass( 'Label' ).setWidth( '90px' ) );
	const textArea = new UITextArea().setWidth( '150px' ).setHeight( '48px' ).setFontSize( '12px' ).onChange( commitText );
	textRow.add( textArea );
	addExpose( textRow, 'text' );
	textBlock.add( textRow );

	const fontRow = new UIRow();
	fontRow.add( new UIText( '字体' ).setClass( 'Label' ).setWidth( '90px' ) );
	const fontInput = new UIInput().setWidth( '110px' ).setFontSize( '11px' );
	fontInput.dom.readOnly = true;
	fontInput.dom.title = '请点右侧「文件」选择本地 TTF/OTF/WOFF（不能粘贴 C:\\ 路径）';
	fontInput.dom.placeholder = '未选择（默认 Noto）';
	fontRow.add( fontInput );
	const fontBtn = new UIButton( '文件' ).setMarginLeft( '4px' ).onClick( function () {

		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = '.ttf,.otf,.woff,font/ttf,font/otf,font/woff';
		input.addEventListener( 'change', async function () {

			const file = input.files && input.files[ 0 ];
			if ( ! file ) return;
			const object = editor.selected;
			if ( ! isUIText( object ) ) return;

			const lower = ( file.name || '' ).toLowerCase();
			if ( lower.endsWith( '.woff2' ) ) {

				window.alert( 'Troika 不支持 WOFF2，请选 TTF / OTF / WOFF。' );
				return;

			}

			let buf;
			try {

				buf = await file.arrayBuffer();

			} catch ( e ) {

				console.warn( '[FreeFilmCut] read font failed', e );
				window.alert( '读取字体失败：' + ( e && e.message ? e.message : e ) );
				return;

			}

			if ( ! buf || buf.byteLength < 100 ) {

				window.alert( '字体文件无效或过小。' );
				return;

			}

			const prevUi = getFccUI( object ) || {};
			revokeBlobUrl( prevUi.font );

			// Blob URL: browser can fetch; absolute C:\\ paths cannot.
			const blob = new Blob( [ buf ], { type: 'font/ttf' } );
			const url = URL.createObjectURL( blob );

			const ui = { ...prevUi };
			ui.font = url;
			ui.fontFileName = file.name;

			if ( ! editor._fccFontBytes ) editor._fccFontBytes = new Map();
			editor._fccFontBytes.set( object.uuid, {
				name: file.name,
				buffer: buf,
				mime: 'font/ttf',
				blobUrl: url,
			} );

			// Optional: copy into bound project assets/fonts for persistence.
			if ( editor.projectFolder && typeof editor.projectFolder.importAssetFile === 'function' ) {

				try {

					const rel = await editor.projectFolder.importAssetFile( file );
					if ( rel ) ui.fontProjectPath = rel;

				} catch ( e ) {

					console.warn( '[FreeFilmCut] import font to project', e );

				}

			}

			fontInput.setValue( file.name );
			// Force Troika resync even if signature cache races with userData replace.
			if ( object.userData ) delete object.userData.__fccTextSig;

			const next = { ...object.userData, fccUI: ui };
			delete next.__fccTextSig;
			editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
			syncSelectedText();
			signals.sceneGraphChanged.dispatch();
			console.info( '[FreeFilmCut] font applied via blob URL:', file.name, url.slice( 0, 48 ) + '…' );

		} );
		input.click();

	} );
	fontRow.add( fontBtn );
	const fontClearBtn = new UIButton( '默认' ).setMarginLeft( '4px' ).onClick( function () {

		const object = editor.selected;
		if ( ! isUIText( object ) ) return;
		const prevUi = getFccUI( object ) || {};
		revokeBlobUrl( prevUi.font );
		if ( editor._fccFontBytes ) editor._fccFontBytes.delete( object.uuid );
		const ui = { ...prevUi };
		ui.font = '';
		ui.fontFileName = '';
		ui.fontProjectPath = '';
		fontInput.setValue( '' );
		if ( object.userData ) delete object.userData.__fccTextSig;
		const next = { ...object.userData, fccUI: ui };
		delete next.__fccTextSig;
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		syncSelectedText();
		signals.sceneGraphChanged.dispatch();

	} );
	fontRow.add( fontClearBtn );
	textBlock.add( fontRow );

	const fontSizeRow = new UIRow();
	fontSizeRow.add( new UIText( '字号' ).setClass( 'Label' ).setWidth( '90px' ) );
	const fontSizeNum = new UINumber( 48 ).setRange( 1, 1024 ).setWidth( '70px' ).onChange( commitText );
	fontSizeRow.add( fontSizeNum );
	addExpose( fontSizeRow, 'fontSize' );
	textBlock.add( fontSizeRow );

	const boldRow = new UIRow();
	boldRow.add( new UIText( '加粗' ).setClass( 'Label' ).setWidth( '90px' ) );
	const boldCheck = new UICheckbox( false ).onChange( commitText );
	boldRow.add( boldCheck );
	addExpose( boldRow, 'bold' );
	textBlock.add( boldRow );

	const colorRow = new UIRow();
	colorRow.add( new UIText( '颜色' ).setClass( 'Label' ).setWidth( '90px' ) );
	const colorInput = new UIColor().onInput( commitText );
	colorRow.add( colorInput );
	addExpose( colorRow, 'color' );
	textBlock.add( colorRow );

	const spacingRow = new UIRow();
	spacingRow.add( new UIText( '字间距' ).setClass( 'Label' ).setWidth( '90px' ) );
	const letterNum = new UINumber( 0 ).setPrecision( 3 ).setWidth( '50px' ).onChange( commitText );
	spacingRow.add( letterNum );
	addExpose( spacingRow, 'letterSpacing' );
	spacingRow.add( new UIText( '行距' ).setWidth( '36px' ).setMarginLeft( '6px' ) );
	const lineNum = new UINumber( 1.2 ).setPrecision( 3 ).setWidth( '50px' ).onChange( commitText );
	spacingRow.add( lineNum );
	addExpose( spacingRow, 'lineHeight' );
	textBlock.add( spacingRow );

	const alignRow = new UIRow();
	alignRow.add( new UIText( '对齐' ).setClass( 'Label' ).setWidth( '90px' ) );
	const alignSelect = new UISelect().setWidth( '70px' ).setOptions( {
		left: '左',
		center: '中',
		right: '右',
	} ).onChange( commitText );
	alignRow.add( alignSelect );
	const vAlignSelect = new UISelect().setWidth( '70px' ).setMarginLeft( '4px' ).setOptions( {
		top: '上',
		middle: '中',
		bottom: '下',
	} ).onChange( commitText );
	alignRow.add( vAlignSelect );
	textBlock.add( alignRow );

	const outlineEnRow = new UIRow().setMarginTop( '4px' );
	outlineEnRow.add( new UIText( '描边' ).setClass( 'Label' ).setWidth( '90px' ) );
	const outlineEn = new UICheckbox( false ).onChange( commitText );
	outlineEnRow.add( outlineEn );
	addExpose( outlineEnRow, 'outline.enabled' );
	textBlock.add( outlineEnRow );

	const outlineRow = new UIRow();
	outlineRow.add( new UIText( '描边宽' ).setClass( 'Label' ).setWidth( '90px' ) );
	const outlineWidth = new UINumber( 2 ).setRange( 0, 512 ).setWidth( '50px' ).onChange( commitText );
	outlineRow.add( outlineWidth );
	addExpose( outlineRow, 'outline.width' );
	const outlineColor = new UIColor().onInput( commitText );
	outlineRow.add( outlineColor );
	addExpose( outlineRow, 'outline.color' );
	const outlineOpacity = new UINumber( 1 ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '45px' ).onChange( commitText );
	outlineRow.add( outlineOpacity );
	addExpose( outlineRow, 'outline.opacity' );
	textBlock.add( outlineRow );

	const shadowEnRow = new UIRow().setMarginTop( '4px' );
	shadowEnRow.add( new UIText( '阴影' ).setClass( 'Label' ).setWidth( '90px' ) );
	const shadowEn = new UICheckbox( false ).onChange( commitText );
	shadowEnRow.add( shadowEn );
	addExpose( shadowEnRow, 'shadow.enabled' );
	textBlock.add( shadowEnRow );

	const shadowOffRow = new UIRow();
	shadowOffRow.add( new UIText( '阴影偏移' ).setClass( 'Label' ).setWidth( '90px' ) );
	const shadowOX = new UINumber( 2 ).setWidth( '45px' ).onChange( commitText );
	const shadowOY = new UINumber( - 2 ).setWidth( '45px' ).onChange( commitText );
	shadowOffRow.add( shadowOX );
	addExpose( shadowOffRow, 'shadow.offsetX' );
	shadowOffRow.add( shadowOY );
	addExpose( shadowOffRow, 'shadow.offsetY' );
	textBlock.add( shadowOffRow );

	const shadowBlurRow = new UIRow();
	shadowBlurRow.add( new UIText( '阴影模糊' ).setClass( 'Label' ).setWidth( '90px' ) );
	const shadowBlur = new UINumber( 4 ).setRange( 0, 64 ).setWidth( '50px' ).onChange( commitText );
	shadowBlurRow.add( shadowBlur );
	addExpose( shadowBlurRow, 'shadow.blur' );
	const shadowColor = new UIColor().onInput( commitText );
	shadowBlurRow.add( shadowColor );
	addExpose( shadowBlurRow, 'shadow.color' );
	textBlock.add( shadowBlurRow );

	function commitText() {

		const object = editor.selected;
		if ( ! isUIText( object ) ) return;
		const ui = { ...getFccUI( object ) };
		ui.text = textArea.getValue();
		// Font URL only from「文件」picker (blob:) / http(s) / data:.
		// Never clear fontFileName / fontProjectPath — reopen needs them.
		const prevFont = ui.font || '';
		const cached = editor._fccFontBytes && editor._fccFontBytes.get( object.uuid );
		if ( isUsableFontUrl( prevFont ) ) {

			ui.font = prevFont;
			if ( fontInput.getValue().trim() ) ui.fontFileName = fontInput.getValue().trim();

		} else if ( cached && cached.blobUrl && isUsableFontUrl( cached.blobUrl ) ) {

			ui.font = cached.blobUrl;
			if ( ! ui.fontFileName && cached.name ) ui.fontFileName = cached.name;
			if ( fontInput.getValue().trim() ) ui.fontFileName = fontInput.getValue().trim();

		} else {

			// Keep metadata; leave font empty so Troika uses CDN until user re-picks / restore runs.
			ui.font = '';
			if ( fontInput.getValue().trim() && ! String( fontInput.getValue() ).startsWith( 'blob:' ) ) {

				ui.fontFileName = fontInput.getValue().trim();

			}

		}

		ui.fontSize = fontSizeNum.getValue();
		ui.bold = !! boldCheck.getValue();
		ui.color = colorInput.getValue();
		ui.letterSpacing = letterNum.getValue();
		ui.lineHeight = lineNum.getValue();
		ui.align = alignSelect.getValue();
		ui.verticalAlign = vAlignSelect.getValue();
		ui.outline = {
			enabled: !! outlineEn.getValue(),
			width: outlineWidth.getValue(),
			color: outlineColor.getValue(),
			opacity: outlineOpacity.getValue(),
		};
		ui.shadow = {
			enabled: !! shadowEn.getValue(),
			offsetX: shadowOX.getValue(),
			offsetY: shadowOY.getValue(),
			blur: shadowBlur.getValue(),
			color: shadowColor.getValue(),
			opacity: 0.75,
		};
		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		syncSelectedText();
		signals.sceneGraphChanged.dispatch();

	}

	function syncSelectedText() {

		const object = editor.selected;
		if ( ! isUIText( object ) ) return;
		const ui = getFccUI( object );
		const w = ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
		const h = ( ui.sizeDelta && ui.sizeDelta[ 1 ] ) || 100;
		try {

			syncUITextContent( object, { x: 0, y: 0, w, h } );

		} catch ( e ) {

			console.warn( '[FreeFilmCut] text sync', e );

		}

	}

	function rebuildCameraOptions() {

		const opts = { __viewport__: '当前视口相机' };
		editor.scene.traverse( function ( o ) {

			if ( o.isPerspectiveCamera || o.isOrthographicCamera ) {

				opts[ o.uuid ] = ( o.name || o.type ) + ' (' + o.uuid.slice( 0, 6 ) + ')';

			}

		} );
		camSelect.setOptions( opts );

	}

	function updateModeRows( object ) {

		const isCanvas = isUICanvas( object );
		modeRow.setDisplay( isCanvas ? '' : 'none' );
		if ( ! isCanvas ) {

			camRow.setDisplay( 'none' );
			distRow.setDisplay( 'none' );
			return;

		}

		const ui = getFccUI( object );
		const isCam = ui && ui.renderMode === RENDER_MODE_CAMERA;
		camRow.setDisplay( isCam ? '' : 'none' );
		distRow.setDisplay( isCam ? '' : 'none' );

	}

	function commitRect() {

		const object = editor.selected;
		if ( ! isFccUI( object ) ) return;
		const ui = { ...getFccUI( object ) };
		ui.anchorMin = [ anchorMin.x.getValue(), anchorMin.y.getValue() ];
		ui.anchorMax = [ anchorMax.x.getValue(), anchorMax.y.getValue() ];
		ui.pivot = [ pivot.x.getValue(), pivot.y.getValue() ];
		ui.anchoredPosition = [ anchoredPos.x.getValue(), anchoredPos.y.getValue() ];
		ui.sizeDelta = [ sizeDelta.x.getValue(), sizeDelta.y.getValue() ];
		ui.localEulerAngles = [
			localRot.x.getValue(),
			localRot.y.getValue(),
			localRot.z.getValue(),
		];
		ui.localScale = [
			localScale.x.getValue(),
			localScale.y.getValue(),
			localScale.z.getValue(),
		];
		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		if ( isUIText( object ) ) syncSelectedText();
		signals.sceneGraphChanged.dispatch();

	}

	const anchorMin = vec2Field( '锚点 Min', commitRect );
	const anchorMax = vec2Field( '锚点 Max', commitRect );
	const pivot = vec2Field( '轴心 Pivot', commitRect );
	const anchoredPos = vec2Field( '锚点位置', commitRect );
	const sizeDelta = vec2Field( '尺寸 Size', commitRect );
	const localRot = vec3Field( '旋转 °', commitRect, 2 );
	const localScale = vec3Field( '缩放', commitRect, 3 );

	container.add( anchorMin.row );
	container.add( anchorMax.row );
	container.add( pivot.row );
	container.add( anchoredPos.row );
	container.add( sizeDelta.row );
	container.add( localRot.row );
	container.add( localScale.row );

	const presetRow = new UIRow().setMarginTop( '8px' );
	const stretchBtn = new UIButton( '铺满屏幕' ).onClick( function () {

		const object = editor.selected;
		if ( ! isFccUI( object ) ) return;
		const ui = { ...getFccUI( object ), ...stretchFillRectData() };
		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		refresh( object );
		signals.sceneGraphChanged.dispatch();

	} );
	presetRow.add( stretchBtn );

	const centerBtn = new UIButton( '居中 200×200' ).onClick( function () {

		const object = editor.selected;
		if ( ! isFccUI( object ) ) return;
		const ui = {
			...getFccUI( object ),
			anchorMin: [ 0.5, 0.5 ],
			anchorMax: [ 0.5, 0.5 ],
			pivot: [ 0.5, 0.5 ],
			anchoredPosition: [ 0, 0 ],
			sizeDelta: [ 200, 200 ],
		};
		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		refresh( object );
		signals.sceneGraphChanged.dispatch();

	} );
	presetRow.add( centerBtn );
	container.add( presetRow );

	const hint = new UIDiv().setMarginTop( '6px' );
	hint.setTextContent(
		'位移用「锚点位置」。宽高只改网格尺寸，勿写进 Scale。旋转/缩放为 localEulerAngles / localScale。字体用「文件」选 TTF。'
	);
	hint.setFontSize( '11px' );
	hint.setColor( '#aaa' );
	container.add( hint );

	function setVec( field, arr ) {

		field.x.setValue( arr[ 0 ] );
		field.y.setValue( arr[ 1 ] );

	}

	function setVec3( field, arr, fallback ) {

		const a = Array.isArray( arr ) && arr.length >= 3 ? arr : fallback;
		field.x.setValue( a[ 0 ] );
		field.y.setValue( a[ 1 ] );
		field.z.setValue( a[ 2 ] );

	}

	function refresh( object ) {

		if ( ! isFccUI( object ) ) {

			container.setDisplay( 'none' );
			return;

		}

		container.setDisplay( '' );
		const ui = getFccUI( object );
		textBlock.setDisplay( isUIText( object ) ? '' : 'none' );

		if ( isUICanvas( object ) ) {

			typeLabel.setValue( 'Canvas' );
			modeSelect.setValue( ui.renderMode === RENDER_MODE_CAMERA ? RENDER_MODE_CAMERA : RENDER_MODE_OVERLAY );
			rebuildCameraOptions();
			const camVal = ui.cameraUuid || '__viewport__';
			camSelect.setValue( camVal );
			distNum.setValue( ui.planeDistance != null ? ui.planeDistance : DEFAULT_PLANE_DISTANCE );

		} else if ( isUIImage( object ) ) {

			typeLabel.setValue( 'Image' );

		} else if ( isUIText( object ) ) {

			typeLabel.setValue( 'Text' );
			textArea.setValue( ui.text != null ? String( ui.text ) : '' );
			fontInput.setValue( ui.fontFileName || ui.font || '' );
			fontSizeNum.setValue( ui.fontSize != null ? ui.fontSize : 48 );
			boldCheck.setValue( !! ui.bold );
			colorInput.setValue( ui.color || '#ffffff' );
			letterNum.setValue( ui.letterSpacing != null ? ui.letterSpacing : 0 );
			lineNum.setValue( ui.lineHeight != null ? ui.lineHeight : 1.2 );
			alignSelect.setValue( ui.align || 'center' );
			vAlignSelect.setValue( ui.verticalAlign || 'middle' );
			const ol = ui.outline || {};
			outlineEn.setValue( !! ol.enabled );
			outlineWidth.setValue( ol.width != null ? ol.width : 2 );
			outlineColor.setValue( ol.color || '#000000' );
			outlineOpacity.setValue( ol.opacity != null ? ol.opacity : 1 );
			const sh = ui.shadow || {};
			shadowEn.setValue( !! sh.enabled );
			shadowOX.setValue( sh.offsetX != null ? sh.offsetX : 2 );
			shadowOY.setValue( sh.offsetY != null ? sh.offsetY : - 2 );
			shadowBlur.setValue( sh.blur != null ? sh.blur : 4 );
			shadowColor.setValue( sh.color || '#000000' );
			for ( const [ key, cb ] of exposeBoxes ) {

				cb.setValue( isTextParamExposed( ui, key ) );

			}

		} else {

			typeLabel.setValue( ui.type || 'UI' );

		}

		updateModeRows( object );

		setVec( anchorMin, ui.anchorMin || [ 0.5, 0.5 ] );
		setVec( anchorMax, ui.anchorMax || [ 0.5, 0.5 ] );
		setVec( pivot, ui.pivot || [ 0.5, 0.5 ] );
		setVec( anchoredPos, ui.anchoredPosition || [ 0, 0 ] );
		setVec( sizeDelta, ui.sizeDelta || [ 200, 200 ] );
		setVec3( localRot, ui.localEulerAngles, [ 0, 0, 0 ] );
		setVec3( localScale, ui.localScale, [ 1, 1, 1 ] );

	}

	signals.objectSelected.add( function ( object ) {

		refresh( object );

	} );

	signals.objectChanged.add( function ( object ) {

		if ( object !== editor.selected ) return;
		refresh( object );

	} );

	signals.refreshSidebarObject3D.add( function ( object ) {

		if ( object !== editor.selected ) return;
		refresh( object );

	} );

	signals.sceneGraphChanged.add( function () {

		if ( isUICanvas( editor.selected ) ) rebuildCameraOptions();

	} );

	refresh( editor.selected );

	return container;

}

export { SidebarObjectUI };
