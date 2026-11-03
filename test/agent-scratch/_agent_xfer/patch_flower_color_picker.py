# -*- coding: utf-8 -*-
"""Fix: gradient color picker closes because writeFlowerStyle rebuilds the whole flower panel."""
from pathlib import Path

UI = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
OBJ = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.js")
PROP = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Properties.js")
SIDE = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.js")
IDX = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\index.html")

text = UI.read_text(encoding="utf-8")
orig = text

# 1) Insert skip flag after flowerBlock.add to textBlock
needle = "\ttextBlock.add( flowerBlock );\n\n\tfunction ensureFlowerStyle"
if needle not in text:
    raise SystemExit("anchor flowerBlock missing")
text = text.replace(
    needle,
    "\ttextBlock.add( flowerBlock );\n\n"
    "\t// When true, refresh() skips rebuildFlowerPanel so native <input type=color>\n"
    "\t// stays open while dragging/picking (SetValueCommand -> objectChanged -> refresh).\n"
    "\tlet skipFlowerRebuild = false;\n\n"
    "\tfunction ensureFlowerStyle",
    1,
)

# 2) Replace writeFlowerStyle body: no auto-rebuild; support opts.rebuild
old_write = """\tfunction writeFlowerStyle( style ) {

\t\tconst object = editor.selected;
\t\tif ( ! isUIText( object ) ) return;
\t\tconst ui = { ...getFccUI( object ) };
\t\tui.flowerStyle = cloneFlowerStyle( style );
\t\t// Keep basic color in sync with fill solid/gradient primary
\t\tconst fillC = normalizeFillContent( ui.flowerStyle.fill && ui.flowerStyle.fill.content );
\t\tif ( fillC.renderType === 'gradient' ) ui.color = fillC.gradient.colors[ 0 ];
\t\telse ui.color = fillC.solid.color;
\t\tif ( object.userData ) delete object.userData.__fccTextSig;
\t\tconst next = { ...object.userData, fccUI: ui };
\t\tdelete next.__fccTextSig;
\t\teditor.execute( new SetValueCommand( editor, object, 'userData', next ) );
\t\tsyncSelectedText();
\t\tsignals.sceneGraphChanged.dispatch();
\t\trebuildFlowerPanel();

\t}"""

new_write = """\tfunction writeFlowerStyle( style, opts ) {

\t\tconst object = editor.selected;
\t\tif ( ! isUIText( object ) ) return;
\t\tconst rebuild = !!( opts && opts.rebuild );
\t\tconst ui = { ...getFccUI( object ) };
\t\tui.flowerStyle = cloneFlowerStyle( style );
\t\t// Keep basic color in sync with fill solid/gradient primary
\t\tconst fillC = normalizeFillContent( ui.flowerStyle.fill && ui.flowerStyle.fill.content );
\t\tif ( fillC.renderType === 'gradient' ) ui.color = fillC.gradient.colors[ 0 ];
\t\telse ui.color = fillC.solid.color;
\t\tif ( object.userData ) delete object.userData.__fccTextSig;
\t\tconst next = { ...object.userData, fccUI: ui };
\t\tdelete next.__fccTextSig;
\t\t// Skip panel rebuild during objectChanged from this command so color pickers stay open.
\t\tskipFlowerRebuild = true;
\t\ttry {

\t\t\teditor.execute( new SetValueCommand( editor, object, 'userData', next ) );
\t\t\tsyncSelectedText();
\t\t\tsignals.sceneGraphChanged.dispatch();

\t\t} finally {

\t\t\tskipFlowerRebuild = false;

\t\t}
\t\t// Only rebuild DOM for structural edits (add/remove layer, fill mode switch).
\t\tif ( rebuild ) rebuildFlowerPanel();

\t}"""

if old_write not in text:
    raise SystemExit("writeFlowerStyle block not found exactly")
text = text.replace(old_write, new_write, 1)

