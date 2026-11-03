# -*- coding: utf-8 -*-
"""Fix tight text RT viewport leak into other clips."""
from pathlib import Path

ROOT = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src")

# ---- text-layer-rt.ts ----
tl = ROOT / "vfxpack" / "text-layer-rt.ts"
text = tl.read_text(encoding="utf-8")
old_rtl = '''\trenderer.setRenderTarget(target);
\trenderer.setViewport(0, 0, target.width, target.height);
\trenderer.setScissorTest(false);
\trenderer.setClearColor(0x000000, 0);
\trenderer.clear(true, true, true);

\tconst drew = renderUIOverlay({
\t\trenderer,
\t\troot,
\t\tuiCamera,
\t\tresW,
\t\tresH,
\t\ttarget,
\t\tviewRect: viewRect || null,
\t});

\trenderer.setClearColor(prevClear, prevAlpha);
\trenderer.setRenderTarget(prevTarget);
\treturn drew;
'''
new_rtl = '''\tconst prevViewport = new THREE.Vector4();
\tconst prevScissor = new THREE.Vector4();
\trenderer.getViewport(prevViewport);
\trenderer.getScissor(prevScissor);
\tconst prevScissorTest = renderer.getScissorTest();

\trenderer.setRenderTarget(target);
\trenderer.setViewport(0, 0, target.width, target.height);
\trenderer.setScissorTest(false);
\trenderer.setClearColor(0x000000, 0);
\trenderer.clear(true, true, true);

\tconst drew = renderUIOverlay({
\t\trenderer,
\t\troot,
\t\tuiCamera,
\t\tresW,
\t\tresH,
\t\ttarget,
\t\tviewRect: viewRect || null,
\t});

\trenderer.setClearColor(prevClear, prevAlpha);
\trenderer.setRenderTarget(prevTarget);
\trenderer.setViewport(prevViewport);
\trenderer.setScissor(prevScissor);
\trenderer.setScissorTest(prevScissorTest);
\treturn drew;
'''
if old_rtl not in text:
    raise SystemExit("text-layer-rt.ts: expected block not found")
text = text.replace(old_rtl, new_rtl, 1)
tl.write_text(text, encoding="utf-8")
print("patched text-layer-rt.ts")

# ---- three-compositor.ts ----
tc = ROOT / "services" / "renderer" / "compositor" / "three-compositor.ts"
src = tc.read_text(encoding="utf-8")

# 1) Add scratch Vector4 fields next to clearScratch
old_field = "\tprivate clearScratch = new THREE.Color();\n"
new_field = (
    "\tprivate clearScratch = new THREE.Color();\n"
    "\t/** Save/restore around tight text RT / pack PP so video layers keep full viewport. */\n"
    "\tprivate viewportScratch = new THREE.Vector4();\n"
    "\tprivate scissorScratch = new THREE.Vector4();\n"
)
if "viewportScratch" not in src:
    if old_field not in src:
        raise SystemExit("three-compositor: clearScratch field not found")
    src = src.replace(old_field, new_field, 1)
    print("added viewportScratch fields")
else:
    print("viewportScratch already present")

# 2) Helper method - insert before ensureComposeTargets or after presentAccum
helper = '''
\t/** Push/pop renderer viewport+scissor so tight text FBO sizes cannot leak to other clips. */
\tprivate withFullTargetViewport<T>(
\t\ttarget: THREE.WebGLRenderTarget | null,
\t\tfn: () => T,
\t): T {
\t\tconst renderer = this.renderer;
\t\tif (!renderer) return fn();
\t\trenderer.getViewport(this.viewportScratch);
\t\trenderer.getScissor(this.scissorScratch);
\t\tconst prevScissorTest = renderer.getScissorTest();
\t\tconst w = target?.width || renderer.domElement.width || 1;
\t\tconst h = target?.height || renderer.domElement.height || 1;
\t\trenderer.setViewport(0, 0, w, h);
\t\trenderer.setScissorTest(false);
\t\ttry {
\t\t\treturn fn();
\t\t} finally {
\t\t\trenderer.setViewport(this.viewportScratch);
\t\t\trenderer.setScissor(this.scissorScratch);
\t\t\trenderer.setScissorTest(prevScissorTest);
\t\t}
\t}

'''

