from pathlib import Path

# --- text-anim-motion.ts: add output field ---
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\text-anim-motion.ts")
t = p.read_text(encoding="utf-8")
needle = """\tbackground?: {
\t\ttype?: \"Default\" | \"Color\" | string;
\t\tcolor?: string;
\t};
};"""
# file may use different quotes - find background block end
start = t.find("\tbackground?:")
if start < 0:
    raise SystemExit("background field missing")
end = t.find("};", start)
# end of TextAnimPackPayload type — find the closing `};` after background
# Actually structure is background?: { ... };\n};
close = t.find("\n};", start)
if close < 0:
    raise SystemExit("type close not found")
# Insert output before the type's closing };
# Find end of background property
bg_end = t.find("};", start)  # end of background?: { }
# After background's `};` there should be `\n};` for the type
type_close = t.find("\n};", bg_end)
old = t[start:type_close+3]
print("OLD TAIL:")
print(repr(old))

new = """\tbackground?: {
\t\ttype?: \"Default\" | \"Color\" | string;
\t\tcolor?: string;
\t};
\t/** Editor project tone mapping applied in OutputPass (default Neutral). */
\toutput?: {
\t\ttoneMapping?: string | number;
\t\ttoneMappingExposure?: number;
\t};
};"""

# Use exact old from file
old_exact = t[start:type_close+3]
t2 = t[:start] + new + t[type_close+3:]
# Wait, new already includes `};` — type_close+3 is `\n};` which is 3 chars from newline... 
# type_close points to `\n};` — we want to replace from background through type close inclusive
# new ends with `};` for the type. So replace [start, type_close+3) with new
# But new doesn't start with newline before background — old starts with \tbackground

p.write_text(t[:start] + new + t[type_close+3:], encoding="utf-8")
print("OK text-anim-motion output field")

# --- Exporter: collect + embed output ---
ex = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\TextAnimPackExporter.js")
et = ex.read_text(encoding="utf-8")

helper = '''
/**
 * Snapshot project OutputPass tone mapping (editor Config / renderer).
 * Default FreeFilmCut editor project uses NeutralToneMapping.
 */
function collectAuthoringOutput( editor ) {

\tconst TONE_NAMES = {
\t\t0: 'none',
\t\t1: 'linear',
\t\t2: 'reinhard',
\t\t3: 'cineon',
\t\t4: 'acesfilmic',
\t\t5: 'agx',
\t\t6: 'neutral',
\t\t7: 'neutral',
\t};
\tlet toneMapping = 'neutral';
\tlet toneMappingExposure = 1;
\ttry {

\t\tconst cfg = editor && editor.config;
\t\tif ( cfg && typeof cfg.getKey === 'function' ) {

\t\t\tconst tm = cfg.getKey( 'project/renderer/toneMapping' );
\t\t\tconst exp = cfg.getKey( 'project/renderer/toneMappingExposure' );
\t\t\tif ( tm != null && TONE_NAMES[ tm ] ) toneMapping = TONE_NAMES[ tm ];
\t\t\telse if ( typeof tm === 'string' ) toneMapping = tm;
\t\t\tif ( Number( exp ) > 0 ) toneMappingExposure = Number( exp );

\t\t}

\t} catch ( e ) { /* keep defaults */ }
\treturn { toneMapping, toneMappingExposure };

}

'''

if "collectAuthoringOutput" not in et:
    anchor = "function collectAuthoringBackground( editor ) {"
    if anchor not in et:
        raise SystemExit("collectAuthoringBackground not found for insert")
    et = et.replace(anchor, helper + anchor, 1)

old_bg = '''\tconst background = opts.background !== undefined
\t\t? opts.background
\t\t: collectAuthoringBackground( editor );

\tconst textAnimPack = {'''

new_bg = '''\tconst background = opts.background !== undefined
\t\t? opts.background
\t\t: collectAuthoringBackground( editor );
\tconst output = opts.output !== undefined
\t\t? opts.output
\t\t: collectAuthoringOutput( editor );

\tconst textAnimPack = {'''