# 3) fillEditor: pass rebuild option through setContent / onFill
old_fill_start = """\tfunction fillEditor( label, fillObj, onFill ) {

\t\tconst wrap = new UIDiv();
\t\twrap.add( new UIText( label ).setFontWeight( 'bold' ).setMarginTop( '4px' ) );
\t\tconst content = ( fillObj && fillObj.content ) || createSolidContent( '#ffffff', 1 );
\t\tconst alphaRow = new UIRow();"""

# Find alpha onChange and setContent - need more precise edits
# Change alphaNum.onChange to not rebuild (default)
# Change setContent to accept opts
# Change type select to pass { rebuild: true }

old_set_content = """\t\tfunction setContent( nextContent ) {

\t\t\tonFill( {
\t\t\t\talpha: alphaNum.getValue(),
\t\t\t\tcontent: nextContent,
\t\t\t} );

\t\t}

\t\twrap.add( contentTypeSelect( content, function ( type ) {

\t\t\tconst cur = normalizeFillContent( content );
\t\t\tconst keepColor = contentPrimaryOrSolid( cur ) || '#ffffff';
\t\t\tif ( type === 'gradient' ) {

\t\t\t\tconst gColors = ( cur.gradient && cur.gradient.colors && cur.gradient.colors.length >= 2 )
\t\t\t\t\t? [ cur.gradient.colors[ 0 ], cur.gradient.colors[ 1 ] ]
\t\t\t\t\t: [ keepColor, '#afafaf' ];
\t\t\t\t// Seed from solid when switching solid->gradient so face never goes empty
\t\t\t\tif ( cur.renderType === 'solid' ) {

\t\t\t\t\tgColors[ 0 ] = keepColor;

\t\t\t\t}
\t\t\t\tsetContent( createGradientContent( {
\t\t\t\t\tcolors: gColors,
\t\t\t\t\talphas: [ 1, 1 ],
\t\t\t\t\tstops: [ 0, 1 ],
\t\t\t\t\tangle: ( cur.gradient && cur.gradient.angle != null ) ? cur.gradient.angle : 90,
\t\t\t\t} ) );

\t\t\t} else if ( type === 'texture' ) {

\t\t\t\t// P2 stub: keep previous solid color until a texture is picked
\t\t\t\tsetContent( {
\t\t\t\t\t...createSolidContent( keepColor, 1 ),
\t\t\t\t\trenderType: 'texture',
\t\t\t\t} );

\t\t\t} else {

\t\t\t\tsetContent( createSolidContent( keepColor, 1 ) );

\t\t\t}

\t\t} ) );"""

new_set_content = """\t\tfunction setContent( nextContent, opts ) {

\t\t\tonFill( {
\t\t\t\talpha: alphaNum.getValue(),
\t\t\t\tcontent: nextContent,
\t\t\t}, opts );

\t\t}

\t\twrap.add( contentTypeSelect( content, function ( type ) {

\t\t\tconst cur = normalizeFillContent( content );
\t\t\tconst keepColor = contentPrimaryOrSolid( cur ) || '#ffffff';
\t\t\tconst structureOpts = { rebuild: true };
\t\t\tif ( type === 'gradient' ) {

\t\t\t\tconst gColors = ( cur.gradient && cur.gradient.colors && cur.gradient.colors.length >= 2 )
\t\t\t\t\t? [ cur.gradient.colors[ 0 ], cur.gradient.colors[ 1 ] ]
\t\t\t\t\t: [ keepColor, '#afafaf' ];
\t\t\t\t// Seed from solid when switching solid->gradient so face never goes empty
\t\t\t\tif ( cur.renderType === 'solid' ) {

\t\t\t\t\tgColors[ 0 ] = keepColor;

\t\t\t\t}
\t\t\t\tsetContent( createGradientContent( {
\t\t\t\t\tcolors: gColors,
\t\t\t\t\talphas: [ 1, 1 ],
\t\t\t\t\tstops: [ 0, 1 ],
\t\t\t\t\tangle: ( cur.gradient && cur.gradient.angle != null ) ? cur.gradient.angle : 90,
\t\t\t\t} ), structureOpts );

\t\t\t} else if ( type === 'texture' ) {

\t\t\t\t// P2 stub: keep previous solid color until a texture is picked
\t\t\t\tsetContent( {
\t\t\t\t\t...createSolidContent( keepColor, 1 ),
\t\t\t\t\trenderType: 'texture',
\t\t\t\t}, structureOpts );

\t\t\t} else {

\t\t\t\tsetContent( createSolidContent( keepColor, 1 ), structureOpts );

\t\t\t}

\t\t} ) );"""