if "withFullTargetViewport" not in src:
    anchor = "\tprivate presentAccum() {"
    if anchor not in src:
        raise SystemExit("presentAccum not found for helper insert")
    src = src.replace(anchor, helper + anchor, 1)
    print("added withFullTargetViewport helper")
else:
    print("helper already present")

# 3) presentAccum: force full canvas viewport before present
old_present = '''\t\tconst prevMat = blitMesh.material;
\t\tblitMesh.material = presentMaterial;
\t\tpresentMaterial.map = accumRT.texture;
\t\tpresentMaterial.needsUpdate = true;
\t\trenderer.setRenderTarget(null);
\t\trenderer.autoClear = true;
\t\trenderer.setClearColor(0x000000, 1);
\t\trenderer.render(blitScene, blitCamera);
\t\trenderer.autoClear = true;
\t\tblitMesh.material = prevMat;
\t\tpresentMaterial.map = null;
\t}
'''
new_present = '''\t\tconst prevMat = blitMesh.material;
\t\tblitMesh.material = presentMaterial;
\t\tpresentMaterial.map = accumRT.texture;
\t\tpresentMaterial.needsUpdate = true;
\t\trenderer.getViewport(this.viewportScratch);
\t\trenderer.getScissor(this.scissorScratch);
\t\tconst prevScissorTest = renderer.getScissorTest();
\t\tconst cw = Math.max(1, renderer.domElement.width || accumRT.width);
\t\tconst ch = Math.max(1, renderer.domElement.height || accumRT.height);
\t\trenderer.setRenderTarget(null);
\t\trenderer.setViewport(0, 0, cw, ch);
\t\trenderer.setScissorTest(false);
\t\trenderer.autoClear = true;
\t\trenderer.setClearColor(0x000000, 1);
\t\trenderer.render(blitScene, blitCamera);
\t\trenderer.autoClear = true;
\t\trenderer.setViewport(this.viewportScratch);
\t\trenderer.setScissor(this.scissorScratch);
\t\trenderer.setScissorTest(prevScissorTest);
\t\tblitMesh.material = prevMat;
\t\tpresentMaterial.map = null;
\t}
'''
if old_present not in src:
    raise SystemExit("presentAccum body not found")
src = src.replace(old_present, new_present, 1)
print("patched presentAccum")

# 4) compositeOneLayer: set full accum viewport before video/image draw
old_col = '''\t\tconst compositeOneLayer = (
\t\t\titem: Extract<FrameItemDescriptor, { type: "layer" }>,
\t\t) => {
\t\t\tthis.clearLayerMeshes();
\t\t\tthis.addLayerMesh(item, z);
\t\t\tz += 1;
\t\t\tif (this.layerMeshes.length === 0) return;
\t\t\trenderer.setRenderTarget(accumRT);
\t\t\trenderer.autoClear = false;
\t\t\trenderer.render(scene, camera);
\t\t\tdidDraw = true;
\t\t\tlayersBelow += 1;
\t\t\tthis.clearLayerMeshes();
\t\t};
'''
new_col = '''\t\tconst compositeOneLayer = (
\t\t\titem: Extract<FrameItemDescriptor, { type: "layer" }>,
\t\t) => {
\t\t\tthis.clearLayerMeshes();
\t\t\tthis.addLayerMesh(item, z);
\t\t\tz += 1;
\t\t\tif (this.layerMeshes.length === 0) return;
\t\t\trenderer.setRenderTarget(accumRT);
\t\t\t// Tight text RT must not leave a small viewport; video/image need full accum.
\t\t\trenderer.setViewport(0, 0, accumRT.width, accumRT.height);
\t\t\trenderer.setScissorTest(false);
\t\t\trenderer.autoClear = false;
\t\t\trenderer.render(scene, camera);
\t\t\tdidDraw = true;
\t\t\tlayersBelow += 1;
\t\t\tthis.clearLayerMeshes();
\t\t};
'''
if old_col not in src:
    raise SystemExit("compositeOneLayer not found")
src = src.replace(old_col, new_col, 1)
print("patched compositeOneLayer")

