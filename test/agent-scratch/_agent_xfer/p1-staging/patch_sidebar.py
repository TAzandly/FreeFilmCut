# -*- coding: utf-8 -*-
from pathlib import Path

path = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
src = path.read_text(encoding="utf-8")

# Update imports
src = src.replace(
    "from './ui/UIConstants.js?v=fcc-ui-18';",
    "from './ui/UIConstants.js?v=fcc-ui-55';",
)
src = src.replace(
    "from './ui/UIRectLayout.js?v=fcc-ui-18';",
    "from './ui/UIRectLayout.js?v=fcc-ui-55';",
)
src = src.replace(
    "from './ui/UIText.js?v=fcc-ui-18';",
    "from './ui/UIText.js?v=fcc-ui-55';",
)

flower_import = """import {
	createDefaultFlowerStyle,
	createStrokeLayer,
	createShadowLayer,
	createSolidContent,
	createGradientContent,
	cloneFlowerStyle,
	normalizeFlowerStyle,
	flowerStyleFromLegacy,
	normalizeFillContent,
} from './ui/FlowerStyle.js?v=fcc-ui-55';
"""

if "FlowerStyle.js" not in src:
    src = src.replace(
        "import { syncUITextContent } from './ui/UIText.js?v=fcc-ui-55';",
        "import { syncUITextContent } from './ui/UIText.js?v=fcc-ui-55';\n" + flower_import,
    )

