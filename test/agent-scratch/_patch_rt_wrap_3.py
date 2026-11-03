# -*- coding: utf-8 -*-
import pathlib, re

ROOT = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut")

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, s):
    path = ROOT / rel
    path.write_text(s, encoding="utf-8")
    print("wrote", path)

# ---- pack-video.ts ----
rel = "freefilmcut/apps/web/src/vfxpack/pack-video.ts"
s = read(rel)

# Add wrap helpers near ensurePackRenderTargets if missing
if "normalizePackRtWrapMode" not in s:
    # Insert helpers before ensurePackRenderTargets
    helpers = '''
type PackRtWrapMode = "clamp" | "repeat" | "mirroredRepeat";

function normalizePackRtWrapMode(mode: unknown): PackRtWrapMode {
\tconst m = String(mode ?? "").trim();
\tif (m === "clamp" || m === "repeat" || m === "mirroredRepeat") return m;
\tif (m === "ClampToEdge" || m === "ClampToEdgeWrapping" || m === "Clamp") return "clamp";
\tif (m === "Repeat" || m === "RepeatWrapping") return "repeat";
\tif (m === "MirroredRepeat" || m === "MirroredRepeatWrapping") return "mirroredRepeat";
\treturn "clamp";
}

function applyPackRtTextureWrap(texture: THREE.Texture, wrapMode: unknown) {
\tconst mode = normalizePackRtWrapMode(wrapMode);
\tconst wrapping =
\t\tmode === "repeat"
\t\t\t? THREE.RepeatWrapping
\t\t\t: mode === "mirroredRepeat"
\t\t\t\t? THREE.MirroredRepeatWrapping
\t\t\t\t: THREE.ClampToEdgeWrapping;
\tif (texture.wrapS !== wrapping || texture.wrapT !== wrapping) {
\t\ttexture.wrapS = wrapping;
\t\ttexture.wrapT = wrapping;
\t\ttexture.needsUpdate = true;
\t}
}

'''
    if "export function ensurePackRenderTargets" not in s:
        raise SystemExit("ensurePackRenderTargets missing")
    s = s.replace("export function ensurePackRenderTargets", helpers + "export function ensurePackRenderTargets", 1)

# Replace ensurePackRenderTargets body wrap handling
old_ensure = '''export function ensurePackRenderTargets(root: THREE.Object3D) {
\troot.traverse((object) => {
\t\tconst spec = (object.userData as { fccRenderTexture?: { width?: number; height?: number } })
\t\t\t.fccRenderTexture;
\t\tif (!spec) return;
\t\tconst width = Math.min(4096, Math.max(16, Math.round(Number(spec.width) || 512)));
\t\tconst height = Math.min(4096, Math.max(16, Math.round(Number(spec.height) || 512)));
\t\tspec.width = width;
\t\tspec.height = height;
\t\tlet rt = (object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
\t\tif (!rt) {
\t\t\trt = new THREE.WebGLRenderTarget(width, height, {
\t\t\t\tdepthBuffer: false,
\t\t\t\tstencilBuffer: false,
\t\t\t\tgenerateMipmaps: false,
\t\t\t\tminFilter: THREE.LinearFilter,
\t\t\t\tmagFilter: THREE.LinearFilter,
\t\t\t\tformat: THREE.RGBAFormat,
\t\t\t\ttype: THREE.UnsignedByteType,
\t\t\t\tcolorSpace: THREE.SRGBColorSpace,
\t\t\t});
\t\t\trt.texture.colorSpace = THREE.SRGBColorSpace;
\t\t\trt.texture.flipY = false;
\t\t\trt.texture.generateMipmaps = false;
\t\t\trt.texture.premultipliedAlpha = false;
\t\t\trt.texture.userData.fccRenderTextureUuid = object.uuid;
\t\t\t(object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT = rt;
\t\t} else if (rt.width !== width || rt.height !== height) {
\t\t\trt.setSize(width, height);
\t\t}
\t});
}'''