if old_bg not in et:
    raise SystemExit("background assign block not found")
et = et.replace(old_bg, new_bg, 1)

old_embed = '''\tif ( background && background.type ) {

\t\ttextAnimPack.background = background;

\t}'''

new_embed = '''\tif ( background && background.type ) {

\t\ttextAnimPack.background = background;

\t}
\tif ( output ) {

\t\ttextAnimPack.output = output;

\t}'''

if old_embed not in et:
    raise SystemExit("background embed not found")
et = et.replace(old_embed, new_embed, 1)

old_man = "\tif ( textAnimPack.background ) manifest.background = textAnimPack.background;"
new_man = '''\tif ( textAnimPack.background ) manifest.background = textAnimPack.background;
\tif ( textAnimPack.output ) manifest.output = textAnimPack.output;'''
if old_man not in et:
    raise SystemExit("manifest background line not found")
et = et.replace(old_man, new_man, 1)

ex.write_text(et, encoding="utf-8")
print("OK exporter output snapshot")

# --- Merge output in textAnimPayloadForPack ---
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
ct = comp.read_text(encoding="utf-8")
old_merge = '''\t\t\tif (!out.background && manifestBg) {
\t\t\t\tout = { ...out, background: manifestBg };
\t\t\t}
\t\t\treturn out;'''
new_merge = '''\t\t\tif (!out.background && manifestBg) {
\t\t\t\tout = { ...out, background: manifestBg };
\t\t\t}
\t\t\tconst manifestOut = (
\t\t\t\tpack.manifest as { output?: { toneMapping?: string | number; toneMappingExposure?: number } }
\t\t\t).output;
\t\t\tif (!out.output && manifestOut) {
\t\t\t\tout = { ...out, output: manifestOut };
\t\t\t}
\t\t\treturn out;'''
if old_merge not in ct:
    raise SystemExit("payload merge background not found")
comp.write_text(ct.replace(old_merge, new_merge, 1), encoding="utf-8")
print("OK payload merge output")

# Hot-patch pack with output: neutral for immediate verify
import zipfile, json, os, tempfile, shutil
pack_path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\public\vfxpacks\text-anims\in\freecapcut.text-anim.sweep.vfxpack")
tmpdir = Path(tempfile.mkdtemp(prefix="fcc_pack_"))
with zipfile.ZipFile(pack_path, "r") as zin:
    zin.extractall(tmpdir)
for rel in ["pack/manifest.json", "pack/textanim-pack.json"]:
    fp = tmpdir / rel
    data = json.loads(fp.read_text(encoding="utf-8"))
    data["output"] = {"toneMapping": "neutral", "toneMappingExposure": 1}
    if isinstance(data.get("textAnim"), dict):
        data["textAnim"]["output"] = {"toneMapping": "neutral", "toneMappingExposure": 1}
    # keep black bg
    data["background"] = {"type": "Color", "color": "#000000"}
    if isinstance(data.get("textAnim"), dict):
        data["textAnim"]["background"] = {"type": "Color", "color": "#000000"}
    fp.write_text(json.dumps(data, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
out_tmp = pack_path.with_suffix(".vfxpack.tmp")
with zipfile.ZipFile(out_tmp, "w", compression=zipfile.ZIP_DEFLATED) as zout:
    for root, dirs, files in os.walk(tmpdir):
        for f in files:
            full = Path(root) / f
            zout.write(full, full.relative_to(tmpdir).as_posix())
shutil.move(str(out_tmp), str(pack_path))
shutil.rmtree(tmpdir, ignore_errors=True)
with zipfile.ZipFile(pack_path) as z:
    m = json.loads(z.read("pack/manifest.json"))
    print("VERIFY", m.get("background"), m.get("output"), (m.get("textAnim") or {}).get("output"))
