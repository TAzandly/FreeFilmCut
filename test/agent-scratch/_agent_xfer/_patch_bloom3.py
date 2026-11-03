from pathlib import Path

path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = path.read_text(encoding="utf-8")

# --- A) renderPackWithPostProcess signature + body ---
old_sig = '''\tprivate renderPackWithPostProcess({
\t\tpackId,
\t\tbuilt,
\t\twidth,
\t\theight,
\t\ttarget,
\t\tliveParams,
\t\tclearFirst,
\t\tkeepDepthClear = false,
\t\ttransitionInputs = null,
\t\tallowMsaa = true,
\t\tcameraOverride = null,
\t\ttransparentClear = false,
\t}: {
\t\tpackId: string;
\t\tbuilt: BuiltPackScene;
\t\twidth: number;
\t\theight: number;
\t\ttarget: THREE.WebGLRenderTarget | null;
\t\tliveParams?: ParamValues | null;
\t\tclearFirst: boolean;
\t\tkeepDepthClear?: boolean;
\t\ttransitionInputs?: {
\t\t\ttexFrom: THREE.Texture;
\t\t\ttexTo: THREE.Texture;
\t\t} | null;
\t\tallowMsaa?: boolean;
\t\t/** When set (timeline text pack-PP), use this beauty cam instead of built.camera. */
\t\tcameraOverride?: THREE.Camera | null;
\t\t/** Default/transparent beauty: clear alpha 0 so empty pixels stay see-through (editor BeautyClear). */
\t\ttransparentClear?: boolean;
\t}) {'''

new_sig = '''\tprivate renderPackWithPostProcess({
\t\tpackId,
\t\tbuilt,
\t\twidth,
\t\theight,
\t\ttarget,
\t\tliveParams,
\t\tclearFirst,
\t\tkeepDepthClear = false,
\t\ttransitionInputs = null,
\t\tallowMsaa = true,
\t\tcameraOverride = null,
\t\ttransparentClear = false,
\t\tbeautyClearColor = null,
\t\toutputToneMapping,
\t\toutputExposure,
\t}: {
\t\tpackId: string;
\t\tbuilt: BuiltPackScene;
\t\twidth: number;
\t\theight: number;
\t\ttarget: THREE.WebGLRenderTarget | null;
\t\tliveParams?: ParamValues | null;
\t\tclearFirst: boolean;
\t\tkeepDepthClear?: boolean;
\t\ttransitionInputs?: {
\t\t\ttexFrom: THREE.Texture;
\t\t\ttexTo: THREE.Texture;
\t\t} | null;
\t\tallowMsaa?: boolean;
\t\t/** When set (timeline text pack-PP), use this beauty cam instead of built.camera. */
\t\tcameraOverride?: THREE.Camera | null;
\t\t/** Default/transparent beauty: clear alpha 0 so empty pixels stay see-through (editor BeautyClear). */
\t\ttransparentClear?: boolean;
\t\t/** Color background plate (editor Color bg). Ignored when transparentClear. */
\t\tbeautyClearColor?: THREE.Color | null;
\t\t/** OutputPass tone mapping override (UI text: NoToneMapping = sRGB only). */
\t\toutputToneMapping?: THREE.ToneMapping;
\t\toutputExposure?: number;
\t}) {'''

if old_sig not in text:
    raise SystemExit("renderPackWithPostProcess sig not found")
text = text.replace(old_sig, new_sig, 1)

old_build = '''\t\tconst builtPp = buildPackComposer({
\t\t\trenderer,
\t\t\tscene: built.root,
\t\t\tcamera: beautyCam,
\t\t\twidth,
\t\t\theight,
\t\t\tstack: built.postProcess,
\t\t\texposed: built.exposedParams ?? [],
\t\t\tliveParams,
\t\t});'''

new_build = '''\t\tconst builtPp = buildPackComposer({
\t\t\trenderer,
\t\t\tscene: built.root,
\t\t\tcamera: beautyCam,
\t\t\twidth,
\t\t\theight,
\t\t\tstack: built.postProcess,
\t\t\texposed: built.exposedParams ?? [],
\t\t\tliveParams,
\t\t\toutputToneMapping,
\t\t\toutputExposure,
\t\t});'''

if old_build not in text:
    raise SystemExit("buildPackComposer call not found")
text = text.replace(old_build, new_build, 1)

old_clear = '''\t\tconst sceneRoot = built.root as THREE.Scene;
\t\tconst prevBg =
\t\t\tsceneRoot && "background" in sceneRoot ? sceneRoot.background : undefined;
\t\tif (transparentClear && sceneRoot && "background" in sceneRoot) {
\t\t\tsceneRoot.background = null;
\t\t}
\t\trenderer.getClearColor(this.clearScratch);
\t\tconst prevClearAlpha = renderer.getClearAlpha();
\t\tif (transparentClear) {
\t\t\t// Match editor applyBeautyClear(Default): opaque black must not cover lower clips.
\t\t\trenderer.setClearColor(0x000000, 0);
\t\t}'''

