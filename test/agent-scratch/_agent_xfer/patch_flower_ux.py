# -*- coding: utf-8 -*-
"""Refactor 花字 UX: Effect stack on Text, not a separate component."""
from pathlib import Path
import re

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut")
OLD_V = "fcc-ui-55"
NEW_V = "fcc-ui-56"

def bump(text: str) -> str:
    return text.replace(OLD_V, NEW_V)

# ---------- Sidebar.Object.UI.js ----------
sidebar = ROOT / "three.js/editor/js/Sidebar.Object.UI.js"
t = sidebar.read_text(encoding="utf-8")
t = bump(t)

# 1) After alignRow / before outline: insert 「基础」 section label if missing
if "基础 · 排版" not in t:
    old_outline = "\tconst outlineEnRow = new UIRow();\n\toutlineEnRow.add( new UIText( '描边' )"
    # Find the Chinese 描边 outline row start more carefully
    idx = t.find("outlineEnRow = new UIRow()")
    if idx < 0:
        raise SystemExit("outlineEnRow not found")
    # walk back to start of line
    line_start = t.rfind("\n", 0, idx) + 1
    insert = (
        "\tconst basicHeader = new UIRow();\n"
        "\tbasicHeader.add( new UIText( '基础 · 排版' ).setFontWeight( 'bold' ) );\n"
        "\ttextBlock.add( basicHeader );\n"
        "\t// Move typography rows visually under 基础; keep creation order:\n"
        "\t// (header inserted before outline — re-order: put header at top of textBlock)\n\n"
    )
    # Better: insert basic header right after textBlock creation / before textRow
    # Revert this approach — insert at textRow instead
    pass

# Re-read approach: surgically replace flower panel + hide legacy FX permanently

# Move: insert 基础 header before textRow
needle = "\tconst textRow = new UIRow();\n\ttextRow.add( new UIText( '文本' )"
if "基础 · 排版" not in t and needle in t:
    t = t.replace(
        needle,
        "\tconst basicHeader = new UIRow();\n"
        "\tbasicHeader.add( new UIText( '基础 · 排版' ).setFontWeight( 'bold' ) );\n"
        "\ttextBlock.add( basicHeader );\n\n"
        + needle,
        1,
    )

# Replace rebuildFlowerPanel entirely — find function start to end before commitText
start = t.find("\tfunction rebuildFlowerPanel() {")
end = t.find("\tfunction commitText() {")
if start < 0 or end < 0 or end <= start:
    raise SystemExit(f"rebuildFlowerPanel bounds bad: {start} {end}")