new_ensure = '''export function ensurePackRenderTargets(root: THREE.Object3D) {
\troot.traverse((object) => {
\t\tconst spec = (object.userData as {
\t\t\tfccRenderTexture?: { width?: number; height?: number; wrapMode?: string };
\t\t}).fccRenderTexture;
\t\tif (!spec) return;
\t\tconst width = Math.min(4096, Math.max(16, Math.round(Number(spec.width) || 512)));
\t\tconst height = Math.min(4096, Math.max(16, Math.round(Number(spec.height) || 512)));
\t\tspec.width = width;
\t\tspec.height = height;
\t\tspec.wrapMode = normalizePackRtWrapMode(spec.wrapMode);
\t\tlet rt = (object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;
\t\tif (!rt) {
\t\t\trt = new THREE.WebGLRenderTarget(width, height, {
\t\t\t\tdepthBuffer: false,
\t\t\t\tstencilBuffer: false,
\t\t\t\tgenerateMipmaps: false,
\t\t\t\tminFilter: THREE.LinearFilter,
\t\t\t\tmagFilter: THREE.LinearFilter,
\t\t\t\tformat: THREE.RGBAFormat,
\t\t\t\ttype: THREE.UnsignedByteType,
\t\t\t\tcolorSpace: THREE.SRGBColorSpace,
\t\t\t});
\t\t\trt.texture.colorSpace = THREE.SRGBColorSpace;
\t\t\trt.texture.flipY = false;
\t\t\trt.texture.generateMipmaps = false;
\t\t\trt.texture.premultipliedAlpha = false;
\t\t\trt.texture.userData.fccRenderTextureUuid = object.uuid;
\t\t\t(object.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT = rt;
\t\t} else if (rt.width !== width || rt.height !== height) {
\t\t\trt.setSize(width, height);
\t\t}
\t\tapplyPackRtTextureWrap(rt.texture, spec.wrapMode);
\t});
}'''

if old_ensure not in s:
    raise SystemExit("ensurePackRenderTargets exact block missing")
s = s.replace(old_ensure, new_ensure, 1)

# Remove force Repeat in rebindPackRenderTextures
old_force = '''\t\t\t\t\tif (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
\t\t\t\t\t\tshader.uniforms.uFccTexUse.value = true;
\t\t\t\t\t\tif (texture && (texture as THREE.Texture).isTexture) {
\t\t\t\t\t\t\ttexture.wrapS = THREE.RepeatWrapping;
\t\t\t\t\t\t\ttexture.wrapT = THREE.RepeatWrapping;
\t\t\t\t\t\t}
\t\t\t\t\t}'''

# Check actual content - useMap true vs 1
force_pat = re.compile(
    r'if \(slot\.key === "uFccTex" && shader\.uniforms\.uFccTexUse\) \{\s*'
    r'shader\.uniforms\.uFccTexUse\.value = true;\s*'
    r'if \(texture && \(texture as THREE\.Texture\)\.isTexture\) \{\s*'
    r'texture\.wrapS = THREE\.RepeatWrapping;\s*'
    r'texture\.wrapT = THREE\.RepeatWrapping;\s*'
    r'\}\s*'
    r'\}'
)
# also try value = 1 variant from earlier read - it was `true`? Let me check from earlier - it said:
# shader.uniforms.uFccTexUse.value = true;
# Actually from the read it was:
# if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
#   shader.uniforms.uFccTexUse.value = true;  -- wait the read showed:
#   shader.uniforms.uFccTexUse.value = true;
# Looking again at the earlier output:
#						if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
#							shader.uniforms.uFccTexUse.value = true;
# No - it was:
#							shader.uniforms.uFccTexUse.value = true;
# From the Get-Content output:
#					if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
#						shader.uniforms.uFccTexUse.value = true;
# Actually:
'''
					if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
						shader.uniforms.uFccTexUse.value = true;
						if (texture && (texture as THREE.Texture).isTexture) {
							texture.wrapS = THREE.RepeatWrapping;
							texture.wrapT = THREE.RepeatWrapping;
						}
					}
'''
# Wait the file showed value = true? Let me look again...
# From second read:
#					if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
#						shader.uniforms.uFccTexUse.value = true;
# No - it was:
#						shader.uniforms.uFccTexUse.value = true;
# The actual text was:
#							shader.uniforms.uFccTexUse.value = true;
# Hmm looking carefully at the untrusted data:
#					if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
#						shader.uniforms.uFccTexUse.value = true;
# Actually:
#						shader.uniforms.uFccTexUse.value = true;
# I'll use a more flexible regex.

force_pat2 = re.compile(
    r'if \(slot\.key === "uFccTex" && shader\.uniforms\.uFccTexUse\) \{\s*'
    r'shader\.uniforms\.uFccTexUse\.value = (?:true|1);\s*'
    r'if \(texture && \(texture as THREE\.Texture\)\.isTexture\) \{\s*'
    r'texture\.wrapS = THREE\.RepeatWrapping;\s*'
    r'texture\.wrapT = THREE\.RepeatWrapping;\s*'
    r'\}\s*'
    r'\}'
)
force_new = '''if (slot.key === "uFccTex" && shader.uniforms.uFccTexUse) {
						shader.uniforms.uFccTexUse.value = true;
					}'''
s2, n = force_pat2.subn(force_new, s, count=1)
print("pack-video force remove", n)
if n != 1:
    # dump nearby for debug
    idx = s.find('uFccTexUse')
    print("nearby:", repr(s[idx-80:idx+220]) if idx>=0 else "not found")
    raise SystemExit("pack-video force Repeat not removed")
s = s2

write(rel, s)
print("pack-video ok")
