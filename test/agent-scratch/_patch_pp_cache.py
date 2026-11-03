from pathlib import Path

p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
t = p.read_text(encoding="utf-8")

# 1) import
old_imp = "\tbuildPackComposer,\n\tpackComposerSignature,\n\tapplyExposedMaterialParams,"
new_imp = "\tbuildPackComposer,\n\tpackComposerSignature,\n\tapplyPackComposerParams,\n\tapplyExposedMaterialParams,"
if "applyPackComposerParams" not in t.split("applyExposedMaterialParams")[0]:
    if old_imp not in t:
        raise SystemExit("import block not found")
    t = t.replace(old_imp, new_imp, 1)
    print("import OK")
else:
    print("import already")

# 2) cache-hit update after set/get builtPp
old_block = """\t\tlet builtPp = this.packComposers.get(packId) ?? null;
\t\tif (!builtPp || builtPp.signature !== nextSig) {
\t\t\tbuiltPp?.dispose();
\t\t\tbuiltPp = buildPackComposer({
\t\t\t\trenderer,
\t\t\t\tscene: built.root,
\t\t\t\tcamera: beautyCam,
\t\t\t\twidth,
\t\t\t\theight,
\t\t\t\tstack: built.postProcess,
\t\t\t\texposed: built.exposedParams ?? [],
\t\t\t\tliveParams,
\t\t\t\toutputToneMapping,
\t\t\t\toutputExposure,
\t\t\t\ttransparentClear,
\t\t\t});
\t\t\tif (builtPp) this.packComposers.set(packId, builtPp);
\t\t}
"""

new_block = """\t\tlet builtPp = this.packComposers.get(packId) ?? null;
\t\tif (!builtPp || builtPp.signature !== nextSig) {
\t\t\tbuiltPp?.dispose();
\t\t\tbuiltPp = buildPackComposer({
\t\t\t\trenderer,
\t\t\t\tscene: built.root,
\t\t\t\tcamera: beautyCam,
\t\t\t\twidth,
\t\t\t\theight,
\t\t\t\tstack: built.postProcess,
\t\t\t\texposed: built.exposedParams ?? [],
\t\t\t\tliveParams,
\t\t\t\toutputToneMapping,
\t\t\t\toutputExposure,
\t\t\t\ttransparentClear,
\t\t\t});
\t\t\tif (builtPp) this.packComposers.set(packId, builtPp);
\t\t} else {
\t\t\t// Params (bloom strength etc.) change every K-frame sample; update in place.
\t\t\tapplyPackComposerParams({
\t\t\t\tbuilt: builtPp,
\t\t\t\tstack: built.postProcess,
\t\t\t\texposed: built.exposedParams ?? [],
\t\t\t\tliveParams,
\t\t\t\tscene: built.root,
\t\t\t\tcamera: beautyCam,
\t\t\t});
\t\t}
"""

if old_block not in t:
    raise SystemExit("renderPackWithPostProcess cache block not found")
t = t.replace(old_block, new_block, 1)
p.write_text(t, encoding="utf-8")
print("three-compositor cache-hit OK")