new_clear = '''\t\tconst sceneRoot = built.root as THREE.Scene;
\t\tconst prevBg =
\t\t\tsceneRoot && "background" in sceneRoot ? sceneRoot.background : undefined;
\t\trenderer.getClearColor(this.clearScratch);
\t\tconst prevClearAlpha = renderer.getClearAlpha();
\t\tif (transparentClear) {
\t\t\t// Match editor applyBeautyClear(Default): see-through empty pixels.
\t\t\tif (sceneRoot && "background" in sceneRoot) sceneRoot.background = null;
\t\t\trenderer.setClearColor(0x000000, 0);
\t\t} else {
\t\t\t// Match editor applyBeautyClear(Color): opaque plate + scene.background.
\t\t\tconst plate = beautyClearColor ?? new THREE.Color(0x000000);
\t\t\tif (sceneRoot && "background" in sceneRoot) {
\t\t\t\tsceneRoot.background = plate;
\t\t\t}
\t\t\trenderer.setClearColor(plate, 1);
\t\t}'''

if old_clear not in text:
    raise SystemExit("beauty clear block not found")
text = text.replace(old_clear, new_clear, 1)

# restore bg for both paths
old_restore = '''\t\tif (transparentClear && sceneRoot && "background" in sceneRoot) {
\t\t\tsceneRoot.background = prevBg as THREE.Scene["background"];
\t\t}
\t\trenderer.setClearColor(this.clearScratch, prevClearAlpha);'''

new_restore = '''\t\tif (sceneRoot && "background" in sceneRoot) {
\t\t\tsceneRoot.background = prevBg as THREE.Scene["background"];
\t\t}
\t\trenderer.setClearColor(this.clearScratch, prevClearAlpha);'''

if old_restore not in text:
    raise SystemExit("bg restore block not found")
text = text.replace(old_restore, new_restore, 1)

# --- B) renderOneFlowerText pack PP call ---
old_call = '''\t\t\t\tconst ortho = this.ensureFlowerPpOrtho(resW, resH);
\t\t\t\tthis.renderPackWithPostProcess({
\t\t\t\t\tpackId: packId + ":textanim-pp",
\t\t\t\t\tbuilt: {
\t\t\t\t\t\t...built,
\t\t\t\t\t\tpostProcess: packPpStack,
\t\t\t\t\t\tresolution: { width: resW, height: resH },
\t\t\t\t\t\tcamera: ortho,
\t\t\t\t\t},
\t\t\t\t\twidth: Math.max(1, resW),
\t\t\t\t\theight: Math.max(1, resH),
\t\t\t\t\ttarget: ppRT,
\t\t\t\t\tclearFirst: true,
\t\t\t\t\tkeepDepthClear: false,
\t\t\t\t\tallowMsaa: true,
\t\t\t\t\tcameraOverride: ortho,
\t\t\t\t\ttransparentClear: true,
\t\t\t\t});'''

new_call = '''\t\t\t\tconst ortho = this.ensureFlowerPpOrtho(resW, resH);
\t\t\t\t// BeautyClear parity: pack.background Default → transparent; Color → opaque plate.
\t\t\t\tconst packBg = (activePack?.payload as { background?: { type?: string; color?: string } } | null)
\t\t\t\t\t?.background;
\t\t\t\tconst bgType = String(packBg?.type || "Default");
\t\t\t\tconst isTransparentBg =
\t\t\t\t\tbgType === "Default" || bgType === "default" || !packBg?.type;
\t\t\t\tconst beautyClearColor = isTransparentBg
\t\t\t\t\t? null
\t\t\t\t\t: new THREE.Color(packBg?.color || "#000000");
\t\t\t\tthis.renderPackWithPostProcess({
\t\t\t\t\tpackId: packId + ":textanim-pp",
\t\t\t\t\tbuilt: {
\t\t\t\t\t\t...built,
\t\t\t\t\t\tpostProcess: packPpStack,
\t\t\t\t\t\tresolution: { width: resW, height: resH },
\t\t\t\t\t\tcamera: ortho,
\t\t\t\t\t},
\t\t\t\t\twidth: Math.max(1, resW),
\t\t\t\t\theight: Math.max(1, resH),
\t\t\t\t\ttarget: ppRT,
\t\t\t\t\tclearFirst: true,
\t\t\t\t\tkeepDepthClear: false,
\t\t\t\t\tallowMsaa: true,
\t\t\t\t\tcameraOverride: ortho,
\t\t\t\t\ttransparentClear: isTransparentBg,
\t\t\t\t\tbeautyClearColor,
\t\t\t\t\t// UI text is LDR; OutputPass should sRGB-encode only (editor NoToneMapping path).
\t\t\t\t\t// Forcing ACES/Neutral here was the 惨白 wash vs editor.
\t\t\t\t\toutputToneMapping: THREE.NoToneMapping,
\t\t\t\t\toutputExposure: 1,
\t\t\t\t});'''

if old_call not in text:
    raise SystemExit("flower PP call not found")
text = text.replace(old_call, new_call, 1)

# Also: when opaque bg, final blit to accum should not use alpha over in a way that
# ignores black plate — alpha blit of a=1 black already covers. Keep as-is.
# When opaque, ppRT blit clearAlpha in renderPackWithPostProcess already uses transparentClear ? 0 : 1.

path.write_text(text, encoding="utf-8")
print("OK three-compositor.ts")

# Verify markers
t2 = path.read_text(encoding="utf-8")
assert "beautyClearColor" in t2
assert "outputToneMapping: THREE.NoToneMapping" in t2
assert "isTransparentBg" in t2
print("verified compositor")
