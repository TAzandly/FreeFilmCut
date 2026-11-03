# -*- coding: utf-8 -*-
import pathlib, re

ROOT = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut")

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, s):
    path = ROOT / rel
    path.write_text(s, encoding="utf-8")
    print("wrote", path)

# ---- Sidebar.Object.Media.js ----
rel = "three.js/editor/js/Sidebar.Object.Media.js"
s = read(rel)
s = s.replace("FccVideo.js?v=fcc-ui-200", "FccVideo.js?v=fcc-ui-201")

if "rtWrapRow" not in s:
    old = """\tcontainer.add( rtSizeRow );

\tconst kindRow = new UIRow();"""
    new = """\tcontainer.add( rtSizeRow );

\tconst rtWrapRow = new UIRow();
\trtWrapRow.add( new UIText( isZh ? '采样' : 'Wrap' ).setClass( 'Label' ) );
\tconst rtWrapSelect = new UISelect().setWidth( '140px' ).setOptions( {
\t\tclamp: 'Clamp',
\t\trepeat: 'Repeat',
\t\tmirroredRepeat: 'Mirrored Repeat',
\t} ).onChange( onWrapChange );
\trtWrapRow.add( rtWrapSelect );
\tcontainer.add( rtWrapRow );

\tconst kindRow = new UIRow();"""
    if old not in s:
        raise SystemExit("rtSizeRow anchor missing")
    s = s.replace(old, new, 1)

    old = """\trtWidth.onChange( onSizeChange );
\trtHeight.onChange( onSizeChange );

\tfunction onKindChange()"""
    new = """\trtWidth.onChange( onSizeChange );
\trtHeight.onChange( onSizeChange );

\tfunction onWrapChange() {

\t\tif ( ! isFccRenderTexture( object ) ) return;
\t\tconst spec = object.userData[ RT_KEY ];
\t\tspec.wrapMode = rtWrapSelect.getValue() || 'clamp';
\t\tensureRenderTarget( object );
\t\tsignals.objectChanged.dispatch( object );
\t\tsignals.sceneGraphChanged.dispatch();

\t}

\tfunction onKindChange()"""
    if old not in s:
        raise SystemExit("onSizeChange anchor missing")
    s = s.replace(old, new, 1)

    old = """\t\trtSizeRow.setDisplay( showRT ? '' : 'none' );
\t\tkindRow.setDisplay( showVP ? '' : 'none' );"""
    new = """\t\trtSizeRow.setDisplay( showRT ? '' : 'none' );
\t\trtWrapRow.setDisplay( showRT ? '' : 'none' );
\t\tkindRow.setDisplay( showVP ? '' : 'none' );"""
    if old not in s:
        raise SystemExit("rtSizeRow display missing")
    s = s.replace(old, new, 1)

    old = """\t\t\tconst spec = object.userData[ RT_KEY ];
\t\t\trtWidth.setValue( spec.width || 512 );
\t\t\trtHeight.setValue( spec.height || 512 );
\t\t\tensureRenderTarget( object );"""
    new = """\t\t\tconst spec = object.userData[ RT_KEY ];
\t\t\trtWidth.setValue( spec.width || 512 );
\t\t\trtHeight.setValue( spec.height || 512 );
\t\t\tif ( ! spec.wrapMode ) spec.wrapMode = 'clamp';
\t\t\trtWrapSelect.setValue( spec.wrapMode );
\t\t\tensureRenderTarget( object );"""
    if old not in s:
        raise SystemExit("refresh RT block missing")
    s = s.replace(old, new, 1)

write(rel, s)
print("Sidebar ok")

# ---- UIText.js: stop forcing Repeat on live RT ----
rel = "three.js/editor/js/ui/UIText.js"
s = read(rel)
old = """\tif ( isFlowerRtPath( path ) ) {
\t\tconst live = resolveFlowerRtTexture( path );
\t\tif ( live ) {
\t\t\t// Match file-texture wrap so atlas UVs near strip edges behave the same.
\t\t\tlive.wrapS = THREE.RepeatWrapping;
\t\t\tlive.wrapT = THREE.RepeatWrapping;
\t\t}
\t\tonReady( live || null );
\t\treturn;
\t}"""
new = """\tif ( isFlowerRtPath( path ) ) {
\t\tconst live = resolveFlowerRtTexture( path );
\t\t// RT wrap comes from RenderTexture.wrapMode (ensureRenderTarget); do not overwrite.
\t\tonReady( live || null );
\t\treturn;
\t}"""
if old not in s:
    raise SystemExit("UIText live RT wrap block missing")
s = s.replace(old, new, 1)
s = s.replace("FccVideo.js?v=fcc-ui-200", "FccVideo.js?v=fcc-ui-201")
s = s.replace("FlowerStyle.js?v=fcc-ui-200", "FlowerStyle.js?v=fcc-ui-201")
s = s.replace(
    "sdfMargin: 0.25, // fcc-ui-200 RT+range atlas mod clamp (mod(n,n)->0)",
    "sdfMargin: 0.25, // fcc-ui-201 RT wrapMode selectable",
)
write(rel, s)
print("UIText ok")
