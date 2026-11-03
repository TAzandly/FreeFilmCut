from pathlib import Path
import re

p = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
t = p.read_text(encoding="utf-8")

old_hdr = """ * - When OutputPass is NoToneMapping (pack/project \"none\"), insert LDR clamp
 *   before bloom/deepGlow so wipe edgeIntensity spikes do not explode bloom.
 *   Neutral/ACES keep HDR bloom. Bloom does NOT require tonemap if beauty is LDR.
 */"""
new_hdr = """ * - When OutputPass is NoToneMapping (pack/project \"none\"), insert LDR clamp
 *   before bloom/deepGlow so wipe edgeIntensity spikes do not explode bloom.
 *   Neutral/ACES keep HDR bloom. Bloom does NOT require tonemap if beauty is LDR.
 * - Clip NLE present shows accum bytes as-is (MeshBasic round-trip). Overlay UI
 *   writes working-space values with no OutputPass. For NoToneMapping, OutputPass
 *   must NOT apply sRGB transfer or strength=0 PP reads brighter than overlay.
 *   Neutral/ACES still sRGB-encode so tonemapped display codes present correctly.
 * - Bloom strength~=0 stays in the stack (no skip); color-space contract above
 *   is what keeps strength=0 matching overlay / editor none look.
 */"""
if old_hdr not in t:
    # try without escaped quotes in source file (file has real quotes)
    old_hdr = old_hdr.replace('\\"', '"')
    new_hdr = new_hdr.replace('\\"', '"')
if old_hdr not in t:
    raise SystemExit("header block not found")
t = t.replace(old_hdr, new_hdr)

m = re.search(
    r"const liveStack = mergeLiveParams\(\{ stack, exposed, liveParams \}\);\n.*?const w = Math\.max\(1, Math\.floor\(width\)\);",
    t,
    re.S,
)
if not m:
    raise SystemExit("liveStack skip block not found")
print("SKIP BLOCK REPR:", repr(m.group(0)[:180]))
t = (
    t[: m.start()]
    + "\tconst liveStack = mergeLiveParams({ stack, exposed, liveParams });\n\tconst w = Math.max(1, Math.floor(width));"
    + t[m.end() :]
)

before = t.count("if (!effectContributes(entry)) continue;")
t = t.replace("\t\tif (!effectContributes(entry)) continue;\n", "")
t = t.replace("\tif (!effectContributes(entry)) continue;\n", "")
print("effectContributes continues:", before, "->", t.count("if (!effectContributes(entry)) continue;"))

old_out = """\tconst _outputRender = outputPass.render.bind(outputPass);
\toutputPass.render = function (
\t\trendererArg: THREE.WebGLRenderer,
\t\twriteBuffer: THREE.WebGLRenderTarget,
\t\treadBuffer: THREE.WebGLRenderTarget,
\t\tdeltaTime: number,
\t\tmaskActive: boolean,
\t) {
\t\tconst prevTM = rendererArg.toneMapping;
\t\tconst prevExp = rendererArg.toneMappingExposure;
\t\trendererArg.toneMapping = outputToneMapping;
\t\trendererArg.toneMappingExposure = outputExposure;
\t\t_outputRender(rendererArg, writeBuffer, readBuffer, deltaTime, maskActive);
\t\trendererArg.toneMapping = prevTM;
\t\trendererArg.toneMappingExposure = prevExp;
\t};
"""
new_out = """\tconst _outputRender = outputPass.render.bind(outputPass);
\toutputPass.render = function (
\t\trendererArg: THREE.WebGLRenderer,
\t\twriteBuffer: THREE.WebGLRenderTarget,
\t\treadBuffer: THREE.WebGLRenderTarget,
\t\tdeltaTime: number,
\t\tmaskActive: boolean,
\t) {
\t\tconst prevTM = rendererArg.toneMapping;
\t\tconst prevExp = rendererArg.toneMappingExposure;
\t\tconst prevCS = rendererArg.outputColorSpace;
\t\trendererArg.toneMapping = outputToneMapping;
\t\trendererArg.toneMappingExposure = outputExposure;
\t\t// none: no tone-map AND no sRGB transfer — match overlay working-space bytes
\t\t// that clip present shows as-is. Neutral/ACES keep renderer.outputColorSpace
\t\t// (usually sRGB) so OutputPass still encodes after the filmic curve.
\t\tif (outputToneMapping === THREE.NoToneMapping) {
\t\t\trendererArg.outputColorSpace = THREE.NoColorSpace;
\t\t}
\t\t_outputRender(rendererArg, writeBuffer, readBuffer, deltaTime, maskActive);
\t\trendererArg.toneMapping = prevTM;
\t\trendererArg.toneMappingExposure = prevExp;
\t\trendererArg.outputColorSpace = prevCS;
\t};
"""
if old_out not in t:
    raise SystemExit("OutputPass wrap not found")
t = t.replace(old_out, new_out)

t = t.replace("\tif (!stackHasContributingEffects(normalized)) return null;\n", "")
t = t.replace("\tif (!stackHasContributingEffects(normalized)) return inputTexture;\n", "")

# Drop unused imports if no longer referenced
if "stackHasContributingEffects" not in t.split("from \"./registry\"")[0] and t.count("stackHasContributingEffects") == 1:
    pass
# Clean import list
t = t.replace("\tstackHasContributingEffects,\n", "")
t = t.replace("\teffectContributes,\n", "")

p.write_text(t, encoding="utf-8")
vt = p.read_text(encoding="utf-8")
print("composer.ts OK")
print("NoColorSpace wrap", "outputColorSpace = THREE.NoColorSpace" in vt)
print("contributing liveStack", "stackHasContributingEffects(liveStack)" in vt)
print("effectContributes left", "effectContributes" in vt)
print("stackHasContributingEffects left", "stackHasContributingEffects" in vt)