if old_set_content not in text:
    raise SystemExit("setContent block not found")
text = text.replace(old_set_content, new_set_content, 1)

# 4) Update fillEditor callbacks to forward opts to writeFlowerStyle
# Main fill:
old_fill_cb = """\t\tflowerBlock.add( fillEditor( '填充', style.fill, function ( fill ) {

\t\t\tstyle.fill = fill;
\t\t\twriteFlowerStyle( style );

\t\t} ) );"""
# Need to find exact Chinese - use a more flexible approach
import re

def replace_fill_callbacks(src):
    # Pattern for fillEditor callbacks that call writeFlowerStyle( style )
    # Three variants: style.fill, style.strokes[idx], arr[idx]
    patterns = [
        (
            r"flowerBlock\.add\( fillEditor\( '填充', style\.fills, function \( fill \) \{\s*"
            r"style\.fill = fill;\s*"
            r"writeFlowerStyle\( style \);\s*"
            r"\} \) \);",
            "flowerBlock.add( fillEditor( '填充', style.fill, function ( fill, opts ) {\n\n"
            "\t\t\tstyle.fill = fill;\n"
            "\t\t\twriteFlowerStyle( style, opts );\n\n"
            "\t\t} ) );",
        ),
    ]
    # Simpler: replace all "function ( fill ) {\n\n\t\t\tstyle.fill = fill;\n\t\t\twriteFlowerStyle( style );"
    src2 = src
    a = "function ( fill ) {\n\n\t\t\tstyle.fill = fill;\n\t\t\twriteFlowerStyle( style );\n\n\t\t}"
    b = "function ( fill, opts ) {\n\n\t\t\tstyle.fill = fill;\n\t\t\twriteFlowerStyle( style, opts );\n\n\t\t}"
    if a not in src2:
        raise SystemExit("fill callback A not found: " + repr(src2[src2.find("fillEditor"):src2.find("fillEditor")+200]))
    src2 = src2.replace(a, b, 1)

    a2 = ("function ( fill ) {\n\n"
          "\t\t\t\tstyle.strokes[ idx ].alpha = fill.alpha;\n"
          "\t\t\t\tstyle.strokes[ idx ].content = fill.content;\n"
          "\t\t\t\twriteFlowerStyle( style );\n\n"
          "\t\t\t}")
    b2 = ("function ( fill, opts ) {\n\n"
          "\t\t\t\tstyle.strokes[ idx ].alpha = fill.alpha;\n"
          "\t\t\t\tstyle.strokes[ idx ].content = fill.content;\n"
          "\t\t\t\twriteFlowerStyle( style, opts );\n\n"
          "\t\t\t}")
    if a2 not in src2:
        raise SystemExit("stroke fill callback not found")
    src2 = src2.replace(a2, b2, 1)

    a3 = ("function ( fill ) {\n\n"
          "\t\t\t\t\tarr[ idx ].content = fill.content;\n"
          "\t\t\t\t\twriteFlowerStyle( style );\n\n"
          "\t\t\t\t}")
    b3 = ("function ( fill, opts ) {\n\n"
          "\t\t\t\t\tarr[ idx ].content = fill.content;\n"
          "\t\t\t\t\twriteFlowerStyle( style, opts );\n\n"
          "\t\t\t\t}")
    if a3 not in src2:
        raise SystemExit("shadow fill callback not found")
    src2 = src2.replace(a3, b3, 1)
    return src2

text = replace_fill_callbacks(text)

