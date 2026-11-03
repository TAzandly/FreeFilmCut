from pathlib import Path

# 1) text-anim-motion.ts
p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\text-anim-motion.ts")
t = p.read_text(encoding="utf-8")
start = t.find("\t/** Camera PP snapshot from editor")
end = t.find("export type TextMotionPose")
if start < 0 or end < 0:
    raise SystemExit("payload markers missing")
new_fields = """\t/** Camera PP snapshot from editor (Bloom/DeepGlow/…). Never flowerStyle. */
\tpostProcess?: {
\t\tenabled?: boolean;
\t\teffects?: Array<{
\t\t\tid?: string;
\t\t\ttype: string;
\t\t\tenabled?: boolean;
\t\t\tparams?: Record<string, number | boolean | string>;
\t\t\texposed?: Record<string, boolean>;
\t\t}>;
\t};
\t/**
\t * Editor scene beauty background snapshot (BeautyClear contract).
\t * Default → transparent clear (lower clips show).
\t * Color → opaque clear + scene.background so bloom matches editor.
\t */
\tbackground?: {
\t\ttype?: "Default" | "Color" | string;
\t\tcolor?: string;
\t};
};

"""
t = t[:start] + new_fields + t[end:]
p.write_text(t, encoding="utf-8")
print("OK text-anim-motion.ts")

# 2) TextAnimPackExporter.js — collect + embed background
ex = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\TextAnimPackExporter.js")
et = ex.read_text(encoding="utf-8")

helper = '''
/**
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

if "collectAuthoringBackground" not in et:
    anchor = "function collectAuthoringPostProcess( editor ) {"
    if anchor not in et:
        raise SystemExit("collectAuthoringPostProcess not found")
    et = et.replace(anchor, helper + anchor, 1)

old_build = '''\tconst postProcess = opts.postProcess !== undefined
\t\t? opts.postProcess
\t\t: collectAuthoringPostProcess( editor );

\tconst textAnimPack = {
\t\tformat: 'freecapcut.textanim-pack/1',
\t\tname: displayName,
\t\tcategory,
\t\tduration,
\t\tcomponents,
\t\ttracks,
\t};
\tif ( postProcess && postProcess.effects && postProcess.effects.length ) {

\t\ttextAnimPack.postProcess = postProcess;

\t}'''

new_build = '''\tconst postProcess = opts.postProcess !== undefined
\t\t? opts.postProcess
\t\t: collectAuthoringPostProcess( editor );
\tconst background = opts.background !== undefined
\t\t? opts.background
\t\t: collectAuthoringBackground( editor );

\tconst textAnimPack = {
\t\tformat: 'freecapcut.textanim-pack/1',
\t\tname: displayName,
\t\tcategory,
\t\tduration,
\t\tcomponents,
\t\ttracks,
\t};
\tif ( postProcess && postProcess.effects && postProcess.effects.length ) {

\t\ttextAnimPack.postProcess = postProcess;

\t}
\tif ( background && background.type ) {

\t\ttextAnimPack.background = background;

\t}'''

if old_build not in et:
    raise SystemExit("buildTextAnimPack postProcess block not found")
et = et.replace(old_build, new_build, 1)

# also put on manifest for loaders that only read manifest
old_man = "\tif ( textAnimPack.postProcess ) manifest.postProcess = textAnimPack.postProcess;"
new_man = '''\tif ( textAnimPack.postProcess ) manifest.postProcess = textAnimPack.postProcess;
\tif ( textAnimPack.background ) manifest.background = textAnimPack.background;'''
if old_man not in et:
    raise SystemExit("manifest postProcess line not found")
et = et.replace(old_man, new_man, 1)

old_install = "'Includes postProcess (camera Bloom/DeepGlow snapshot); no flowerStyle.',"
new_install = "'Includes postProcess + background (BeautyClear); no flowerStyle.',"
if old_install in et:
    et = et.replace(old_install, new_install, 1)

ex.write_text(et, encoding="utf-8")
print("OK TextAnimPackExporter.js")
