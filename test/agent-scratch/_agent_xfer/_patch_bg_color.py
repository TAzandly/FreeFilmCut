from pathlib import Path
import zipfile, json, os, tempfile, shutil

# --- 1) Fix TextAnimPackExporter: read scene.background, not viewportColor chrome ---
ex = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\TextAnimPackExporter.js")
et = ex.read_text(encoding="utf-8")

old_fn = '''/**
 * Snapshot editor beauty background (BeautyClear: Default transparent vs Color opaque).
 */
function collectAuthoringBackground( editor ) {

\tconst t = editor && editor.backgroundType;
\tif ( ! t || t === 'Default' || t === 'default' ) {

\t\treturn { type: 'Default' };

\t}
\tif ( t === 'Color' ) {

\t\tconst c = editor.viewportColor;
\t\tlet hex = '#000000';
\t\tif ( c && c.isColor && typeof c.getHexString === 'function' ) {

\t\t\thex = '#' + c.getHexString();

\t\t}
\t\treturn { type: 'Color', color: hex };

\t}
\t// Texture / Equirect: clip text PP uses opaque black plate (editor Color-like).
\treturn { type: 'Color', color: '#000000' };

}

'''

new_fn = '''/**
 * Snapshot editor beauty background (BeautyClear: Default transparent vs Color opaque).
 * IMPORTANT: do NOT use editor.viewportColor — that is seeded from the viewport
 * chrome clear (#aaaaaa light / #333333 dark), NOT the Scene background color.
 * Prefer scene.background when type is Color.
 */
function collectAuthoringBackground( editor ) {

\tconst t = editor && editor.backgroundType;
\tif ( ! t || t === 'Default' || t === 'default' ) {

\t\treturn { type: 'Default' };

\t}
\tif ( t === 'Color' ) {

\t\tlet hex = '#000000';
\t\tconst bg = editor.scene && editor.scene.background;
\t\tif ( bg && bg.isColor && typeof bg.getHexString === 'function' ) {

\t\t\thex = '#' + bg.getHexString();

\t\t} else if ( editor.viewportColor && editor.viewportColor.isColor
\t\t\t&& typeof editor.viewportColor.getHexString === 'function' ) {

\t\t\t// Fallback only; Viewport now syncs viewportColor from scene Color bg.
\t\t\thex = '#' + editor.viewportColor.getHexString();

\t\t}
\t\treturn { type: 'Color', color: hex };

\t}
\t// Texture / Equirect: clip text PP uses opaque black plate (editor Color-like).
\treturn { type: 'Color', color: '#000000' };

}

'''

if old_fn not in et:
    raise SystemExit("collectAuthoringBackground block not found")
ex.write_text(et.replace(old_fn, new_fn, 1), encoding="utf-8")
print("OK exporter scene.background")

# --- 2) Viewport: sync viewportColor when Color bg set (BeautyClear + export agree) ---
vp = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\Viewport.js")
vt = vp.read_text(encoding="utf-8")
old_case = '''\t\t\tcase 'Color':

\t\t\t\tscene.background = new THREE.Color( backgroundColor );

\t\t\t\tbreak;'''
new_case = '''\t\t\tcase 'Color':

\t\t\t\tscene.background = new THREE.Color( backgroundColor );
\t\t\t\t// Keep viewportColor in sync (BeautyClear + text-anim pack export).
\t\t\t\t// Do not leave it at chrome clear #aaaaaa / #333333.
\t\t\t\tif ( editor.viewportColor && editor.viewportColor.isColor ) {

\t\t\t\t\teditor.viewportColor.copy( scene.background );

\t\t\t\t}

\t\t\t\tbreak;'''
if old_case not in vt:
    raise SystemExit("Viewport Color case not found")
vp.write_text(vt.replace(old_case, new_case, 1), encoding="utf-8")
print("OK Viewport viewportColor sync")

# --- 3) Hot-fix the installed pack Duo is loading (#aaaaaa → #000000) ---
pack_path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\public\vfxpacks\text-anims\in\freecapcut.text-anim.sweep.vfxpack")
tmpdir = Path(tempfile.mkdtemp(prefix="fcc_pack_"))
with zipfile.ZipFile(pack_path, "r") as zin:
    zin.extractall(tmpdir)

for rel in ["pack/manifest.json", "pack/textanim-pack.json"]:
    fp = tmpdir / rel
    data = json.loads(fp.read_text(encoding="utf-8"))
    data["background"] = {"type": "Color", "color": "#000000"}
    if isinstance(data.get("textAnim"), dict):
        data["textAnim"]["background"] = {"type": "Color", "color": "#000000"}
    fp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    print("patched", rel, data.get("background") or data.get("textAnim", {}).get("background"))

out_tmp = pack_path.with_suffix(".vfxpack.tmp")
with zipfile.ZipFile(out_tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
    for root, dirs, files in os.walk(tmpdir):
        for f in files:
            full = Path(root) / f
            arc = full.relative_to(tmpdir).as_posix()
            zout.write(full, arc)
shutil.move(str(out_tmp), str(pack_path))
shutil.rmtree(tmpdir, ignore_errors=True)

# verify
with zipfile.ZipFile(pack_path) as z:
    m = json.loads(z.read("pack/manifest.json"))
    print("VERIFY pack background", m.get("background"), "textAnim.bg", (m.get("textAnim") or {}).get("background"))