# 5) Structural ops: writeFlowerStyle( style ) -> writeFlowerStyle( style, { rebuild: true } )
# for: reset, clear (clear has its own rebuild), add stroke, del stroke, add shadow, del shadow
# Also enable checkbox / width - those don't need rebuild for color UX, leave without rebuild.
# But add/delete need rebuild.

structural_markers = []

# resetBtn: writeFlowerStyle( base );
if "writeFlowerStyle( base );" not in text:
    raise SystemExit("reset writeFlowerStyle(base) missing")
text = text.replace("writeFlowerStyle( base );", "writeFlowerStyle( base, { rebuild: true } );", 1)

# add stroke
old_add_stroke = """\t\tconst addStroke = new UIButton( '+ 描边' ).setMarginTop( '4px' ).onClick( function () {

\t\t\tstyle.strokes.push( createStrokeLayer() );
\t\t\twriteFlowerStyle( style );

\t\t} );"""
new_add_stroke = """\t\tconst addStroke = new UIButton( '+ 描边' ).setMarginTop( '4px' ).onClick( function () {

\t\t\tstyle.strokes.push( createStrokeLayer() );
\t\t\twriteFlowerStyle( style, { rebuild: true } );

\t\t} );"""
if old_add_stroke not in text:
    # try find without exact chinese
    idx = text.find("style.strokes.push( createStrokeLayer() );")
    if idx < 0:
        raise SystemExit("add stroke not found")
    # replace nearby writeFlowerStyle( style );
    chunk = text[idx:idx+120]
    if "writeFlowerStyle( style );" not in chunk:
        raise SystemExit("add stroke write not found near push: " + repr(chunk))
    text = text[:idx] + chunk.replace("writeFlowerStyle( style );", "writeFlowerStyle( style, { rebuild: true } );", 1) + text[idx+120:]
else:
    text = text.replace(old_add_stroke, new_add_stroke, 1)

# delete stroke: style.strokes.splice
idx = text.find("style.strokes.splice( idx, 1 );")
if idx < 0:
    raise SystemExit("stroke splice not found")
chunk = text[idx:idx+100]
if "writeFlowerStyle( style );" not in chunk:
    raise SystemExit("stroke splice write missing")
text = text[:idx] + chunk.replace("writeFlowerStyle( style );", "writeFlowerStyle( style, { rebuild: true } );", 1) + text[idx+100:]

# shadow delete: arr.splice
idx = text.find("arr.splice( idx, 1 );")
if idx < 0:
    raise SystemExit("shadow splice not found")
chunk = text[idx:idx+100]
if "writeFlowerStyle( style );" not in chunk:
    raise SystemExit("shadow splice write missing")
text = text[:idx] + chunk.replace("writeFlowerStyle( style );", "writeFlowerStyle( style, { rebuild: true } );", 1) + text[idx+100:]

# add shadow: arr.push( createShadowLayer() );
idx = text.find("arr.push( createShadowLayer() );")
if idx < 0:
    raise SystemExit("shadow push not found")
chunk = text[idx:idx+100]
if "writeFlowerStyle( style );" not in chunk:
    raise SystemExit("shadow push write missing")
text = text[:idx] + chunk.replace("writeFlowerStyle( style );", "writeFlowerStyle( style, { rebuild: true } );", 1) + text[idx+100:]

# clearBtn already calls rebuildFlowerPanel after write - update to use skip-safe path
# It manually executes SetValueCommand without going through writeFlowerStyle - and then rebuildFlowerPanel.
# That path also needs skip during execute to avoid double-rebuild flicker, but rebuild is intentional.
# Fix clear to set skipFlowerRebuild during execute:
old_clear = """\t\t\t\tui.flowerStyle = null;
\t\t\t\tif ( object.userData ) delete object.userData.__fccTextSig;
\t\t\t\tconst next = { ...object.userData, fccUI: ui };
\t\t\t\tdelete next.__fccTextSig;
\t\t\t\teditor.execute( new SetValueCommand( editor, object, 'userData', next ) );
\t\t\t\tsyncSelectedText();
\t\t\t\tsignals.sceneGraphChanged.dispatch();
\t\t\t\trebuildFlowerPanel();"""