# 5) blitTextureToTarget: set destination viewport for the blit, restore after
# Find the render section inside blitTextureToTarget
old_blit_render = '''\t\trenderer.setRenderTarget(target);
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
\t\tblitMaterial.uniforms.tDiffuse.value = null;
\t\t(blitMaterial.uniforms.uScale.value as THREE.Vector2).set(1, 1);
\t\t(blitMaterial.uniforms.uOffset.value as THREE.Vector2).set(0, 0);
\t\tblitMaterial.uniforms.uRotate.value = 0;
\t\tblitMaterial.uniforms.uOpacity.value = 1;
\t\tblitMaterial.transparent = prevTransparent;
\t\tblitMaterial.blending = prevBlending;
\t\tblitMesh.material = prevMat;
'''
new_blit_render = '''\t\trenderer.getViewport(this.viewportScratch);
\t\trenderer.getScissor(this.scissorScratch);
\t\tconst prevScissorTestBlit = renderer.getScissorTest();
\t\tconst blitW = Math.max(1, target?.width || destWidth);
\t\tconst blitH = Math.max(1, target?.height || destHeight);
\t\trenderer.setRenderTarget(target);
\t\trenderer.setViewport(0, 0, blitW, blitH);
\t\trenderer.setScissorTest(false);
\t\trenderer.autoClear = clear;
\t\tif (clear) {
\t\t\trenderer.setClearColor(clearColor, clearAlpha);
\t\t\trenderer.clear();
\t\t}
\t\trenderer.render(blitScene, blitCamera);
\t\trenderer.autoClear = false;
\t\trenderer.setViewport(this.viewportScratch);
\t\trenderer.setScissor(this.scissorScratch);
\t\trenderer.setScissorTest(prevScissorTestBlit);
\t\tif (straightAlphaFromPremul) {
\t\t\tblitMaterial.fragmentShader = prevFrag;
\t\t\tblitMaterial.needsUpdate = true;
\t\t}
\t\tblitMaterial.uniforms.tDiffuse.value = null;
\t\t(blitMaterial.uniforms.uScale.value as THREE.Vector2).set(1, 1);
\t\t(blitMaterial.uniforms.uOffset.value as THREE.Vector2).set(0, 0);
\t\tblitMaterial.uniforms.uRotate.value = 0;
\t\tblitMaterial.uniforms.uOpacity.value = 1;
\t\tblitMaterial.transparent = prevTransparent;
\t\tblitMaterial.blending = prevBlending;
\t\tblitMesh.material = prevMat;
'''
if old_blit_render not in src:
    raise SystemExit("blitTextureToTarget render block not found")
src = src.replace(old_blit_render, new_blit_render, 1)
print("patched blitTextureToTarget")

# 6) renderPackWithPostProcess: restore viewport after EffectComposer (tight text PP)
old_pp = '''\t\tprepareCameraModeUI({
\t\t\troot: built.root,
\t\t\tbeautyCam,
\t\t\tresW,
\t\t\tresH,
\t\t});
\t\trenderer.autoClear = true;
\t\tbuiltPp.composer.render();
\t\trestoreCameraModeUI(beautyCam);
\t\trenderer.autoClear = prevAuto;
\t\trenderer.toneMapping = prevTmForPp;
\t\trenderer.toneMappingExposure = prevExpForPp;
'''
new_pp = '''\t\tprepareCameraModeUI({
\t\t\troot: built.root,
\t\t\tbeautyCam,
\t\t\tresW,
\t\t\tresH,
\t\t});
\t\trenderer.getViewport(this.viewportScratch);
\t\trenderer.getScissor(this.scissorScratch);
\t\tconst prevScissorTestPp = renderer.getScissorTest();
\t\trenderer.autoClear = true;
\t\tbuiltPp.composer.render();
\t\t// EffectComposer sets viewport to its FBO size (tight text RT); restore so
\t\t// following video/image layers and present use the full compose buffer.
\t\trenderer.setViewport(this.viewportScratch);
\t\trenderer.setScissor(this.scissorScratch);
\t\trenderer.setScissorTest(prevScissorTestPp);
\t\trestoreCameraModeUI(beautyCam);
\t\trenderer.autoClear = prevAuto;
\t\trenderer.toneMapping = prevTmForPp;
\t\trenderer.toneMappingExposure = prevExpForPp;
'''
if old_pp not in src:
    raise SystemExit("renderPackWithPostProcess composer block not found")
src = src.replace(old_pp, new_pp, 1)
print("patched renderPackWithPostProcess")

tc.write_text(src, encoding="utf-8")
print("wrote three-compositor.ts")
print("DONE")
