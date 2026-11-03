from pathlib import Path

# --- Sidebar.Object.js: guard userData stringify ---
p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.js")
text = p.read_text(encoding="utf-8")

old = """\t\ttry {

\t\t\tobjectUserData.setValue( JSON.stringify( object.userData, null, '  ' ) );

\t\t} catch ( error ) {

\t\t\tconsole.log( error );

\t\t}
"""

new = """\t\ttry {

\t\t\t// Skip ephemeral RT / mask textures (inner-shadow Face mask) — they warn in Texture.toJSON.
\t\t\tobjectUserData.setValue( JSON.stringify( object.userData, function ( key, value ) {

\t\t\t\tif ( key === '__fccFaceMaskRT' || key === '__fccFaceMaskFrameId' ) return undefined;
\t\t\t\tif ( value && typeof value === 'object' ) {

\t\t\t\t\tif ( value.isWebGLRenderTarget ) return undefined;
\t\t\t\t\tif ( value.isTexture ) {

\t\t\t\t\t\tif ( value.isRenderTargetTexture ) return undefined;
\t\t\t\t\t\tconst ud = value.userData;
\t\t\t\t\t\tif ( ud && ( ud.fccEphemeral || ud.skipSerialize ) ) return undefined;
\t\t\t\t\t\t// RT-backed textures often have no serializable image
\t\t\t\t\t\tif ( ! value.image && !( value.source && value.source.data ) ) return undefined;

\t\t\t\t\t}

\t\t\t\t}
\t\t\t\treturn value;

\t\t\t}, '  ' ) );

\t\t} catch ( error ) {

\t\t\tconsole.log( error );

\t\t}
"""

if old not in text:
    raise SystemExit("Sidebar.Object stringify block not found")
text = text.replace(old, new, 1)
text = text.replace("?v=fcc-ui-67", "?v=fcc-ui-68")
p.write_text(text, encoding="utf-8")
print("Sidebar.Object.js OK")

# --- Sidebar.Object.UI.js: strip ephemeral keys in writeFlowerStyle ---
p2 = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Sidebar.Object.UI.js")
t2 = p2.read_text(encoding="utf-8")
old2 = """\t\tif ( object.userData ) delete object.userData.__fccTextSig;
\t\tconst next = { ...object.userData, fccUI: ui };
\t\tdelete next.__fccTextSig;
"""
new2 = """\t\tif ( object.userData ) {

\t\t\tdelete object.userData.__fccTextSig;
\t\t\t// Never clone Face-mask RT onto userData (fcc-ui-68); RT lives in WeakMap.
\t\t\tdelete object.userData.__fccFaceMaskRT;
\t\t\tdelete object.userData.__fccFaceMaskFrameId;

\t\t}
\t\tconst next = { ...object.userData, fccUI: ui };
\t\tdelete next.__fccTextSig;
\t\tdelete next.__fccFaceMaskRT;
\t\tdelete next.__fccFaceMaskFrameId;
"""
if old2 not in t2:
    raise SystemExit("writeFlowerStyle block not found")
t2 = t2.replace(old2, new2, 1)
t2 = t2.replace("?v=fcc-ui-67", "?v=fcc-ui-68")
p2.write_text(t2, encoding="utf-8")
print("Sidebar.Object.UI.js OK")

# --- bump all remaining fcc-ui-67 under editor ---
root = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor")
count = 0
for f in list(root.rglob("*.js")) + list(root.rglob("*.html")):
    s = f.read_text(encoding="utf-8")
    if "fcc-ui-67" in s:
        f.write_text(s.replace("fcc-ui-67", "fcc-ui-68"), encoding="utf-8")
        count += 1
        print("bumped", f.relative_to(root))
print("files bumped:", count)
