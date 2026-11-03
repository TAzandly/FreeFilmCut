from pathlib import Path
import json, zipfile, os, tempfile, shutil

# ========== 1) three-compositor: NeutralToneMapping + colorSpace hygiene + straight-alpha PP blit ==========
path = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\services\renderer\compositor\three-compositor.ts")
text = path.read_text(encoding="utf-8")

# 1a) renderer init: explicit SRGB output
old_init = '''\t\t\tconst renderer = new THREE.WebGLRenderer({
\t\t\t\tantialias: false,
\t\t\t\talpha: true,
\t\t\t\tpremultipliedAlpha: false,
\t\t\t\tpreserveDrawingBuffer: true,
\t\t\t\tpowerPreference: "high-performance",
\t\t\t\tstencil: true,
\t\t\t});
\t\t\trenderer.setClearColor(0x000000, 1);
\t\t\trenderer.autoClear = true;
\t\t\trenderer.setPixelRatio(1);
\t\t\trenderer.setSize(width, height, false);'''

new_init = '''\t\t\tconst renderer = new THREE.WebGLRenderer({
\t\t\t\tantialias: false,
\t\t\t\talpha: true,
\t\t\t\tpremultipliedAlpha: false,
\t\t\t\tpreserveDrawingBuffer: true,
\t\t\t\tpowerPreference: "high-performance",
\t\t\t\tstencil: true,
\t\t\t});
\t\t\t// Match editor: working linear, display sRGB. Bloom/OutputPass assume this.
\t\t\trenderer.outputColorSpace = THREE.SRGBColorSpace;
\t\t\trenderer.toneMapping = THREE.NoToneMapping;
\t\t\trenderer.toneMappingExposure = 1;
\t\t\trenderer.setClearColor(0x000000, 1);
\t\t\trenderer.autoClear = true;
\t\t\trenderer.setPixelRatio(1);
\t\t\trenderer.setSize(width, height, false);'''

if old_init not in text:
    raise SystemExit("renderer init block not found")
text = text.replace(old_init, new_init, 1)

# 1b) After composer.render, tag OutputPass result as display-encoded sRGB; blit with colorSpace guard
old_after = '''\t\tbuiltPp.composer.render();
\t\trestoreCameraModeUI(beautyCam);
\t\trenderer.autoClear = prevAuto;
\t\trenderer.toneMapping = prevTmForPp;
\t\trenderer.toneMappingExposure = prevExpForPp;
\t\tif (sceneRoot && "background" in sceneRoot) {
\t\t\tsceneRoot.background = prevBg as THREE.Scene["background"];
\t\t}
\t\trenderer.setClearColor(this.clearScratch, prevClearAlpha);

\t\tconst readBuf = (
\t\t\tbuiltPp.composer as unknown as { readBuffer: THREE.WebGLRenderTarget }
\t\t).readBuffer;
\t\tif (target && readBuf?.texture) {
\t\t\tthis.blitTextureToTarget({
\t\t\t\tsource: readBuf.texture,
\t\t\t\ttarget,
\t\t\t\tflipY: false,
\t\t\t\tclear: clearFirst || !keepDepthClear,
\t\t\t\tclearColor: 0x000000,
\t\t\t\tclearAlpha: transparentClear ? 0 : 1,
\t\t\t\tblend: "replace",
\t\t\t});
\t\t}
\t}'''

new_after = '''\t\tbuiltPp.composer.render();
\t\trestoreCameraModeUI(beautyCam);
\t\trenderer.autoClear = prevAuto;
\t\trenderer.toneMapping = prevTmForPp;
\t\trenderer.toneMappingExposure = prevExpForPp;
\t\tif (sceneRoot && "background" in sceneRoot) {
\t\t\tsceneRoot.background = prevBg as THREE.Scene["background"];
\t\t}
\t\trenderer.setClearColor(this.clearScratch, prevClearAlpha);

\t\tconst readBuf = (
\t\t\tbuiltPp.composer as unknown as { readBuffer: THREE.WebGLRenderTarget }
\t\t).readBuffer;
\t\tif (target && readBuf?.texture) {
\t\t\t// OutputPass already wrote display-encoded (sRGB transfer) texels into the
\t\t\t// composer RT (often HalfFloat + Linear/NoColorSpace tag). Mark as sRGB so
\t\t\tdownstream MeshBasic present does a correct round-trip; raw ShaderMaterial
\t\t\tblit still copies bytes without an extra encode (toneMapped:false).
\t\t\tconst prevCS = readBuf.texture.colorSpace;
\t\t\treadBuf.texture.colorSpace = THREE.SRGBColorSpace;
\t\t\tthis.blitTextureToTarget({
\t\t\t\tsource: readBuf.texture,
\t\t\t\ttarget,
\t\t\t\tflipY: false,
\t\t\t\tclear: clearFirst || !keepDepthClear,
\t\t\t\tclearColor: 0x000000,
\t\t\t\tclearAlpha: transparentClear ? 0 : 1,
\t\t\t\tblend: "replace",
\t\t\t\t// Editor Viewport presentComposerToLetterbox: straight-alpha from
\t\t\t\t// additive bloom (rgb may exceed a). Needed when beauty clear is transparent.
\t\t\t\tstraightAlphaFromPremul: transparentClear,
\t\t\t});
\t\t\treadBuf.texture.colorSpace = prevCS;
\t\t\t// Keep display tag on the destination text/pack RT for presentAccum.
\t\t\tif (target.texture) target.texture.colorSpace = THREE.SRGBColorSpace;
\t\t}
\t}'''