new_rebuild = r'''	function rebuildFlowerPanel() {

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

		const titleRow = new UIRow();
		titleRow.add( new UIText( '花字 · Effect 栈' ).setFontWeight( 'bold' ) );
		flowerBlock.add( titleRow );

		const tip = new UIDiv();
		tip.setTextContent( '多层填充 / 描边 / 投影 / 内投影（挂在当前 Text 上，不是单独物体）' );
		tip.setFontSize( '11px' );
		tip.setColor( '#aaa' );
		tip.setMarginBottom( '4px' );
		flowerBlock.add( tip );

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
			writeFlowerStyle( base );

		} );
		toolRow.add( resetBtn );
		if ( persisted ) {

			const clearBtn = new UIButton( '仅排版' ).setMarginLeft( '4px' ).onClick( function () {

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
			toolRow.add( clearBtn );

		}
		flowerBlock.add( toolRow );

		flowerBlock.add( fillEditor( '填充', style.fill, function ( fill ) {

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
				head.add( new UIText( title + ' ' + ( idx + 1 ) ).setWidth( '70px' ) );
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

t = t[:start] + new_rebuild + t[end:]

# Ensure createDefaultFlowerStyle / createSolidContent / createStrokeLayer / createShadowLayer imported
# Check imports from FlowerStyle
imp_start = t.find("} from './ui/FlowerStyle.js")
# look at import block
imp_block_start = t.find("import {\n\tcreateDefaultFlowerStyle")
if "createDefaultFlowerStyle" not in t[t.find("FlowerStyle"):t.find("FlowerStyle")+200]:
    # read current import
    m = re.search(r"import \{([^}]+)\} from '\./ui/FlowerStyle\.js[^']*';", t)
    if not m:
        raise SystemExit("FlowerStyle import not found")
    names = m.group(1)
    need = ["createDefaultFlowerStyle", "createSolidContent", "createStrokeLayer", "createShadowLayer",
            "cloneFlowerStyle", "normalizeFlowerStyle", "flowerStyleFromLegacy", "normalizeFillContent",
            "createGradientContent"]
    # The original already imports most — check createDefaultFlowerStyle
print("imports check later")

# Always hide legacy outline/shadow rows (Effect 栈 is the only FX UI)
old_hide = """\t\t\trebuildFlowerPanel();
\t\t\tconst flowerOn = !!( ui.flowerStyle && typeof ui.flowerStyle === 'object' );
\t\t\tconst legacyDisp = flowerOn ? 'none' : '';
\t\t\toutlineEnRow.setDisplay( legacyDisp );
\t\t\toutlineRow.setDisplay( legacyDisp );
\t\t\tshadowEnRow.setDisplay( legacyDisp );
\t\t\tshadowOffRow.setDisplay( legacyDisp );
\t\t\tshadowBlurRow.setDisplay( legacyDisp );"""

new_hide = """\t\t\trebuildFlowerPanel();
\t\t\t// Legacy single outline/shadow UI retired — FX live in 花字 Effect 栈 only.
\t\t\toutlineEnRow.setDisplay( 'none' );
\t\t\toutlineRow.setDisplay( 'none' );
\t\t\tshadowEnRow.setDisplay( 'none' );
\t\t\tshadowOffRow.setDisplay( 'none' );
\t\t\tshadowBlurRow.setDisplay( 'none' );"""

if old_hide not in t:
    # try with different whitespace
    if "const flowerOn" not in t:
        print("WARN: flowerOn block already changed?")
    else:
        raise SystemExit("legacy hide block not found exactly")
else:
    t = t.replace(old_hide, new_hide)

# Sync basic color into flowerStyle.fill when persisted
# Find commitText color assignment
# Look for: ui.color = colorInput.getValue();
if "ui.color = colorInput.getValue()" in t and "sync fill from basic color" not in t:
    t = t.replace(
        "ui.color = colorInput.getValue();",
        "ui.color = colorInput.getValue();\n"
        "\t\t// Keep Effect-stack fill in sync when flowerStyle already persisted\n"
        "\t\tif ( ui.flowerStyle && typeof ui.flowerStyle === 'object' ) {\n"
        "\t\t\tconst fs = cloneFlowerStyle( ui.flowerStyle );\n"
        "\t\t\tconst fillC = normalizeFillContent( fs.fill && fs.fill.content );\n"
        "\t\t\tif ( fillC.renderType === 'solid' ) {\n"
        "\t\t\t\tfs.fill = { alpha: fs.fill && fs.fill.alpha != null ? fs.fill.alpha : 1,\n"
        "\t\t\t\t\tcontent: createSolidContent( ui.color, fillC.solid.alpha ) };\n"
        "\t\t\t\tui.flowerStyle = fs;\n"
        "\t\t\t}\n"
        "\t\t}",
        1,
    )

# Update comment on flower block
t = t.replace(
    "// ---- 花字 (FlowerStyle Effect stack) ----",
    "// ---- 花字 = Text 上的多层 Effect 栈（非独立组件 / 非独立 fccUI.type）----",
)

sidebar.write_text(t, encoding="utf-8")
print("Sidebar.Object.UI.js OK, len", len(t))

# Verify imports include createDefaultFlowerStyle, createSolidContent, createStrokeLayer, createShadowLayer
t2 = sidebar.read_text(encoding="utf-8")
m = re.search(r"import \{([^}]+)\} from '\./ui/FlowerStyle\.js[^']*';", t2)
if not m:
    raise SystemExit("import gone")
block = m.group(0)
need = ["createDefaultFlowerStyle", "createSolidContent", "createStrokeLayer", "createShadowLayer",
        "cloneFlowerStyle", "flowerStyleFromLegacy", "normalizeFillContent", "createGradientContent"]
missing = [n for n in need if n not in block]
print("FlowerStyle import block:\n", block)
print("missing:", missing)
if missing:
    # expand import
    new_imp = """import {
	createDefaultFlowerStyle,
	createSolidContent,
	createGradientContent,
	createStrokeLayer,
	createShadowLayer,
	cloneFlowerStyle,
	normalizeFlowerStyle,
	flowerStyleFromLegacy,
	normalizeFillContent,
} from './ui/FlowerStyle.js?v=fcc-ui-56';"""
    t2 = re.sub(r"import \{[^}]+\} from '\./ui/FlowerStyle\.js[^']*';", new_imp, t2, count=1)
    sidebar.write_text(t2, encoding="utf-8")
    print("imports fixed")
