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
} from './ui/UIConstants.js?v=fcc-ui-108';
import { rebindCanvasSubtree } from './ui/UIRectLayout.js?v=fcc-ui-150';
import { syncUITextContent } from './ui/UIText.js?v=fcc-ui-234';
import {
	createDefaultFlowerStyle,
	createStrokeStackEntry,
	createStrokeLayer,
	createInnerStrokeStackEntry,
	createShadowStackEntry,
	createInnerShadowStackEntry,
	createSolidContent,
	createGradientContent,
	createTextureContent,
	cloneFlowerStyle,
	normalizeFlowerStyle,
	flowerStyleFromLegacy,
	normalizeFillContent,
	normalizeUvMode,
	moveFlowerStackEntry,
	createJianying7645FlowerStyle,
	collectFlowerTexturePaths,
	JIANYING_7645_ASSET_DIR,
	rescaleFlowerStyleForFontSize,
} from './ui/FlowerStyle.js?v=fcc-ui-208';

import { isTextParamExposed, setTextParamExposed } from './ExposedParams.js?v=fcc-ui-108';
import { SidebarObjectTextFx } from './Sidebar.Object.TextFx.js?v=fcc-ui-109';
import { SidebarObjectTextAnim } from './Sidebar.Object.TextAnim.js?v=fcc-ui-144';
import { SidebarObjectTextStickers } from './Sidebar.Object.TextStickers.js?v=fcc-ui-211';
import { listRenderTextureOptions } from './media/FccVideo.js?v=fcc-ui-207';


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

	const basicHeader = new UIRow().setMarginTop( '6px' );
	basicHeader.add( new UIText( '基础 · 排版' ).setFontWeight( 'bold' ) );
	textBlock.add( basicHeader );

	const textRow = new UIRow();
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
		if ( object.userData ) {

			delete object.userData.__fccTextSig;
			// Never clone Face-mask RT onto userData (fcc-ui-108); RT lives in WeakMap.
			delete object.userData.__fccFaceMaskRT;
			delete object.userData.__fccFaceMaskFrameId;

		}
		const next = { ...object.userData, fccUI: ui };
		delete next.__fccTextSig;
		delete next.__fccFaceMaskRT;
		delete next.__fccFaceMaskFrameId;
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

	const italicRow = new UIRow();
	italicRow.add( new UIText( '斜体' ).setClass( 'Label' ).setWidth( '90px' ) );
	const italicCheck = new UICheckbox( false ).onChange( commitText );
	italicRow.add( italicCheck );
	addExpose( italicRow, 'italic' );
	textBlock.add( italicRow );

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
	outlineEnRow.add( new UIText( '描边宽' ).setClass( 'Label' ).setWidth( '90px' ) );
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


	// ---- 花字 = Text 上的多层 Effect 栈（非独立组件 / 非独立 fccUI.type）----
	const flowerBlock = new UIDiv();
	flowerBlock.setMarginTop( '8px' );
	flowerBlock.setPaddingTop( '6px' );
	flowerBlock.dom.style.borderTop = '1px solid #444';
	textBlock.add( flowerBlock );

	// 文字后处理 Fx：挂在花字面板下方，选中 Text 即可看到（共用相机 PP Registry）
	const textFxPanel = new SidebarObjectTextFx( editor );
	textBlock.add( textFxPanel );

	const textAnimPanel = new SidebarObjectTextAnim( editor );
	textBlock.add( textAnimPanel );

	const textStickersPanel = new SidebarObjectTextStickers( editor );
	textBlock.add( textStickersPanel );

	// When true, refresh() skips rebuildFlowerPanel so native <input type=color>
	// stays open while dragging/picking (SetValueCommand -> objectChanged -> refresh).
	let skipFlowerRebuild = false;

	function ensureFlowerStyle( ui ) {

		if ( ui.flowerStyle && typeof ui.flowerStyle === 'object' ) {

			return cloneFlowerStyle( ui.flowerStyle );

		}

		return flowerStyleFromLegacy( ui );

	}

	function stripEphemeralUserDataKeys( ud ) {

		// Face-mask WebGLRenderTarget must never ride SetValueCommand clones (fcc-ui-108).
		if ( ! ud ) return;
		delete ud.__fccTextSig;
		delete ud.__fccFaceMaskRT;
		delete ud.__fccFaceMaskFrameId;

	}

	
	async function prefetchFlowerTextures( style ) {

		const paths = collectFlowerTexturePaths( style );
		if ( ! paths.length ) return;
		if ( ! editor._fccFlowerTexBytes ) editor._fccFlowerTexBytes = new Map();
		for ( let i = 0; i < paths.length; i ++ ) {

			const path = paths[ i ];
			if ( editor._fccFlowerTexBytes.has( path ) ) continue;
			if ( path.startsWith( 'blob:' ) || path.startsWith( 'data:' ) ) continue;
			try {

				const res = await fetch( path );
				if ( ! res.ok ) throw new Error( 'HTTP ' + res.status );
				const buf = await res.arrayBuffer();
				const name = path.split( '/' ).pop() || ( 'flower_' + i + '.png' );
				editor._fccFlowerTexBytes.set( path, { name: name, buffer: buf, type: 'image/png' } );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] prefetch flower texture failed', path, e );

			}

		}

	}

	function writeFlowerStyle( style, opts ) {

		const object = editor.selected;
		if ( ! isUIText( object ) ) return;
		const rebuild = !!( opts && opts.rebuild );
		const ui = { ...getFccUI( object ) };
		ui.flowerStyle = cloneFlowerStyle( style );
		// Linear measures are px for the current fontSize; remember base for later rescale.
		ui.flowerBaseFontSize = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
		// Keep basic color in sync with fill solid/gradient primary
		const fillC = normalizeFillContent( ui.flowerStyle.fill && ui.flowerStyle.fill.content );
		if ( fillC.renderType === 'gradient' ) ui.color = fillC.gradient.colors[ 0 ];
		else ui.color = fillC.solid.color;
		if ( object.userData ) stripEphemeralUserDataKeys( object.userData );
		const next = { ...object.userData, fccUI: ui };
		stripEphemeralUserDataKeys( next );
		// Skip panel rebuild during objectChanged from this command so color pickers stay open.
		skipFlowerRebuild = true;
		try {

			editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
			syncSelectedText();
			signals.sceneGraphChanged.dispatch();

		} finally {

			skipFlowerRebuild = false;

		}
		// Only rebuild DOM for structural edits (add/remove layer, fill mode switch).
		if ( rebuild ) rebuildFlowerPanel();

	}

	function contentTypeSelect( content, onType ) {

		const row = new UIRow();
		row.add( new UIText( '填充' ).setClass( 'Label' ).setWidth( '90px' ) );
		const sel = new UISelect().setWidth( '100px' ).setOptions( {
			solid: '纯色',
			gradient: '渐变',
			texture: '贴图',
		} );
		const rt = ( content && content.renderType ) || 'solid';
		sel.setValue( rt === 'gradient' ? 'gradient' : ( rt === 'texture' ? 'texture' : 'solid' ) );
		sel.onChange( function () {

			onType( sel.getValue() );

		} );
		row.add( sel );
		return row;

	}

	function solidControls( content, onChange ) {

		const c = normalizeFillContent( content );
		const row = new UIRow();
		row.add( new UIText( '颜色' ).setClass( 'Label' ).setWidth( '90px' ) );
		const col = new UIColor().setValue( c.solid.color );
		col.onInput( function () {

			onChange( createSolidContent( col.getValue(), c.solid.alpha ) );

		} );
		row.add( col );
		return row;

	}

	function gradientControls( content, onChange ) {

		const c = normalizeFillContent( content );
		const g = c.gradient;
		const wrap = new UIDiv();

		const row1 = new UIRow();
		row1.add( new UIText( '渐变色' ).setClass( 'Label' ).setWidth( '90px' ) );
		const c0 = new UIColor().setValue( g.colors[ 0 ] );
		const c1 = new UIColor().setValue( g.colors[ 1 ] );
		function emit() {

			onChange( createGradientContent( {
				colors: [ c0.getValue(), c1.getValue() ],
				alphas: g.alphas,
				stops: [ s0.getValue(), s1.getValue() ],
				angle: ang.getValue(),
				uvMode: c.uvMode,
			} ) );

		}
		c0.onInput( emit );
		c1.onInput( emit );
		row1.add( c0 );
		row1.add( c1 );
		wrap.add( row1 );

		const row2 = new UIRow();
		row2.add( new UIText( '角度' ).setClass( 'Label' ).setWidth( '90px' ) );
		const ang = new UINumber( g.angle ).setRange( - 360, 360 ).setWidth( '50px' ).onChange( emit );
		row2.add( ang );
		row2.add( new UIText( '停点' ).setWidth( '36px' ).setMarginLeft( '6px' ) );
		const s0 = new UINumber( g.stops[ 0 ] ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '42px' ).onChange( emit );
		const s1 = new UINumber( g.stops[ 1 ] ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '42px' ).onChange( emit );
		row2.add( s0 );
		row2.add( s1 );
		wrap.add( row2 );
		return wrap;

	}


	function uvModeControls( content, onChange ) {

		const c = normalizeFillContent( content );
		const row = new UIRow();
		row.add( new UIText( 'UV mode' ).setClass( 'Label' ).setWidth( '90px' ) );
		const sel = new UISelect().setWidth( '120px' ).setOptions( {
			'per-char': 'Per character',
			'whole-text': 'Whole text',
		} );
		sel.setValue( c.uvMode === 'whole-text' ? 'whole-text' : 'per-char' );
		sel.onChange( function () {

			const next = normalizeFillContent( content );
			next.uvMode = normalizeUvMode( sel.getValue() );
			if ( next.gradient ) next.gradient.mode = next.uvMode === 'whole-text' ? 'text' : 'character';
			onChange( next );

		} );
		row.add( sel );
		return row;

	}

	function fillEditor( label, fillObj, onFill, editorOpts ) {

		const wrap = new UIDiv();
		const showVisible = !!( editorOpts && editorOpts.showVisible );
		let fillVisible = ! ( fillObj && fillObj.visible === false );
		const titleRow = new UIRow();
		titleRow.setMarginTop( '4px' );
		if ( label ) titleRow.add( new UIText( label ).setFontWeight( 'bold' ).setWidth( '90px' ) );
		if ( showVisible ) {

			titleRow.add( new UIText( '显示' ).setClass( 'Label' ).setWidth( '36px' ) );
			const visCb = new UICheckbox( fillVisible ).onChange( function () {

				fillVisible = visCb.getValue();
				onFill( {
					alpha: alphaNum.getValue(),
					content: normalizeFillContent( content ),
					visible: fillVisible,
				} );

			} );
			titleRow.add( visCb );
			titleRow.add( new UIText( '（关=只看描边/投影）' ).setColor( '#888' ).setMarginLeft( '4px' ) );

		}
		wrap.add( titleRow );
		const content = ( fillObj && fillObj.content ) || createSolidContent( '#ffffff', 1 );
		const alphaRow = new UIRow();
		alphaRow.add( new UIText( '不透明度' ).setClass( 'Label' ).setWidth( '90px' ) );
		const alphaNum = new UINumber( fillObj && fillObj.alpha != null ? fillObj.alpha : 1 )
			.setRange( 0, 1 ).setPrecision( 2 ).setWidth( '50px' );
		alphaNum.onChange( function () {

			onFill( {
				alpha: alphaNum.getValue(),
				content: normalizeFillContent( content ),
				visible: fillVisible,
			} );

		} );
		alphaRow.add( alphaNum );
		wrap.add( alphaRow );

		function setContent( nextContent, opts ) {

			onFill( {
				alpha: alphaNum.getValue(),
				content: nextContent,
				visible: fillVisible,
			}, opts );

		}

		wrap.add( contentTypeSelect( content, function ( type ) {

			const cur = normalizeFillContent( content );
			const keepColor = contentPrimaryOrSolid( cur ) || '#ffffff';
			const structureOpts = { rebuild: true };
			if ( type === 'gradient' ) {

				const gColors = ( cur.gradient && cur.gradient.colors && cur.gradient.colors.length >= 2 )
					? [ cur.gradient.colors[ 0 ], cur.gradient.colors[ 1 ] ]
					: [ keepColor, '#afafaf' ];
				// Seed from solid when switching solid->gradient so face never goes empty
				if ( cur.renderType === 'solid' ) {

					gColors[ 0 ] = keepColor;

				}
				setContent( createGradientContent( {
					colors: gColors,
					alphas: [ 1, 1 ],
					stops: [ 0, 1 ],
					angle: ( cur.gradient && cur.gradient.angle != null ) ? cur.gradient.angle : 90,
					uvMode: cur.uvMode,
				} ), structureOpts );

			} else if ( type === 'texture' ) {

				const prev = normalizeFillContent( content );
				setContent( createTextureContent( {
					fallbackColor: keepColor,
					path: ( prev.texture && prev.texture.path ) || '',
					fileName: ( prev.texture && prev.texture.fileName ) || '',
					alpha: ( prev.texture && prev.texture.alpha != null ) ? prev.texture.alpha : 1,
					angle: ( prev.texture && prev.texture.angle != null ) ? prev.texture.angle : 0,
					scale: ( prev.texture && prev.texture.scale != null ) ? prev.texture.scale : 1,
					range: ( prev.texture && prev.texture.range != null ) ? prev.texture.range : 1,
					uvMode: prev.uvMode,
				} ), structureOpts );

			} else {

				setContent( createSolidContent( keepColor, 1 ), structureOpts );

			}

		} ) );

		const rt = normalizeFillContent( content ).renderType;
		if ( rt === 'gradient' ) {

			wrap.add( gradientControls( content, setContent ) );
			wrap.add( uvModeControls( content, setContent ) );

		} else if ( rt === 'texture' ) {

			wrap.add( textureControls( content, setContent ) );
			wrap.add( uvModeControls( content, setContent ) );

		} else {

			wrap.add( solidControls( content, setContent ) );

		}

		return wrap;

	}

	function textureControls( content, onChange ) {

		const c = normalizeFillContent( content );
		const tex = c.texture || {};
		let curPath = tex.path || '';
		let curName = tex.fileName || '';
		const wrap = new UIDiv();

		function pathLabel() {

			if ( curPath && String( curPath ).startsWith( 'rt:' ) ) {

				return ( curName || 'RT' ) + ' (RT)';

			}

			return curName || ( curPath ? '已选' : '未选' );

		}

		const row = new UIRow();
		row.add( new UIText( '贴图' ).setClass( 'Label' ).setWidth( '90px' ) );
		const nameLbl = new UIText( pathLabel() ).setWidth( '90px' );
		row.add( nameLbl );
		const fileBtn = new UIButton( '文件' ).setMarginLeft( '4px' );
		fileBtn.onClick( function () {

			const input = document.createElement( 'input' );
			input.type = 'file';
			input.accept = 'image/png,image/jpeg,image/webp,image/gif,.png,.jpg,.jpeg,.webp';
			input.addEventListener( 'change', async function () {

				const file = input.files && input.files[ 0 ];
				if ( ! file ) return;
				try {

					const buf = await file.arrayBuffer();
					const blob = new Blob( [ buf ], { type: file.type || 'image/png' } );
					const url = URL.createObjectURL( blob );
					if ( ! editor._fccFlowerTexBytes ) editor._fccFlowerTexBytes = new Map();
					editor._fccFlowerTexBytes.set( url, { name: file.name, buffer: buf, type: file.type || 'image/png' } );
					curPath = url;
					curName = file.name;
					nameLbl.setTextContent( file.name );
					rtSelect.setValue( '' );
					onChange( createTextureContent( {
						fallbackColor: c.solid.color,
						path: curPath,
						fileName: curName,
						alpha: alphaTex.getValue(),
						angle: angTex.getValue(),
						scale: scaleTex.getValue(),
						range: rangeTex.getValue(),
						uvMode: c.uvMode,
					} ) );

				} catch ( e ) {

					window.alert( '读取贴图失败：' + ( e && e.message ? e.message : e ) );

				}

			} );
			input.click();

		} );
		row.add( fileBtn );

		const rtSelect = new UISelect().setWidth( '110px' ).setMarginLeft( '4px' );
		function refreshRtOptions() {

			rtSelect.setOptions( listRenderTextureOptions( editor.scene ) );
			if ( curPath && String( curPath ).startsWith( 'rt:' ) ) {

				rtSelect.setValue( String( curPath ).slice( 3 ) );

			} else {

				rtSelect.setValue( '' );

			}

		}
		refreshRtOptions();
		rtSelect.onChange( function () {

			const uuid = rtSelect.getValue();
			if ( ! uuid ) return;
			const opts = listRenderTextureOptions( editor.scene );
			curPath = 'rt:' + uuid;
			curName = opts[ uuid ] || 'RenderTexture';
			nameLbl.setTextContent( pathLabel() );
			onChange( createTextureContent( {
				fallbackColor: c.solid.color,
				path: curPath,
				fileName: curName,
				alpha: alphaTex.getValue(),
				angle: angTex.getValue(),
				scale: scaleTex.getValue(),
				range: rangeTex.getValue(),
				uvMode: c.uvMode,
			} ) );

		} );
		row.add( rtSelect );
		row.add( new UIText( 'RT' ).setWidth( '22px' ).setMarginLeft( '4px' ).setColor( '#8af' ).setFontSize( '10px' ) );

		const clearBtn = new UIButton( '清除' ).setMarginLeft( '4px' );
		clearBtn.onClick( function () {

			curPath = '';
			curName = '';
			nameLbl.setTextContent( '未选' );
			rtSelect.setValue( '' );
			onChange( createTextureContent( {
				fallbackColor: c.solid.color,
				path: '',
				fileName: '',
				alpha: alphaTex.getValue(),
				angle: angTex.getValue(),
				scale: scaleTex.getValue(),
				range: rangeTex.getValue(),
				uvMode: c.uvMode,
			} ) );

		} );
		row.add( clearBtn );
		wrap.add( row );

		const row2 = new UIRow();
		row2.add( new UIText( '角度' ).setClass( 'Label' ).setWidth( '90px' ) );
		const angTex = new UINumber( tex.angle != null ? tex.angle : 0 ).setRange( - 360, 360 ).setWidth( '48px' );
		const scaleTex = new UINumber( tex.scale != null ? tex.scale : 1 ).setRange( 0.05, 16 ).setPrecision( 2 ).setWidth( '48px' );
		const alphaTex = new UINumber( tex.alpha != null ? tex.alpha : 1 ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '48px' );
		const rangeTex = new UINumber( tex.range != null ? tex.range : 1 ).setRange( 1, 64 ).setPrecision( 0 ).setStep( 1 ).setWidth( '48px' );
		function emitTex() {

			onChange( createTextureContent( {
				fallbackColor: c.solid.color,
				path: curPath,
				fileName: curName,
				alpha: alphaTex.getValue(),
				angle: angTex.getValue(),
				scale: scaleTex.getValue(),
				range: rangeTex.getValue(),
				uvMode: c.uvMode,
			} ) );

		}
		angTex.onChange( emitTex );
		scaleTex.onChange( emitTex );
		alphaTex.onChange( emitTex );
		rangeTex.onChange( emitTex );
		row2.add( angTex );
		row2.add( new UIText( '缩放' ).setWidth( '28px' ).setMarginLeft( '4px' ) );
		row2.add( scaleTex );
		row2.add( new UIText( 'α' ).setWidth( '16px' ).setMarginLeft( '4px' ) );
		row2.add( alphaTex );
		wrap.add( row2 );

		const rowRange = new UIRow();
		rowRange.add( new UIText( '分区' ).setClass( 'Label' ).setWidth( '90px' ) );
		rowRange.add( rangeTex );
		rowRange.add( new UIText( 'range (横条 atlas)' ).setWidth( '120px' ).setMarginLeft( '6px' ).setColor( '#888' ) );
		wrap.add( rowRange );

		const tip = new UIDiv();
		tip.setTextContent( 'RT: MediaFrame(GIF/序列/视频)→RenderTexture；range>1 需 Per-char UV' );
		tip.setFontSize( '10px' );
		tip.setColor( '#888' );
		wrap.add( tip );
		return wrap;

	}

	function contentPrimaryOrSolid( content ) {

		const c = normalizeFillContent( content );
		if ( c.renderType === 'gradient' ) return c.gradient.colors[ 0 ];
		return c.solid.color;

	}

	function rebuildFlowerPanel() {

		while ( flowerBlock.dom.firstChild ) {

			flowerBlock.dom.removeChild( flowerBlock.dom.firstChild );

		}

		const object = editor.selected;
		if ( ! isUIText( object ) ) return;
		const ui = getFccUI( object ) || {};
		// 花字 = Effect 栈数据挂在 Text.fccUI.flowerStyle 上，不是独立组件。
		// 无 flowerStyle 时用 legacy outline/shadow 合成预览；一改就写回 flowerStyle。
		const style = ensureFlowerStyle( ui );
		const persisted = !!( ui.flowerStyle && typeof ui.flowerStyle === 'object' );

		const FOLD_KEY = 'sidebar/text/flowerCollapsed';
		const flowerCollapsed = editor.config.getKey( FOLD_KEY ) !== false;

		const titleRow = new UIRow();
		titleRow.setCursor( 'pointer' );
		titleRow.dom.style.userSelect = 'none';
		const flowerCaret = new UIText( flowerCollapsed ? '▼' : '▲' ).setWidth( '16px' );
		titleRow.add( flowerCaret );
		titleRow.add( new UIText( '花字 · Effect 栈' ).setFontWeight( 'bold' ) );
		flowerBlock.add( titleRow );

		const flowerBody = new UIDiv();
		flowerBody.setDisplay( flowerCollapsed ? 'none' : '' );
		flowerBlock.add( flowerBody );

		titleRow.onClick( function () {

			const collapsed = ! ( editor.config.getKey( FOLD_KEY ) !== false );
			editor.config.setKey( FOLD_KEY, collapsed );
			flowerCaret.setTextContent( collapsed ? '▼' : '▲' );
			flowerBody.setDisplay( collapsed ? 'none' : '' );

		} );

		const tip = new UIDiv();
		tip.setTextContent( '统一 Effect 栈：上下排序任意交错（外描边↔投影等）。后→前 = 列表从上→下。' );
		tip.setFontSize( '11px' );
		tip.setColor( '#aaa' );
		tip.setMarginBottom( '4px' );
		flowerBody.add( tip );

		const masterRow = new UIRow();
		masterRow.add( new UIText( '\u663e\u793a Effect' ).setClass( 'Label' ).setWidth( '90px' ) );
		const masterEn = new UICheckbox( style.effectsEnabled !== false ).onChange( function () {

			style.effectsEnabled = !! masterEn.getValue();
			writeFlowerStyle( style, { rebuild: true } );

		} );
		masterRow.add( masterEn );
		masterRow.add( new UIText( '\uff08\u5173=\u4ec5\u586b\u5145\uff0c\u65e0\u63cf\u8fb9/\u6295\u5f71\uff09' ).setColor( '#888' ).setMarginLeft( '4px' ) );
		flowerBody.add( masterRow );

		const toolRow = new UIRow();
		toolRow.add( new UIText( persisted ? '已写入' : '未写入(预览)' ).setClass( 'Label' ).setWidth( '90px' ).setColor( '#8af' ) );
		const resetBtn = new UIButton( '重置特效' ).onClick( function () {

			const cur = getFccUI( editor.selected ) || {};
			const base = createDefaultFlowerStyle( {
				fill: {
					alpha: 1,
					content: createSolidContent( cur.color || '#ffffff', 1 ),
				},
			} );
			writeFlowerStyle( base, { rebuild: true } );

		} );
		toolRow.add( resetBtn );

		const jyBtn = new UIButton( '剪映样例' ).setMarginLeft( '4px' ).onClick( function () {

			const object = editor.selected;
			if ( ! isUIText( object ) ) return;
			const cur = getFccUI( object ) || {};
			const fs = Number( cur.fontSize ) > 0 ? Number( cur.fontSize ) : 48;
			const style = createJianying7645FlowerStyle( fs );
			prefetchFlowerTextures( style ).then( function () {

				writeFlowerStyle( style, { rebuild: true } );

			} ).catch( function () {

				writeFlowerStyle( style, { rebuild: true } );

			} );

		} );
		toolRow.add( jyBtn );

		if ( persisted ) {

			const clearBtn = new UIButton( '仅排版' ).setMarginLeft( '4px' ).onClick( function () {

				const object = editor.selected;
				if ( ! isUIText( object ) ) return;
				const ui = { ...getFccUI( object ) };
				ui.flowerStyle = null;
				if ( object.userData ) delete object.userData.__fccTextSig;
				const next = { ...object.userData, fccUI: ui };
				delete next.__fccTextSig;
				skipFlowerRebuild = true;
				try {

					editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
					syncSelectedText();
					signals.sceneGraphChanged.dispatch();

				} finally {

					skipFlowerRebuild = false;

				}
				rebuildFlowerPanel();

			} );
			toolRow.add( clearBtn );

		}
		flowerBody.add( toolRow );

		function commitStack() {

			style.stack = style.stack || [];
			writeFlowerStyle( style, { rebuild: true } );

		}

		function stackKindLabel( e ) {

			if ( ! e ) return '?';
			if ( e.kind === 'face' ) return '填充';
			if ( e.kind === 'stroke' ) return e.side === 'inner' ? '内描边' : '外描边';
			if ( e.kind === 'shadow' ) return '投影';
			if ( e.kind === 'inner' ) return '内投影';
			return e.kind;

		}

		flowerBody.add( new UIText( '层序（上=后 / 下=前）' ).setFontWeight( 'bold' ).setMarginTop( '6px' ) );

		const stack = Array.isArray( style.stack ) ? style.stack : [];
		stack.forEach( function ( entry, idx ) {

			const box = new UIDiv();
			box.setMarginTop( '4px' );
			box.dom.style.padding = '4px';
			box.dom.style.background = entry.kind === 'face' ? '#243044' : '#2a2a2a';
			const head = new UIRow();
			head.add( new UIText( ( idx + 1 ) + '. ' + stackKindLabel( entry ) ).setWidth( '88px' ) );

			if ( entry.kind !== 'face' ) {

				const en = new UICheckbox( entry.enable !== false ).onChange( function () {

					style.stack[ idx ].enable = en.getValue();
					writeFlowerStyle( style );

				} );
				head.add( en );

			}

			const upBtn = new UIButton( '↑' ).setMarginLeft( '4px' ).onClick( function () {

				style.stack = moveFlowerStackEntry( style.stack, idx, - 1 );
				commitStack();

			} );
			const downBtn = new UIButton( '↓' ).setMarginLeft( '2px' ).onClick( function () {

				style.stack = moveFlowerStackEntry( style.stack, idx, 1 );
				commitStack();

			} );
			head.add( upBtn );
			head.add( downBtn );

			if ( entry.kind !== 'face' ) {

				const del = new UIButton( '删' ).setMarginLeft( '4px' ).onClick( function () {

					style.stack.splice( idx, 1 );
					commitStack();

				} );
				head.add( del );

			}

			box.add( head );

			if ( entry.kind === 'face' ) {

				box.add( fillEditor( '', style.fill, function ( fill, opts ) {

					style.fill = {
						alpha: fill.alpha,
						content: fill.content,
						visible: fill.visible !== false,
					};
					writeFlowerStyle( style, opts );

				}, { showVisible: true } ) );

			} else if ( entry.kind === 'stroke' ) {

				const rowW = new UIRow();
				rowW.add( new UIText( '宽' ).setClass( 'Label' ).setWidth( '90px' ) );
				const wNum = new UINumber( entry.width ).setRange( 0, 256 ).setWidth( '48px' ).onChange( function () {

					style.stack[ idx ].width = wNum.getValue();
					writeFlowerStyle( style );

				} );
				rowW.add( wNum );
				box.add( rowW );
				box.add( fillEditor( '', { alpha: entry.alpha, content: entry.content }, function ( fill, opts ) {

					style.stack[ idx ].alpha = fill.alpha;
					style.stack[ idx ].content = fill.content;
					writeFlowerStyle( style, opts );

				} ) );

			} else if ( entry.kind === 'shadow' || entry.kind === 'inner' ) {

				const rowA = new UIRow();
				rowA.add( new UIText( '距离' ).setClass( 'Label' ).setWidth( '90px' ) );
				const dist = new UINumber( entry.distance ).setRange( 0, 256 ).setWidth( '48px' ).onChange( commitSh );
				const ang = new UINumber( entry.angle ).setRange( - 180, 180 ).setWidth( '48px' ).onChange( commitSh );
				rowA.add( dist );
				rowA.add( new UIText( '角' ).setWidth( '20px' ) );
				rowA.add( ang );
				box.add( rowA );

				const rowW = new UIRow();
				rowW.add( new UIText( '宽' ).setClass( 'Label' ).setWidth( '90px' ) );
				const wNum = new UINumber( entry.width != null ? entry.width : 0 ).setRange( 0, 256 ).setWidth( '48px' ).onChange( commitSh );
				rowW.add( wNum );
				rowW.add( new UIText( '（扩边）' ).setColor( '#888' ).setMarginLeft( '4px' ) );
				box.add( rowW );

				const rowB = new UIRow();
				rowB.add( new UIText( '模糊' ).setClass( 'Label' ).setWidth( '90px' ) );
				const dif = new UINumber( entry.diffuse ).setRange( 0, 64 ).setWidth( '48px' ).onChange( commitSh );
				const al = new UINumber( entry.alpha ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '48px' ).onChange( commitSh );
				rowB.add( dif );
				rowB.add( new UIText( 'α' ).setWidth( '20px' ) );
				rowB.add( al );
				box.add( rowB );

				function commitSh() {

					const rad = ang.getValue() * Math.PI / 180;
					const d = dist.getValue();
					style.stack[ idx ].distance = d;
					style.stack[ idx ].angle = ang.getValue();
					style.stack[ idx ].width = wNum.getValue();
					style.stack[ idx ].diffuse = dif.getValue();
					style.stack[ idx ].alpha = al.getValue();
					style.stack[ idx ].offsetX = Math.cos( rad ) * d;
					style.stack[ idx ].offsetY = Math.sin( rad ) * d;
					writeFlowerStyle( style );

				}

				box.add( fillEditor( '', { alpha: 1, content: entry.content }, function ( fill, opts ) {

					style.stack[ idx ].content = fill.content;
					writeFlowerStyle( style, opts );

				} ) );

				// Path1: nested strokes on outer shadow (投影上挂描边)
				if ( entry.kind === 'shadow' ) {

					if ( ! Array.isArray( style.stack[ idx ].strokes ) ) style.stack[ idx ].strokes = [];
					const nestTitle = new UIRow().setMarginTop( '4px' );
					nestTitle.add( new UIText( '投影描边' ).setFontWeight( 'bold' ).setWidth( '90px' ) );
					nestTitle.add( new UIText( '（跟投影偏移）' ).setColor( '#888' ) );
					box.add( nestTitle );

					style.stack[ idx ].strokes.forEach( function ( nst, nIdx ) {

						const nBox = new UIDiv();
						nBox.setMarginTop( '2px' );
						nBox.dom.style.padding = '3px';
						nBox.dom.style.background = '#222';
						const nHead = new UIRow();
						nHead.add( new UIText( '描边 ' + ( nIdx + 1 ) ).setWidth( '70px' ) );
						const nEn = new UICheckbox( nst.enable !== false ).onChange( function () {

							style.stack[ idx ].strokes[ nIdx ].enable = nEn.getValue();
							writeFlowerStyle( style );

						} );
						nHead.add( nEn );
						const nDel = new UIButton( '×' ).setMarginLeft( '4px' ).onClick( function () {

							style.stack[ idx ].strokes.splice( nIdx, 1 );
							writeFlowerStyle( style, { rebuild: true } );

						} );
						nHead.add( nDel );
						nBox.add( nHead );
						const nRowW = new UIRow();
						nRowW.add( new UIText( '宽' ).setClass( 'Label' ).setWidth( '90px' ) );
						const nW = new UINumber( nst.width != null ? nst.width : 4 ).setRange( 0, 256 ).setWidth( '48px' ).onChange( function () {

							style.stack[ idx ].strokes[ nIdx ].width = nW.getValue();
							writeFlowerStyle( style );

						} );
						nRowW.add( nW );
						nBox.add( nRowW );
						nBox.add( fillEditor( '', { alpha: nst.alpha, content: nst.content }, function ( fill, opts ) {

							style.stack[ idx ].strokes[ nIdx ].alpha = fill.alpha;
							style.stack[ idx ].strokes[ nIdx ].content = fill.content;
							writeFlowerStyle( style, opts );

						} ) );
						box.add( nBox );

					} );

					const addNest = new UIButton( '+投影描边' ).setMarginTop( '4px' ).onClick( function () {

						if ( ! Array.isArray( style.stack[ idx ].strokes ) ) style.stack[ idx ].strokes = [];
						style.stack[ idx ].strokes.push( createStrokeLayer( {
							side: 'outer',
							width: 4,
							content: createSolidContent( '#ffffff', 1 ),
						} ) );
						writeFlowerStyle( style, { rebuild: true } );

					} );
					box.add( addNest );

				}

			}

			flowerBody.add( box );

		} );

		const addRow = new UIRow().setMarginTop( '6px' );
		function addStackEntry( entry ) {

			const faceIdx = style.stack.findIndex( ( e ) => e && e.kind === 'face' );
			const insertAt = faceIdx >= 0 ? faceIdx : style.stack.length;
			// Default: new outer FX goes just behind face; inner FX just in front of face.
			if ( entry.kind === 'stroke' && entry.side === 'inner' ) {

				style.stack.splice( faceIdx >= 0 ? faceIdx + 1 : style.stack.length, 0, entry );

			} else if ( entry.kind === 'inner' ) {

				style.stack.splice( faceIdx >= 0 ? faceIdx + 1 : style.stack.length, 0, entry );

			} else {

				style.stack.splice( insertAt, 0, entry );

			}
			commitStack();

		}
		addRow.add( new UIButton( '+外描边' ).onClick( function () {

			addStackEntry( createStrokeStackEntry( { side: 'outer' } ) );

		} ) );
		addRow.add( new UIButton( '+投影' ).setMarginLeft( '4px' ).onClick( function () {

			addStackEntry( createShadowStackEntry() );

		} ) );
		addRow.add( new UIButton( '+内描边' ).setMarginLeft( '4px' ).onClick( function () {

			addStackEntry( createInnerStrokeStackEntry() );

		} ) );
		addRow.add( new UIButton( '+内投影' ).setMarginLeft( '4px' ).onClick( function () {

			addStackEntry( createInnerShadowStackEntry() );

		} ) );
		flowerBody.add( addRow );

	}

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

		const prevFontSize = Number( ui.fontSize ) > 0 ? Number( ui.fontSize ) : 48;
		const nextFontSize = Number( fontSizeNum.getValue() ) > 0 ? Number( fontSizeNum.getValue() ) : 48;
		ui.fontSize = nextFontSize;
		ui.bold = !! boldCheck.getValue();
		ui.italic = !! italicCheck.getValue();
		ui.fontStyle = ui.italic ? 'italic' : 'normal';
		ui.color = colorInput.getValue();
		// Keep Effect-stack fill in sync when flowerStyle already persisted
		let flowerRescaled = false;
		if ( ui.flowerStyle && typeof ui.flowerStyle === 'object' ) {
			let fs = cloneFlowerStyle( ui.flowerStyle );
			// Scale stroke/shadow linear px with fontSize (CapCut em-like behaviour).
			const baseFs = Number( ui.flowerBaseFontSize ) > 0 ? Number( ui.flowerBaseFontSize ) : prevFontSize;
			if ( Math.abs( nextFontSize - baseFs ) > 1e-6 ) {
				fs = rescaleFlowerStyleForFontSize( fs, baseFs, nextFontSize );
				flowerRescaled = true;
			}
			const fillC = normalizeFillContent( fs.fill && fs.fill.content );
			if ( fillC.renderType === 'solid' ) {
				fs.fill = { alpha: fs.fill && fs.fill.alpha != null ? fs.fill.alpha : 1,
					content: createSolidContent( ui.color, fillC.solid.alpha ) };
			}
			ui.flowerStyle = fs;
			ui.flowerBaseFontSize = nextFontSize;
		}
		ui.letterSpacing = letterNum.getValue();
		ui.lineHeight = lineNum.getValue();
		ui.align = alignSelect.getValue();
		ui.verticalAlign = vAlignSelect.getValue();
		// Legacy outline / shadow: scale widget values when fontSize changed, then write.
		let olW = Number( outlineWidth.getValue() ) || 0;
		let shOX = Number( shadowOX.getValue() ) || 0;
		let shOY = Number( shadowOY.getValue() ) || 0;
		let shBlur = Number( shadowBlur.getValue() ) || 0;
		if ( Math.abs( nextFontSize - prevFontSize ) > 1e-6 && prevFontSize > 0 ) {

			const legF = nextFontSize / prevFontSize;
			olW = Math.max( 0, olW * legF );
			shOX *= legF;
			shOY *= legF;
			shBlur = Math.max( 0, shBlur * legF );
			outlineWidth.setValue( olW );
			shadowOX.setValue( shOX );
			shadowOY.setValue( shOY );
			shadowBlur.setValue( shBlur );

		}

		ui.outline = {
			enabled: !! outlineEn.getValue(),
			width: olW,
			color: outlineColor.getValue(),
			opacity: outlineOpacity.getValue(),
		};
		ui.shadow = {
			enabled: !! shadowEn.getValue(),
			offsetX: shOX,
			offsetY: shOY,
			blur: shBlur,
			color: shadowColor.getValue(),
			opacity: 0.75,
		};

		const next = { ...object.userData, fccUI: ui };
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		syncSelectedText();
		signals.sceneGraphChanged.dispatch();
		// Refresh Effect stack number fields after fontSize-driven rescale.
		if ( flowerRescaled ) rebuildFlowerPanel();

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
		'位移用「锚点位置」。宽高只改网格尺寸，勿写入 Scale。旋转/缩放为 localEulerAngles / localScale。字体用「文件」选 TTF。'
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
		if ( ! isUIText( object ) ) {

			while ( flowerBlock.dom.firstChild ) flowerBlock.dom.removeChild( flowerBlock.dom.firstChild );

		}


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
			italicCheck.setValue( !! ui.italic || ui.fontStyle === 'italic' );
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

			if ( ! skipFlowerRebuild ) rebuildFlowerPanel();
			// Legacy single outline/shadow UI retired — FX live in 花字 Effect 栈 only.
			outlineEnRow.setDisplay( 'none' );
			outlineRow.setDisplay( 'none' );
			shadowEnRow.setDisplay( 'none' );
			shadowOffRow.setDisplay( 'none' );
			shadowBlurRow.setDisplay( 'none' );


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
