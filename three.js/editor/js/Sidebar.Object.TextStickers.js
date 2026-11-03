/**
 * Sidebar: Text sticker-follow editor (fccUI.textStickers).
 * Pick glyph (first/last/index/all/each), scale AABB, offset, texture range, sort.
 * Material mode reuses Project 材质球 + Properties Material tab.
 */
import { UIPanel, UIRow, UIText, UIButton, UISelect, UICheckbox, UINumber, UIDiv, UIInput, UIColor } from './libs/ui.js';
import { getFccUI, isUIText } from './ui/UIConstants.js?v=fcc-ui-106';
import {
	ensureTextStickersOnUI,
	createDefaultTextSticker,
	normalizeTextSticker,
	syncTextStickers,
	findTextStickerMesh,
} from './ui/TextStickers.js?v=fcc-ui-211';
import { listRenderTextureOptions } from './media/FccVideo.js?v=fcc-ui-207';
import { createFreeFilmCutShaderMaterial } from './FreeCapCutShaders.js?v=fcc-ui-206';

function SidebarObjectTextStickers( editor ) {

	const strings = editor.strings;
	const signals = editor.signals;
	const lang = editor.config.getKey( 'language' ) || 'en';
	const zh = lang === 'zh';

	const container = new UIPanel();
	container.setBorderTop( '2px solid #a84' );
	container.setMarginTop( '12px' );
	container.setPaddingTop( '10px' );
	container.setDisplay( 'none' );
	container.dom.style.background = '#24201e';
	container.dom.style.padding = '8px';
	container.dom.style.borderRadius = '4px';

	const FOLD_KEY = 'sidebar/text/stickersCollapsed';
	function isCollapsed() {

		return editor.config.getKey( FOLD_KEY ) === true;

	}

	const headerRow = new UIRow();
	headerRow.setCursor( 'pointer' );
	headerRow.dom.style.userSelect = 'none';
	const caret = new UIText( isCollapsed() ? '▸' : '▾' ).setWidth( '16px' ).setColor( '#fc8' );
	const title = new UIText(
		zh ? '贴纸跟随' : ( strings.getKey( 'sidebar/object/textstickers' ) || 'Text stickers' )
	).setFontWeight( 'bold' ).setColor( '#fc8' );
	headerRow.add( caret );
	headerRow.add( title );
	container.add( headerRow );

	const body = new UIDiv();
	body.setDisplay( isCollapsed() ? 'none' : '' );
	container.add( body );

	headerRow.onClick( function () {

		const next = ! isCollapsed();
		editor.config.setKey( FOLD_KEY, next );
		caret.setTextContent( next ? '▸' : '▾' );
		body.setDisplay( next ? 'none' : '' );

	} );

	body.add( new UIText(
		zh
			? '选字母 AABB 铺贴纸（scale 可 >1），offset 微调；每帧跟随拆字。默认在文字后，可选文字前（不改动文字↔特效层序）。材质球模式走工程材质库 + 属性「材质」面板。'
			: 'Cover glyph AABB (scale may be >1), then offset. Follows char poses. Default behind text; front is above text + effect stack. Material-ball mode uses project materials + Material tab.'
	).setFontSize( '11px' ).setColor( '#aaa' ).setMarginTop( '4px' ) );

	const listPanel = new UIDiv().setMarginTop( '8px' );
	body.add( listPanel );

	const addRow = new UIRow().setMarginTop( '8px' );
	const addBtn = new UIButton( zh ? '添加贴纸' : 'Add sticker' );
	addBtn.onClick( function () {

		const ui = currentUI();
		if ( ! ui ) return;
		const list = ensureTextStickersOnUI( ui );
		const s = createDefaultTextSticker();
		s.name = ( zh ? '贴纸' : 'Sticker' ) + ' ' + ( list.length + 1 );
		s.sort = list.length;
		list.push( s );
		dirty();
		rebuild();

	} );
	addRow.add( addBtn );
	body.add( addRow );

	function currentObject() {

		const o = editor.selected;
		return isUIText( o ) ? o : null;

	}

	function currentUI() {

		const o = currentObject();
		return o ? getFccUI( o ) : null;

	}

	/** Always resolve the live sticker object by id (never a stale closure copy). */
	function liveSticker( id ) {

		const ui = currentUI();
		if ( ! ui ) return null;
		const list = ensureTextStickersOnUI( ui );
		return list.find( ( x ) => x && x.id === id ) || null;

	}

	function mutate( id, fn ) {

		const s = liveSticker( id );
		if ( ! s ) return;
		fn( s );
		dirty();

	}

	function dirty() {

		const o = currentObject();
		if ( ! o ) return;
		syncTextStickers( o, editor.materials );
		editor.signals.objectChanged.dispatch( o );
		if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();

	}

	function materialOptions() {

		const opts = { '': zh ? '（未选材质球）' : '(none)' };
		const mats = Object.values( editor.materials || {} );
		for ( let i = 0; i < mats.length; i ++ ) {

			const m = mats[ i ];
			if ( ! m || ! m.uuid ) continue;
			const label = ( m.name && String( m.name ).trim() )
				? m.name
				: ( ( m.type || 'Material' ) + ' ' + m.uuid.slice( 0, 8 ) );
			opts[ m.uuid ] = label;

		}
		return opts;

	}

	function openMaterialTabForSticker( stickerId ) {

		const o = currentObject();
		if ( ! o ) return;
		syncTextStickers( o, editor.materials );
		const mesh = findTextStickerMesh( o, stickerId );
		if ( ! mesh ) {

			window.alert( zh ? '找不到贴纸网格，请先启用贴纸' : 'Sticker mesh not found' );
			return;

		}
		editor.select( mesh );
		requestAnimationFrame( function () {

			const tab = document.getElementById( 'materialTab' );
			if ( tab ) tab.click();

		} );

	}

	function rebuild() {

		while ( listPanel.dom.firstChild ) listPanel.dom.removeChild( listPanel.dom.firstChild );
		const ui = currentUI();
		if ( ! ui ) return;
		const list = ensureTextStickersOnUI( ui );
		const ordered = list.map( ( s, idx ) => ( { s, idx } ) )
			.sort( ( a, b ) => ( a.s.sort - b.s.sort ) || ( a.idx - b.idx ) );

		for ( let k = 0; k < ordered.length; k ++ ) {

			listPanel.add( buildCard( ordered[ k ].s.id ) );

		}

	}

	function buildCard( stickerId ) {

		const s0 = liveSticker( stickerId );
		if ( ! s0 ) return new UIDiv();
		normalizeTextSticker( s0 ); // in-place via assign in ensure; here just read fields
		const s = s0;

		const box = new UIDiv();
		box.setMarginTop( '8px' );
		box.setPaddingTop( '6px' );
		box.dom.style.borderTop = '1px solid #444';

		const head = new UIRow();
		const nameIn = new UIInput( s.name ).setWidth( '100px' );
		nameIn.onChange( function () {

			mutate( stickerId, ( st ) => { st.name = nameIn.getValue(); } );

		} );
		head.add( nameIn );
		const en = new UICheckbox( s.enabled ).onChange( function () {

			mutate( stickerId, ( st ) => { st.enabled = en.getValue(); } );

		} );
		head.add( new UIText( zh ? '启用' : 'On' ).setMarginLeft( '6px' ) );
		head.add( en );
		box.add( head );

		const sortRow = new UIRow();
		sortRow.add( new UIText( 'sort' ).setClass( 'Label' ).setWidth( '70px' ) );
		const sortNum = new UINumber( s.sort ).setPrecision( 0 ).setWidth( '48px' );
		sortNum.onChange( function () {

			mutate( stickerId, ( st ) => { st.sort = Math.round( sortNum.getValue() ); } );
			rebuild();

		} );
		sortRow.add( sortNum );
		const upBtn = new UIButton( '↑' ).setMarginLeft( '4px' );
		upBtn.onClick( function () {

			mutate( stickerId, ( st ) => { st.sort = ( Number( st.sort ) || 0 ) - 1; } );
			rebuild();

		} );
		const downBtn = new UIButton( '↓' ).setMarginLeft( '2px' );
		downBtn.onClick( function () {

			mutate( stickerId, ( st ) => { st.sort = ( Number( st.sort ) || 0 ) + 1; } );
			rebuild();

		} );
		sortRow.add( upBtn );
		sortRow.add( downBtn );
		box.add( sortRow );

		const layerRow = new UIRow();
		layerRow.add( new UIText( zh ? '相对文字' : 'vs text' ).setClass( 'Label' ).setWidth( '70px' ) );
		const layerSel = new UISelect().setWidth( '100px' );
		layerSel.setOptions( {
			behind: zh ? '文字后' : 'behind text',
			front: zh ? '文字前' : 'in front',
		} );
		layerSel.setValue( s.layer === 'front' ? 'front' : 'behind' );
		layerSel.onChange( function () {

			mutate( stickerId, ( st ) => {

				st.layer = layerSel.getValue() === 'front' ? 'front' : 'behind';

			} );

		} );
		layerRow.add( layerSel );
		box.add( layerRow );

		const charRow = new UIRow();
		charRow.add( new UIText( zh ? '字母' : 'Glyph' ).setClass( 'Label' ).setWidth( '70px' ) );
		const charSel = new UISelect().setWidth( '80px' );
		charSel.setOptions( {
			first: zh ? '首字' : 'first',
			last: zh ? '尾字' : 'last',
			index: zh ? '索引' : 'index',
			all: zh ? '全部' : 'all',
			each: zh ? '逐字' : 'each',
		} );
		charSel.setValue( s.char );
		charSel.onChange( function () {

			mutate( stickerId, ( st ) => { st.char = charSel.getValue(); } );
			rebuild();

		} );
		charRow.add( charSel );
		if ( s.char === 'index' ) {

			const idxNum = new UINumber( s.charIndex ).setPrecision( 0 ).setRange( 0, 999 ).setWidth( '48px' ).setMarginLeft( '4px' );
			idxNum.onChange( function () {

				mutate( stickerId, ( st ) => {

					st.charIndex = Math.max( 0, Math.round( idxNum.getValue() ) );

				} );

			} );
			charRow.add( idxNum );

		}
		box.add( charRow );
		if ( s.char === 'each' ) {
			box.add( new UIText(
				zh ? '逐字：每个字母各一片，贴图按分区(range)横条 i%range' : 'each: one piece per glyph; atlas strip i%range'
			).setFontSize( '10px' ).setColor( '#888' ).setMarginTop( '2px' ) );
		}

		const scaleRow = new UIRow();
		scaleRow.add( new UIText( zh ? '缩放' : 'Scale' ).setClass( 'Label' ).setWidth( '70px' ) );
		const sx = new UINumber( s.scaleX ).setPrecision( 2 ).setRange( 0.05, 16 ).setWidth( '48px' );
		const sy = new UINumber( s.scaleY ).setPrecision( 2 ).setRange( 0.05, 16 ).setWidth( '48px' );
		function emitScale() {

			mutate( stickerId, ( st ) => {

				st.scaleX = Math.max( 0.05, sx.getValue() );
				st.scaleY = Math.max( 0.05, sy.getValue() );

			} );

		}
		sx.onChange( emitScale );
		sy.onChange( emitScale );
		scaleRow.add( sx );
		scaleRow.add( new UIText( '×' ).setMarginLeft( '2px' ).setMarginRight( '2px' ) );
		scaleRow.add( sy );
		box.add( scaleRow );

		const offRow = new UIRow();
		offRow.add( new UIText( 'offset' ).setClass( 'Label' ).setWidth( '70px' ) );
		const ox = new UINumber( s.offsetX ).setPrecision( 1 ).setWidth( '48px' );
		const oy = new UINumber( s.offsetY ).setPrecision( 1 ).setWidth( '48px' );
		function emitOff() {

			mutate( stickerId, ( st ) => {

				st.offsetX = ox.getValue();
				st.offsetY = oy.getValue();

			} );

		}
		ox.onChange( emitOff );
		oy.onChange( emitOff );
		offRow.add( ox );
		offRow.add( oy );
		box.add( offRow );

		const rotRow = new UIRow();
		rotRow.add( new UIText( zh ? '旋转°' : 'Rot°' ).setClass( 'Label' ).setWidth( '70px' ) );
		const rotDeg = new UINumber( ( s.rotation * 180 ) / Math.PI ).setPrecision( 1 ).setWidth( '56px' );
		rotDeg.onChange( function () {

			mutate( stickerId, ( st ) => {

				st.rotation = ( rotDeg.getValue() * Math.PI ) / 180;

			} );

		} );
		rotRow.add( rotDeg );
		box.add( rotRow );

		const followRow = new UIRow();
		const followCb = new UICheckbox( s.followCharAnim !== false ).onChange( function () {

			mutate( stickerId, ( st ) => { st.followCharAnim = followCb.getValue(); } );

		} );
		followRow.add( new UIText( zh ? '跟随拆字' : 'Follow char anim' ).setClass( 'Label' ).setWidth( '90px' ) );
		followRow.add( followCb );
		box.add( followRow );

		const matRow = new UIRow();
		matRow.add( new UIText( zh ? '材质' : 'Material' ).setClass( 'Label' ).setWidth( '70px' ) );
		const matSel = new UISelect().setWidth( '100px' );
		matSel.setOptions( {
			sprite: zh ? '贴图精灵' : 'sprite',
			material: zh ? '材质球' : 'material ball',
		} );
		matSel.setValue( s.material === 'material' ? 'material' : 'sprite' );
		matSel.onChange( function () {

			mutate( stickerId, ( st ) => {

				st.material = matSel.getValue() === 'material' ? 'material' : 'sprite';

			} );
			rebuild();

		} );
		matRow.add( matSel );
		box.add( matRow );

		if ( s.material === 'material' ) {

			const ballRow = new UIRow();
			ballRow.add( new UIText( zh ? '材质球' : 'Ball' ).setClass( 'Label' ).setWidth( '70px' ) );
			const ballSel = new UISelect().setWidth( '120px' );
			ballSel.setOptions( materialOptions() );
			ballSel.setValue( s.materialUuid || '' );
			ballSel.onChange( function () {

				mutate( stickerId, ( st ) => {

					st.material = 'material';
					st.materialUuid = ballSel.getValue() || '';

				} );

			} );
			ballRow.add( ballSel );
			box.add( ballRow );

			const ballBtnRow = new UIRow();
			const newBall = new UIButton( zh ? '新建材质球' : 'New material' );
			newBall.onClick( function () {

				const mat = createFreeFilmCutShaderMaterial( 'ShaderMaterial', null );
				mat.name = ( zh ? '贴纸材质' : 'StickerMat' ) + ' ' + stickerId.slice( - 4 );
				editor.addMaterial( mat );
				mutate( stickerId, ( st ) => {

					st.material = 'material';
					st.materialUuid = mat.uuid;

				} );
				rebuild();
				openMaterialTabForSticker( stickerId );

			} );
			ballBtnRow.add( newBall );
			const editBall = new UIButton( zh ? '编辑材质' : 'Edit material' ).setMarginLeft( '4px' );
			editBall.onClick( function () {

				const st = liveSticker( stickerId );
				if ( ! st ) return;
				if ( ! st.materialUuid || ! editor.materials[ st.materialUuid ] ) {

					window.alert( zh ? '请先选择或新建材质球' : 'Pick or create a material ball first' );
					return;

				}
				openMaterialTabForSticker( stickerId );

			} );
			ballBtnRow.add( editBall );
			box.add( ballBtnRow );
			box.add( new UIText(
				zh ? '编辑会选中贴纸网格并打开「材质」面板（含 shader / uniforms）' : 'Edit selects the sticker mesh and opens the Material tab'
			).setFontSize( '10px' ).setColor( '#888' ).setMarginTop( '2px' ) );

		} else {

			const texRow = new UIRow();
			texRow.add( new UIText( zh ? '贴图' : 'Texture' ).setClass( 'Label' ).setWidth( '70px' ) );
			function pathLabel() {

				const tp = s.texturePath || '';
				if ( tp && String( tp ).startsWith( 'rt:' ) ) {

					return ( s.textureFileName || 'RT' ) + ' (RT)';

				}
				return s.textureFileName || ( tp ? '…' : ( zh ? '未选' : 'none' ) );

			}
			const nameLbl = new UIText( pathLabel() ).setWidth( '80px' );
			texRow.add( nameLbl );
			const fileBtn = new UIButton( zh ? '文件' : 'File' ).setMarginLeft( '4px' );
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
						mutate( stickerId, ( st ) => {

							st.texturePath = url;
							st.textureFileName = file.name;
							delete st.rtTargetUuid;

						} );
						s.texturePath = url;
						s.textureFileName = file.name;
						nameLbl.setTextContent( file.name );
						rtSelect.setValue( '' );

					} catch ( e ) {

						window.alert( ( zh ? '读取贴图失败: ' : 'Texture read failed: ' ) + ( e && e.message ? e.message : e ) );

					}

				} );
				input.click();

			} );
			texRow.add( fileBtn );

			const rtSelect = new UISelect().setWidth( '110px' ).setMarginLeft( '4px' );
			function refreshRtOptions() {

				rtSelect.setOptions( listRenderTextureOptions( editor.scene ) );
				const tp = s.texturePath || '';
				if ( tp && String( tp ).startsWith( 'rt:' ) ) {

					rtSelect.setValue( String( tp ).slice( 3 ) );

				} else {

					rtSelect.setValue( '' );

				}

			}
			refreshRtOptions();
			rtSelect.onChange( function () {

				const uuid = rtSelect.getValue();
				if ( ! uuid ) return;
				const opts = listRenderTextureOptions( editor.scene );
				const curPath = 'rt:' + uuid;
				const curName = opts[ uuid ] || 'RenderTexture';
				mutate( stickerId, ( st ) => {

					st.texturePath = curPath;
					st.textureFileName = curName;
					st.rtTargetUuid = uuid;

				} );
				s.texturePath = curPath;
				s.textureFileName = curName;
				nameLbl.setTextContent( ( curName || 'RT' ) + ' (RT)' );

			} );
			texRow.add( rtSelect );
			texRow.add( new UIText( 'RT' ).setWidth( '22px' ).setMarginLeft( '4px' ).setColor( '#8af' ).setFontSize( '10px' ) );

			const clearBtn = new UIButton( zh ? '清除' : 'Clear' ).setMarginLeft( '2px' );
			clearBtn.onClick( function () {

				mutate( stickerId, ( st ) => {

					st.texturePath = '';
					st.textureFileName = '';
					delete st.rtTargetUuid;

				} );
				s.texturePath = '';
				s.textureFileName = '';
				nameLbl.setTextContent( zh ? '未选' : 'none' );
				rtSelect.setValue( '' );

			} );
			texRow.add( clearBtn );
			box.add( texRow );

			const opRow = new UIRow();
			opRow.add( new UIText( zh ? '不透明' : 'Opacity' ).setClass( 'Label' ).setWidth( '70px' ) );
			const opNum = new UINumber( s.opacity ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '48px' );
			opNum.onChange( function () {

				mutate( stickerId, ( st ) => {

					st.opacity = Math.max( 0, Math.min( 1, opNum.getValue() ) );

				} );

			} );
			opRow.add( opNum );
			const col = new UIColor().setValue( s.color || '#ffffff' );
			col.onInput( function () {

				mutate( stickerId, ( st ) => { st.color = col.getValue(); } );

			} );
			opRow.add( col );
			box.add( opRow );

		}

		const rangeRow = new UIRow();
		rangeRow.add( new UIText( zh ? '分区' : 'Range' ).setClass( 'Label' ).setWidth( '70px' ) );
		const rangeNum = new UINumber( s.textureRange != null ? s.textureRange : 1 ).setPrecision( 0 ).setStep( 1 ).setRange( 1, 64 ).setWidth( '48px' );
		rangeNum.onChange( function () {

			mutate( stickerId, ( st ) => {

				let n = Math.round( rangeNum.getValue() );
				if ( ! Number.isFinite( n ) || n < 1 ) n = 1;
				st.textureRange = n;
				// Mirror onto linked material ball when present (shader uFccTexRange / userData).
				if ( st.material === 'material' && st.materialUuid && editor.materials && editor.materials[ st.materialUuid ] ) {
					const mat = editor.materials[ st.materialUuid ];
					if ( ! mat.userData ) mat.userData = {};
					mat.userData.fccTexRange = n;
					if ( mat.uniforms ) {
						if ( ! mat.uniforms.uFccTexRange ) mat.uniforms.uFccTexRange = { value: n };
						else mat.uniforms.uFccTexRange.value = n;
					}
				}

			} );

		} );
		rangeRow.add( rangeNum );
		rangeRow.add( new UIText( zh ? 'range 横条 atlas' : 'atlas strips' ).setWidth( '110px' ).setMarginLeft( '6px' ).setColor( '#888' ) );
		box.add( rangeRow );

		const delRow = new UIRow().setMarginTop( '4px' );
		const delBtn = new UIButton( zh ? '删除' : 'Remove' );
		delBtn.onClick( function () {

			const ui = currentUI();
			if ( ! ui ) return;
			const list = ensureTextStickersOnUI( ui );
			const i = list.findIndex( ( x ) => x && x.id === stickerId );
			if ( i < 0 ) return;
			list.splice( i, 1 );
			dirty();
			rebuild();

		} );
		delRow.add( delBtn );
		box.add( delRow );

		return box;

	}

	function refresh() {

		const o = currentObject();
		if ( ! o ) {

			container.setDisplay( 'none' );
			return;

		}
		container.setDisplay( '' );
		rebuild();

	}

	signals.objectSelected.add( refresh );
	signals.objectChanged.add( function ( object ) {

		if ( object !== editor.selected ) return;

	} );
	signals.refreshSidebarObject3D.add( function ( object ) {

		if ( object !== editor.selected ) return;
		refresh();

	} );
	if ( signals.materialAdded ) signals.materialAdded.add( function () {

		if ( currentObject() ) rebuild();

	} );
	if ( signals.materialRemoved ) signals.materialRemoved.add( function () {

		if ( currentObject() ) rebuild();

	} );

	refresh();
	return container;

}

export { SidebarObjectTextStickers };