new_clear = """\t\t\t\tui.flowerStyle = null;
\t\t\t\tif ( object.userData ) delete object.userData.__fccTextSig;
\t\t\t\tconst next = { ...object.userData, fccUI: ui };
\t\t\t\tdelete next.__fccTextSig;
\t\t\t\tskipFlowerRebuild = true;
\t\t\t\ttry {

\t\t\t\t\teditor.execute( new SetValueCommand( editor, object, 'userData', next ) );
\t\t\t\t\tsyncSelectedText();
\t\t\t\t\tsignals.sceneGraphChanged.dispatch();

\t\t\t\t} finally {

\t\t\t\t\tskipFlowerRebuild = false;

\t\t\t\t}
\t\t\t\trebuildFlowerPanel();"""

if old_clear not in text:
    raise SystemExit("clearBtn block not found")
text = text.replace(old_clear, new_clear, 1)

# 6) refresh(): only rebuildFlowerPanel when not skipping
old_refresh_rebuild = """\t\t\trebuildFlowerPanel();
\t\t\t// Legacy single outline/shadow UI retired"""
new_refresh_rebuild = """\t\t\tif ( ! skipFlowerRebuild ) rebuildFlowerPanel();
\t\t\t// Legacy single outline/shadow UI retired"""
if old_refresh_rebuild not in text:
    raise SystemExit("refresh rebuildFlowerPanel not found")
text = text.replace(old_refresh_rebuild, new_refresh_rebuild, 1)

# Bump imports inside this file to fcc-ui-61
text = text.replace("?v=fcc-ui-59", "?v=fcc-ui-61")
text = text.replace("?v=fcc-ui-60", "?v=fcc-ui-61")

if text == orig:
    raise SystemExit("no changes applied")

# Backup
bak = UI.with_suffix(".js.bak-fcc-ui-61")
bak.write_text(orig, encoding="utf-8")
UI.write_text(text, encoding="utf-8")
print("patched", UI)
print("backup", bak)

# Bump import chain
def bump(path, pairs):
    t = path.read_text(encoding="utf-8")
    o = t
    for a, b in pairs:
        t = t.replace(a, b)
    if t != o:
        path.write_text(t, encoding="utf-8")
        print("bumped", path)
    else:
        print("no bump needed", path)

bump(OBJ, [
    ("Sidebar.Object.UI.js?v=fcc-ui-59", "Sidebar.Object.UI.js?v=fcc-ui-61"),
    ("Sidebar.Object.UI.js?v=fcc-ui-60", "Sidebar.Object.UI.js?v=fcc-ui-61"),
])
bump(PROP, [
    ("Sidebar.Object.js?v=fcc-ui-60", "Sidebar.Object.js?v=fcc-ui-61"),
    ("Sidebar.Object.js?v=fcc-ui-59", "Sidebar.Object.js?v=fcc-ui-61"),
])
bump(SIDE, [
    ("Sidebar.Properties.js?v=fcc-ui-60", "Sidebar.Properties.js?v=fcc-ui-61"),
])
bump(IDX, [
    ("Sidebar.js?v=fcc-ui-60", "Sidebar.js?v=fcc-ui-61"),
])

# Verify key bits
v = UI.read_text(encoding="utf-8")
checks = [
    "let skipFlowerRebuild = false",
    "function writeFlowerStyle( style, opts )",
    "skipFlowerRebuild = true",
    "if ( rebuild ) rebuildFlowerPanel()",
    "if ( ! skipFlowerRebuild ) rebuildFlowerPanel()",
    "writeFlowerStyle( style, opts )",
    "writeFlowerStyle( style, { rebuild: true } )",
    "structureOpts = { rebuild: true }",
]
for c in checks:
    print(("OK" if c in v else "MISSING"), c)
print("writeFlowerStyle( style ); count (should be few, for enable/width/commitSh):", v.count("writeFlowerStyle( style );"))