if old_after not in text:
    raise SystemExit("after composer.render block not found")
text = text.replace(old_after, new_after, 1)

# 1c) Flower text PP: NeutralToneMapping (editor Config default), not NoToneMapping
old_tm = '''\t\t\t\t\ttransparentClear: isTransparentBg,
\t\t\t\t\tbeautyClearColor,
\t\t\t\t\t// UI text is LDR; OutputPass should sRGB-encode only (editor NoToneMapping path).
\t\t\t\t\t// Forcing ACES/Neutral here was the 惨白 wash vs editor.
\t\t\t\t\toutputToneMapping: THREE.NoToneMapping,
\t\t\t\t\toutputExposure: 1,
\t\t\t\t});'''

new_tm = '''\t\t\t\t\ttransparentClear: isTransparentBg,
\t\t\t\t\tbeautyClearColor,
\t\t\t\t\t// Editor project default is NeutralToneMapping (Config toneMapping:7).
\t\t\t\t\t// NoToneMapping + HDR bloom clipped hard → white wash; ACES was worse.
\t\t\t\t\t// Prefer pack-authored toneMapping when present.
\t\t\t\t\toutputToneMapping: resolvePackOutputToneMapping(activePack?.payload),
\t\t\t\t\toutputExposure: resolvePackOutputExposure(activePack?.payload),
\t\t\t\t});'''

if old_tm not in text:
    raise SystemExit("flower PP toneMapping call not found")
text = text.replace(old_tm, new_tm, 1)

# 1d) Extend blitTextureToTarget with straightAlphaFromPremul
old_blit_sig = '''\tprivate blitTextureToTarget({
\t\tsource,
\t\ttarget,
\t\tflipY = false,
\t\tclear = true,
\t\tclearColor = 0x000000,
\t\tclearAlpha = 1,
\t\tblend = "replace",
\t\tcontain,
\t\tplacement,
\t\topacity = 1,
\t}: {
\t\tsource: THREE.Texture;
\t\ttarget: THREE.WebGLRenderTarget | null;
\t\tflipY?: boolean;
\t\tclear?: boolean;
\t\tclearColor?: number;
\t\tclearAlpha?: number;
\t\tblend?: "replace" | "alpha";
\t\t/** Fit source pixels inside the destination without stretching. */
\t\tcontain?: {
\t\t\tsourceWidth: number;
\t\t\tsourceHeight: number;
\t\t\tdestWidth: number;
\t\t\tdestHeight: number;
\t\t};
\t\t/** Extra placement on top of contain. Scale is a multiplier, position is pixels, rotation is degrees. */
\t\tplacement?: {
\t\t\tscaleX: number;
\t\t\tscaleY: number;
\t\t\tpositionX: number;
\t\t\tpositionY: number;
\t\t\trotate: number;
\t\t};
\t\t/** Multiplies rgb and alpha of the finished picture. */
\t\topacity?: number;
\t}) {'''

new_blit_sig = '''\tprivate blitTextureToTarget({
\t\tsource,
\t\ttarget,
\t\tflipY = false,
\t\tclear = true,
\t\tclearColor = 0x000000,
\t\tclearAlpha = 1,
\t\tblend = "replace",
\t\tcontain,
\t\tplacement,
\t\topacity = 1,
\t\tstraightAlphaFromPremul = false,
\t}: {
\t\tsource: THREE.Texture;
\t\ttarget: THREE.WebGLRenderTarget | null;
\t\tflipY?: boolean;
\t\tclear?: boolean;
\t\tclearColor?: number;
\t\tclearAlpha?: number;
\t\tblend?: "replace" | "alpha";
\t\t/** Fit source pixels inside the destination without stretching. */
\t\tcontain?: {
\t\t\tsourceWidth: number;
\t\t\tsourceHeight: number;
\t\t\tdestWidth: number;
\t\t\tdestHeight: number;
\t\t};
\t\t/** Extra placement on top of contain. Scale is a multiplier, position is pixels, rotation is degrees. */
\t\tplacement?: {
\t\t\tscaleX: number;
\t\t\tscaleY: number;
\t\t\tpositionX: number;
\t\t\tpositionY: number;
\t\t\trotate: number;
\t\t};
\t\t/** Multiplies rgb and alpha of the finished picture. */
\t\topacity?: number;
\t\t/**
\t\t * Editor Viewport presentComposerToLetterbox: additive bloom leaves
\t\t * premultiplied-looking rgb with low a; convert to straight alpha for
\t\t * premultipliedAlpha:false compositing.
\t\t */
\t\tstraightAlphaFromPremul?: boolean;
\t}) {'''

