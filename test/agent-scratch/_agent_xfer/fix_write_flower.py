from pathlib import Path
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
t = p.read_text(encoding="utf-8")

# Insert helper after imports / near top of SidebarObjectUI if not present
if "function stripEphemeralUserData" not in t:
    anchor = "export function SidebarObjectUI( editor ) {"
    idx = t.find(anchor)
    if idx < 0:
        raise SystemExit("SidebarObjectUI not found")
    # find end of function opening brace line and insert after strings/signals setup is fragile;
    # instead insert helper just before writeFlowerStyle
    pass

old = """\tfunction writeFlowerStyle( style, opts ) {

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
"""

new = """\tfunction stripEphemeralUserDataKeys( ud ) {

\t\t// Face-mask WebGLRenderTarget must never ride SetValueCommand clones (fcc-ui-68).
\t\tif ( ! ud ) return;
\t\tdelete ud.__fccTextSig;
\t\tdelete ud.__fccFaceMaskRT;
\t\tdelete ud.__fccFaceMaskFrameId;

\t}

\tfunction writeFlowerStyle( style, opts ) {

\t\tconst object = editor.selected;
\t\tif ( ! isUIText( object ) ) return;
\t\tconst rebuild = !!( opts && opts.rebuild );
\t\tconst ui = { ...getFccUI( object ) };
\t\tui.flowerStyle = cloneFlowerStyle( style );
\t\t// Keep basic color in sync with fill solid/gradient primary
\t\tconst fillC = normalizeFillContent( ui.flowerStyle.fill && ui.flowerStyle.fill.content );
\t\tif ( fillC.renderType === 'gradient' ) ui.color = fillC.gradient.colors[ 0 ];
\t\telse ui.color = fillC.solid.color;
\t\tif ( object.userData ) stripEphemeralUserDataKeys( object.userData );
\t\tconst next = { ...object.userData, fccUI: ui };
\t\tstripEphemeralUserDataKeys( next );
\t\t// Skip panel rebuild during objectChanged from this command so color pickers stay open.
\t\tskipFlowerRebuild = true;
"""

if old not in t:
    raise SystemExit("writeFlowerStyle exact block not found")
t = t.replace(old, new, 1)
p.write_text(t, encoding="utf-8")
print("writeFlowerStyle patched")
