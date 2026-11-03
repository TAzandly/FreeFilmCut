# -*- coding: utf-8 -*-
import pathlib, re

ROOT = pathlib.Path(r"D:/GrokbotWork/FreeFilmCut")

def read(rel):
    return (ROOT / rel).read_text(encoding="utf-8")

def write(rel, s):
    path = ROOT / rel
    path.write_text(s, encoding="utf-8")
    print("wrote", path)

# ---- FccVideo.js ----
rel = "three.js/editor/js/media/FccVideo.js"
s = read(rel)

helpers = """const RT_KEY = 'fccRenderTexture';

/** RT wrapMode strings -> Three.js wrapping (S and T share one mode). Default clamp. */
const RT_WRAP_THREE = {
\tclamp: THREE.ClampToEdgeWrapping,
\trepeat: THREE.RepeatWrapping,
\tmirroredRepeat: THREE.MirroredRepeatWrapping,
};

function normalizeRtWrapMode( mode ) {

\tconst m = String( mode == null ? '' : mode ).trim();
\tif ( m === 'clamp' || m === 'repeat' || m === 'mirroredRepeat' ) return m;
\tif ( m === 'ClampToEdge' || m === 'ClampToEdgeWrapping' || m === 'Clamp' ) return 'clamp';
\tif ( m === 'Repeat' || m === 'RepeatWrapping' ) return 'repeat';
\tif ( m === 'MirroredRepeat' || m === 'MirroredRepeatWrapping' ) return 'mirroredRepeat';
\treturn 'clamp';

}

function applyRtTextureWrap( texture, wrapMode ) {

\tif ( ! texture ) return;
\tconst wrapping = RT_WRAP_THREE[ normalizeRtWrapMode( wrapMode ) ] || THREE.ClampToEdgeWrapping;
\tif ( texture.wrapS !== wrapping || texture.wrapT !== wrapping ) {

\t\ttexture.wrapS = wrapping;
\t\ttexture.wrapT = wrapping;
\t\ttexture.needsUpdate = true;

\t}

}
"""

if "function normalizeRtWrapMode" not in s:
    anchor = "const RT_KEY = 'fccRenderTexture';"
    if anchor not in s:
        raise SystemExit("RT_KEY missing")
    s = s.replace(anchor, helpers, 1)

s = s.replace(
    "object.userData[ RT_KEY ] = { width: 512, height: 512 };",
    "object.userData[ RT_KEY ] = { width: 512, height: 512, wrapMode: 'clamp' };",
)

ensure_pat = re.compile(r"function ensureRenderTarget\( object \) \{[\s\S]*?\n\}\n\nfunction getRenderTexture")
ensure_new = """function ensureRenderTarget( object ) {

\tif ( ! isFccRenderTexture( object ) ) return null;
\tconst spec = object.userData[ RT_KEY ];
\tconst width = clampSize( spec.width, 512 );
\tconst height = clampSize( spec.height, 512 );
\tspec.width = width;
\tspec.height = height;
\tspec.wrapMode = normalizeRtWrapMode( spec.wrapMode );

\tlet rt = object.__fccRT;
\tif ( ! rt ) {

\t\trt = new THREE.WebGLRenderTarget( width, height, {
\t\t\tdepthBuffer: false,
\t\t\tstencilBuffer: false,
\t\t\tgenerateMipmaps: false,
\t\t\tminFilter: THREE.LinearFilter,
\t\t\tmagFilter: THREE.LinearFilter,
\t\t\tformat: THREE.RGBAFormat,
\t\t\ttype: THREE.UnsignedByteType,
\t\t\tcolorSpace: THREE.SRGBColorSpace,
\t\t} );
\t\trt.texture.premultipliedAlpha = false;
\t\tmarkRTTexture( object, rt.texture );
\t\tobject.__fccRT = rt;

\t} else if ( rt.width !== width || rt.height !== height ) {

\t\trt.setSize( width, height );
\t\tmarkRTTexture( object, rt.texture );

\t}

\tapplyRtTextureWrap( rt.texture, spec.wrapMode );
\treturn rt;

}

function getRenderTexture"""

if "applyRtTextureWrap( rt.texture" not in s:
    s2, n = ensure_pat.subn(ensure_new, s, count=1)
    if n != 1:
        raise SystemExit("ensureRenderTarget replace failed: %d" % n)
    s = s2

force_pat = re.compile(
    r"if \( slot\.key === 'uFccTex' && material\.uniforms\.uFccTexUse \) \{\s*"
    r"material\.uniforms\.uFccTexUse\.value = 1;\s*"
    r"if \( texture && texture\.isTexture \) \{\s*"
    r"texture\.wrapS = THREE\.RepeatWrapping;\s*"
    r"texture\.wrapT = THREE\.RepeatWrapping;\s*"
    r"\}\s*"
    r"\}"
)
force_new = """if ( slot.key === 'uFccTex' && material.uniforms.uFccTexUse ) {

\t\t\t\t\t\t\tmaterial.uniforms.uFccTexUse.value = 1;

\t\t\t\t\t\t}"""
s2, n = force_pat.subn(force_new, s, count=1)
print("force Repeat remove count", n)
s = s2 if n else s

if "normalizeRtWrapMode," not in s:
    s = s.replace(
        "ensureRenderTarget,\n\tgetRenderTexture,",
        "ensureRenderTarget,\n\tnormalizeRtWrapMode,\n\tapplyRtTextureWrap,\n\tgetRenderTexture,",
    )

write(rel, s)
print("FccVideo ok")