if old_blit_sig not in text:
    raise SystemExit("blitTextureToTarget sig not found")
text = text.replace(old_blit_sig, new_blit_sig, 1)

# Swap fragment during straight-alpha blit
old_blit_render = '''\t\tblitMaterial.uniformsNeedUpdate = true;

\t\trenderer.setRenderTarget(target);
\t\trenderer.autoClear = clear;
\t\tif (clear) {
\t\t\trenderer.setClearColor(clearColor, clearAlpha);
\t\t\trenderer.clear();
\t\t}
\t\trenderer.render(blitScene, blitCamera);
\t\trenderer.autoClear = false;
\t\tblitMaterial.uniforms.tDiffuse.value = null;'''

new_blit_render = '''\t\tblitMaterial.uniformsNeedUpdate = true;

\t\tconst prevFrag = blitMaterial.fragmentShader;
\t\tif (straightAlphaFromPremul) {
\t\t\t// Same contract as editor Viewport _blitMat (display-encoded, straight alpha).
\t\t\tblitMaterial.fragmentShader = /* glsl */ `
\t\t\t\tuniform sampler2D tDiffuse;
\t\t\t\tuniform float uFlipY;
\t\t\t\tuniform float uOpacity;
\t\t\t\tvarying vec2 vUv;
\t\t\t\tvoid main() {
\t\t\t\t\tvec2 uv = uFlipY > 0.5 ? vec2(vUv.x, 1.0 - vUv.y) : vUv;
\t\t\t\t\tvec4 c = texture2D(tDiffuse, uv);
\t\t\t\t\tvec3 rgb = clamp(c.rgb, 0.0, 1.0);
\t\t\t\t\tfloat a = clamp(max(c.a, max(rgb.r, max(rgb.g, rgb.b))), 0.0, 1.0);
\t\t\t\t\tvec3 straight = a > 1e-5 ? rgb / a : vec3(0.0);
\t\t\t\t\tgl_FragColor = vec4(straight, a) * uOpacity;
\t\t\t\t}
\t\t\t`;
\t\t\tblitMaterial.needsUpdate = true;
\t\t}

\t\trenderer.setRenderTarget(target);
\t\trenderer.autoClear = clear;
\t\tif (clear) {
\t\t\trenderer.setClearColor(clearColor, clearAlpha);
\t\t\trenderer.clear();
\t\t}
\t\trenderer.render(blitScene, blitCamera);
\t\trenderer.autoClear = false;
\t\tif (straightAlphaFromPremul) {
\t\t\tblitMaterial.fragmentShader = prevFrag;
\t\t\tblitMaterial.needsUpdate = true;
\t\t}
\t\tblitMaterial.uniforms.tDiffuse.value = null;'''

if old_blit_render not in text:
    raise SystemExit("blit render block not found")
text = text.replace(old_blit_render, new_blit_render, 1)

# Also: flower text final blit to accum should use straightAlpha when transparent bg
old_final = '''\t\t\tthis.blitTextureToTarget({
\t\t\t\tsource: ppRT.texture,
\t\t\t\ttarget,
\t\t\t\tflipY: false,
\t\t\t\tclear: false,
\t\t\t\tblend: "alpha",
\t\t\t\topacity: item.opacity * (props.opacity > 0 ? props.opacity : 1),
\t\t\t});
\t\t\treturn true;
\t\t}'''

new_final = '''\t\t\t// PP result is display-encoded; keep sRGB tag for MeshBasic present.
\t\t\tppRT.texture.colorSpace = THREE.SRGBColorSpace;
\t\t\tthis.blitTextureToTarget({
\t\t\t\tsource: ppRT.texture,
\t\t\t\ttarget,
\t\t\t\tflipY: false,
\t\t\t\tclear: false,
\t\t\t\tblend: "alpha",
\t\t\t\topacity: item.opacity * (props.opacity > 0 ? props.opacity : 1),
\t\t\t\tstraightAlphaFromPremul: isTransparentBg,
\t\t\t});
\t\t\treturn true;
\t\t}'''

if old_final not in text:
    raise SystemExit("final ppRT blit not found")
text = text.replace(old_final, new_final, 1)

path.write_text(text, encoding="utf-8")
print("OK three-compositor core patches")

# Verify resolvePack helpers don't exist yet - add them near top of file or before class end
if "function resolvePackOutputToneMapping" not in path.read_text(encoding="utf-8"):
    print("need helpers")
else:
    print("helpers exist")