FLOWER_BLOCK = r'''
	// ---- 花字 (FlowerStyle Effect stack) ----
	const flowerBlock = new UIDiv();
	flowerBlock.setMarginTop( '8px' );
	flowerBlock.setPaddingTop( '6px' );
	flowerBlock.dom.style.borderTop = '1px solid #444';
	textBlock.add( flowerBlock );

	function ensureFlowerStyle( ui ) {

		if ( ui.flowerStyle && typeof ui.flowerStyle === 'object' ) {

			return cloneFlowerStyle( ui.flowerStyle );

		}

		return flowerStyleFromLegacy( ui );

	}

	function writeFlowerStyle( style ) {

		const object = editor.selected;
		if ( ! isUIText( object ) ) return;
		const ui = { ...getFccUI( object ) };
		ui.flowerStyle = cloneFlowerStyle( style );
		// Keep basic color in sync with fill solid/gradient primary
		const fillC = normalizeFillContent( ui.flowerStyle.fill && ui.flowerStyle.fill.content );
		if ( fillC.renderType === 'gradient' ) ui.color = fillC.gradient.colors[ 0 ];
		else ui.color = fillC.solid.color;
		if ( object.userData ) delete object.userData.__fccTextSig;
		const next = { ...object.userData, fccUI: ui };
		delete next.__fccTextSig;
		editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
		syncSelectedText();
		signals.sceneGraphChanged.dispatch();
		rebuildFlowerPanel();

	}

	function contentTypeSelect( content, onType ) {

		const row = new UIRow();
		row.add( new UIText( '填充' ).setClass( 'Label' ).setWidth( '90px' ) );
		const sel = new UISelect().setWidth( '100px' ).setOptions( {
			solid: '纯色',
			gradient: '渐变',
			texture: '贴图(暂)',
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

	function fillEditor( label, fillObj, onFill ) {

		const wrap = new UIDiv();
		wrap.add( new UIText( label ).setFontWeight( 'bold' ).setMarginTop( '4px' ) );
		const content = ( fillObj && fillObj.content ) || createSolidContent( '#ffffff', 1 );
		const alphaRow = new UIRow();
		alphaRow.add( new UIText( '不透明度' ).setClass( 'Label' ).setWidth( '90px' ) );
		const alphaNum = new UINumber( fillObj && fillObj.alpha != null ? fillObj.alpha : 1 )
			.setRange( 0, 1 ).setPrecision( 2 ).setWidth( '50px' );
		alphaNum.onChange( function () {

			onFill( {
				alpha: alphaNum.getValue(),
				content: normalizeFillContent( content ),
			} );

		} );
		alphaRow.add( alphaNum );
		wrap.add( alphaRow );

		function setContent( nextContent ) {

			onFill( {
				alpha: alphaNum.getValue(),
				content: nextContent,
			} );

		}

		wrap.add( contentTypeSelect( content, function ( type ) {

			if ( type === 'gradient' ) setContent( createGradientContent( {
				colors: normalizeFillContent( content ).gradient.colors,
				angle: normalizeFillContent( content ).gradient.angle,
			} ) );
			else if ( type === 'texture' ) setContent( {
				...createSolidContent( normalizeFillContent( content ).solid.color, 1 ),
				renderType: 'texture',
			} );
			else setContent( createSolidContent( contentPrimaryOrSolid( content ), 1 ) );

		} ) );

		const rt = normalizeFillContent( content ).renderType;
		if ( rt === 'gradient' ) wrap.add( gradientControls( content, setContent ) );
		else wrap.add( solidControls( content, setContent ) );
		if ( rt === 'texture' ) {

			const hint = new UIDiv();
			hint.setTextContent( '贴图填充 P2 再做，当前按纯色回退' );
			hint.setFontSize( '10px' );
			hint.setColor( '#888' );
			wrap.add( hint );

		}

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
		const hasFlower = !!( ui.flowerStyle && typeof ui.flowerStyle === 'object' );

		const titleRow = new UIRow();
		titleRow.add( new UIText( '花字' ).setFontWeight( 'bold' ) );
		flowerBlock.add( titleRow );

		const enRow = new UIRow();
		enRow.add( new UIText( '启用' ).setClass( 'Label' ).setWidth( '90px' ) );
		const enBtn = new UIButton( hasFlower ? '已启用' : '从基础生成' ).onClick( function () {

			const style = ensureFlowerStyle( getFccUI( editor.selected ) || {} );
			writeFlowerStyle( style );

		} );
		enRow.add( enBtn );
		if ( hasFlower ) {

			const clearBtn = new UIButton( '清除' ).setMarginLeft( '4px' ).onClick( function () {

				const object = editor.selected;
				if ( ! isUIText( object ) ) return;
				const ui = { ...getFccUI( object ) };
				ui.flowerStyle = null;
				if ( object.userData ) delete object.userData.__fccTextSig;
				const next = { ...object.userData, fccUI: ui };
				delete next.__fccTextSig;
				editor.execute( new SetValueCommand( editor, object, 'userData', next ) );
				syncSelectedText();
				signals.sceneGraphChanged.dispatch();
				rebuildFlowerPanel();

			} );
			enRow.add( clearBtn );

		}

		flowerBlock.add( enRow );

		if ( ! hasFlower ) {

			const tip = new UIDiv();
			tip.setTextContent( '启用后可多层描边/投影，支持纯色与线性渐变（贴图 P2）' );
			tip.setFontSize( '11px' );
			tip.setColor( '#aaa' );
			flowerBlock.add( tip );
			return;

		}

		const style = cloneFlowerStyle( ui.flowerStyle );

		flowerBlock.add( fillEditor( '面填充', style.fill, function ( fill ) {

			style.fill = fill;
			writeFlowerStyle( style );

		} ) );

		// Strokes
		flowerBlock.add( new UIText( '描边' ).setFontWeight( 'bold' ).setMarginTop( '6px' ) );
		style.strokes.forEach( function ( stroke, idx ) {

			const box = new UIDiv();
			box.setMarginTop( '4px' );
			box.dom.style.padding = '4px';
			box.dom.style.background = '#2a2a2a';
			const head = new UIRow();
			head.add( new UIText( '描边 ' + ( idx + 1 ) ).setWidth( '70px' ) );
			const en = new UICheckbox( !! stroke.enable ).onChange( function () {

				style.strokes[ idx ].enable = en.getValue();
				writeFlowerStyle( style );

			} );
			head.add( en );
			head.add( new UIText( '宽' ).setMarginLeft( '6px' ) );
			const wNum = new UINumber( stroke.width ).setRange( 0, 256 ).setWidth( '48px' ).onChange( function () {

				style.strokes[ idx ].width = wNum.getValue();
				writeFlowerStyle( style );

			} );
			head.add( wNum );
			const del = new UIButton( '删' ).setMarginLeft( '4px' ).onClick( function () {

				style.strokes.splice( idx, 1 );
				writeFlowerStyle( style );

			} );
			head.add( del );
			box.add( head );
			box.add( fillEditor( '', { alpha: stroke.alpha, content: stroke.content }, function ( fill ) {

				style.strokes[ idx ].alpha = fill.alpha;
				style.strokes[ idx ].content = fill.content;
				writeFlowerStyle( style );

			} ) );
			flowerBlock.add( box );

		} );
		const addStroke = new UIButton( '+ 描边' ).setMarginTop( '4px' ).onClick( function () {

			style.strokes.push( createStrokeLayer() );
			writeFlowerStyle( style );

		} );
		flowerBlock.add( addStroke );

		function shadowList( title, key ) {

			flowerBlock.add( new UIText( title ).setFontWeight( 'bold' ).setMarginTop( '6px' ) );
			const arr = style[ key ];
			arr.forEach( function ( sh, idx ) {

				const box = new UIDiv();
				box.setMarginTop( '4px' );
				box.dom.style.padding = '4px';
				box.dom.style.background = '#2a2a2a';
				const head = new UIRow();
				head.add( new UIText( title.replace( '投影', '' ).replace( '内', '内' ) + ( idx + 1 ) ).setWidth( '70px' ) );
				const en = new UICheckbox( !! sh.enable ).onChange( function () {

					arr[ idx ].enable = en.getValue();
					writeFlowerStyle( style );

				} );
				head.add( en );
				const del = new UIButton( '删' ).setMarginLeft( '4px' ).onClick( function () {

					arr.splice( idx, 1 );
					writeFlowerStyle( style );

				} );
				head.add( del );
				box.add( head );

				const rowA = new UIRow();
				rowA.add( new UIText( '距离' ).setClass( 'Label' ).setWidth( '90px' ) );
				const dist = new UINumber( sh.distance ).setRange( 0, 256 ).setWidth( '48px' ).onChange( commitSh );
				const ang = new UINumber( sh.angle ).setRange( - 180, 180 ).setWidth( '48px' ).onChange( commitSh );
				rowA.add( dist );
				rowA.add( new UIText( '角' ).setWidth( '20px' ) );
				rowA.add( ang );
				box.add( rowA );

				const rowB = new UIRow();
				rowB.add( new UIText( '模糊' ).setClass( 'Label' ).setWidth( '90px' ) );
				const dif = new UINumber( sh.diffuse ).setRange( 0, 64 ).setWidth( '48px' ).onChange( commitSh );
				const al = new UINumber( sh.alpha ).setRange( 0, 1 ).setPrecision( 2 ).setWidth( '48px' ).onChange( commitSh );
				rowB.add( dif );
				rowB.add( new UIText( '透' ).setWidth( '20px' ) );
				rowB.add( al );
				box.add( rowB );

				function commitSh() {

					const rad = ang.getValue() * Math.PI / 180;
					const d = dist.getValue();
					arr[ idx ].distance = d;
					arr[ idx ].angle = ang.getValue();
					arr[ idx ].diffuse = dif.getValue();
					arr[ idx ].alpha = al.getValue();
					arr[ idx ].offsetX = Math.cos( rad ) * d;
					arr[ idx ].offsetY = Math.sin( rad ) * d;
					writeFlowerStyle( style );

				}

				box.add( fillEditor( '', { alpha: 1, content: sh.content }, function ( fill ) {

					arr[ idx ].content = fill.content;
					// layer alpha already on sh.alpha
					writeFlowerStyle( style );

				} ) );
				flowerBlock.add( box );

			} );
			const addBtn = new UIButton( '+ ' + title ).setMarginTop( '4px' ).onClick( function () {

				arr.push( createShadowLayer() );
				writeFlowerStyle( style );

			} );
			flowerBlock.add( addBtn );

		}

		shadowList( '投影', 'shadows' );
		shadowList( '内投影', 'innerShadows' );

	}
'''

