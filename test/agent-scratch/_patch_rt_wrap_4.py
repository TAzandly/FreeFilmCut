# -*- coding: utf-8 -*-
import pathlib, re

ROOT = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut")

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, s):
    path = ROOT / rel
    path.write_text(s, encoding="utf-8")
    print("wrote", path)

# Fix uFccTexUse value = true -> 1
rel = "freefilmcut/apps/web/src/vfxpack/pack-video.ts"
s = read(rel)
s = s.replace(
    'if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {\n\t\t\t\t\t\tshader.uniforms.uFccTexUse.value = true;\n\t\t\t\t\t}',
    'if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {\n\t\t\t\t\t\tshader.uniforms.uFccTexUse.value = 1;\n\t\t\t\t\t}',
)
write(rel, s)

# ---- scene-builder.ts: stop forcing Repeat on live RT ----
rel = "freefilmcut/apps/web/src/vfxpack/scene-builder.ts"
s = read(rel)
old = """\tif (path.startsWith("rt:")) {
\t\tconst live = resolveFlowerRtTex(path);
\t\tif (live) {
\t\t\tlive.wrapS = THREE.RepeatWrapping;
\t\t\tlive.wrapT = THREE.RepeatWrapping;
\t\t}
\t\tcb(live);
\t\treturn;
\t}"""
new = """\tif (path.startsWith("rt:")) {
\t\tconst live = resolveFlowerRtTex(path);
\t\t// RT wrap comes from fccRenderTexture.wrapMode (ensurePackRenderTargets); do not overwrite.
\t\tcb(live);
\t\treturn;
\t}"""
if old not in s:
    raise SystemExit("scene-builder live RT wrap block missing")
s = s.replace(old, new, 1)
s = s.replace(
    "sigRev: 32, // fcc-tl-flower-35: RT+range atlas mod clamp (mod(n,n)->0)",
    "sigRev: 33, // fcc-tl-flower-36: RT wrapMode clamp/repeat/mirroredRepeat",
)
write(rel, s)
print("scene-builder ok")

# ---- timeline-flower-text.ts rev ----
rel = "freefilmcut/apps/web/src/vfxpack/timeline-flower-text.ts"
s = read(rel)
s = s.replace(
    "rev: 35, // fcc-tl-flower-35: RT+range atlas mod clamp",
    "rev: 36, // fcc-tl-flower-36: RT wrapMode selectable",
)
write(rel, s)

# ---- text-template-media.ts preserve wrapMode ----
rel = "freefilmcut/apps/web/src/vfxpack/text-template-media.ts"
s = read(rel)
old = """\t\tconst rtSpec = (rtObj.userData as { fccRenderTexture?: { width?: number; height?: number } })
\t\t\t.fccRenderTexture || { width: 512, height: 512 };
\t\trtObj.userData.fccRenderTexture = {
\t\t\twidth: Math.min(4096, Math.max(16, Math.round(Number(rtSpec.width) || 512))),
\t\t\theight: Math.min(4096, Math.max(16, Math.round(Number(rtSpec.height) || 512))),
\t\t};"""
new = """\t\tconst rtSpec = (rtObj.userData as {
\t\t\tfccRenderTexture?: { width?: number; height?: number; wrapMode?: string };
\t\t}).fccRenderTexture || { width: 512, height: 512 };
\t\tconst wrapRaw = typeof rtSpec.wrapMode === "string" ? rtSpec.wrapMode : "clamp";
\t\tconst wrapMode =
\t\t\twrapRaw === "repeat" || wrapRaw === "mirroredRepeat" || wrapRaw === "clamp"
\t\t\t\t? wrapRaw
\t\t\t\t: "clamp";
\t\trtObj.userData.fccRenderTexture = {
\t\t\twidth: Math.min(4096, Math.max(16, Math.round(Number(rtSpec.width) || 512))),
\t\t\theight: Math.min(4096, Math.max(16, Math.round(Number(rtSpec.height) || 512))),
\t\t\twrapMode,
\t\t};"""
if old not in s:
    raise SystemExit("text-template-media rtSpec block missing")
s = s.replace(old, new, 1)
write(rel, s)
print("text-template-media ok")