# Insert flower block before `function commitText()`
marker = "\tfunction commitText() {"
if marker not in src:
    raise SystemExit("commitText marker not found")
if "flowerBlock" not in src:
    src = src.replace(marker, FLOWER_BLOCK + "\n" + marker)

# In commitText, preserve flowerStyle (it's already on ui via spread)
# After ui.shadow = {...}; ensure flowerStyle not wiped — spread already keeps it.
# But when user edits basic outline while flowerStyle exists, we should leave flowerStyle as-is.
# OK as-is.

# In refresh Text branch, call rebuildFlowerPanel
refresh_anchor = "\t\t\tfor ( const [ key, cb ] of exposeBoxes ) {\n\n\t\t\t\tcb.setValue( isTextParamExposed( ui, key ) );\n\n\t\t\t}"
if refresh_anchor in src and "rebuildFlowerPanel()" not in src.split("function refresh")[1][:2000]:
    src = src.replace(
        refresh_anchor,
        refresh_anchor + "\n\n\t\t\trebuildFlowerPanel();",
    )
elif "rebuildFlowerPanel();" not in src:
    # try looser
    old = """\t\t\tfor ( const [ key, cb ] of exposeBoxes ) {

\t\t\t\tcb.setValue( isTextParamExposed( ui, key ) );

\t\t\t}

\t\t} else {
"""
    new = """\t\t\tfor ( const [ key, cb ] of exposeBoxes ) {

\t\t\t\tcb.setValue( isTextParamExposed( ui, key ) );

\t\t\t}

\t\t\trebuildFlowerPanel();

\t\t} else {
"""
    if old in src:
        src = src.replace(old, new)
        print("refresh hook added (loose)")
    else:
        print("WARN: could not hook rebuildFlowerPanel into refresh")
else:
    print("refresh hook likely present")

# When not text, clear flower panel
old_hide = "\t\ttextBlock.setDisplay( isUIText( object ) ? '' : 'none' );"
if old_hide in src and "if ( ! isUIText( object ) )" not in src[src.find(old_hide):src.find(old_hide)+200]:
    src = src.replace(
        old_hide,
        old_hide + """
\t\tif ( ! isUIText( object ) ) {

\t\t\twhile ( flowerBlock.dom.firstChild ) flowerBlock.dom.removeChild( flowerBlock.dom.firstChild );

\t\t}
""",
    )

path.write_bytes(src.replace("\r\n", "\n").encode("utf-8"))
print("Sidebar patched", path.stat().st_size)
text = path.read_text(encoding="utf-8")
for n in ["flowerBlock", "rebuildFlowerPanel", "FlowerStyle.js", "writeFlowerStyle", "+ 描边"]:
    print(n, "OK" if n in text else "MISSING")