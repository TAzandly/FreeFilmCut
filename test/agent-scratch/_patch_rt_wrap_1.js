const fs = require('fs');
const path = require('path');

const ROOT = 'D:/GrokbotWork/FreeFilmCut';

function read(p) { return fs.readFileSync(p, 'utf8'); }
function write(p, s) { fs.writeFileSync(p, s, 'utf8'); console.log('wrote', p); }

// ---------- FccVideo.js ----------
{
  const p = path.join(ROOT, 'three.js/editor/js/media/FccVideo.js');
  let s = read(p);

  if (!s.includes('function normalizeRtWrapMode')) {
    const anchor = 'const RT_KEY = \'fccRenderTexture\';';
    const helpers = const RT_KEY = 'fccRenderTexture';

/** RT wrapMode strings → Three.js wrapping (S and T share one mode). Default clamp. */
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
;
    if (!s.includes(anchor)) throw new Error('RT_KEY anchor missing');
    s = s.replace(anchor, helpers);
  }

  s = s.replace(
    "object.userData[ RT_KEY ] = { width: 512, height: 512 };",
    "object.userData[ RT_KEY ] = { width: 512, height: 512, wrapMode: 'clamp' };"
  );

  // ensureRenderTarget: apply wrap after create / resize / every call
  if (!s.includes('applyRtTextureWrap( rt.texture')) {
    const ensureFn = /function ensureRenderTarget\( object \) \{[\s\S]*?\n\}\n\nfunction getRenderTexture/;
    const m = s.match(ensureFn);
    if (!m) throw new Error('ensureRenderTarget not found');
    const replacement = unction ensureRenderTarget( object ) {

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

function getRenderTexture;
    s = s.replace(ensureFn, replacement);
  }

  // Remove force Repeat on uFccTex rebind
  s = s.replace(
    /if \( slot\.key === 'uFccTex' && material\.uniforms\.uFccTexUse \) \{\s*material\.uniforms\.uFccTexUse\.value = 1;\s*if \( texture && texture\.isTexture \) \{\s*texture\.wrapS = THREE\.RepeatWrapping;\s*texture\.wrapT = THREE\.RepeatWrapping;\s*\}\s*\}/m,
    if ( slot.key === 'uFccTex' && material.uniforms.uFccTexUse ) {

\t\t\t\t\t\t\tmaterial.uniforms.uFccTexUse.value = 1;

\t\t\t\t\t\t}
  );

  // exports
  if (!s.includes('normalizeRtWrapMode,')) {
    s = s.replace(
      'ensureRenderTarget,\n\tgetRenderTexture,',
      'ensureRenderTarget,\n\tnormalizeRtWrapMode,\n\tapplyRtTextureWrap,\n\tgetRenderTexture,'
    );
  }

  write(p, s);
}

// ---------- Sidebar.Object.Media.js ----------
{
  const p = path.join(ROOT, 'three.js/editor/js/Sidebar.Object.Media.js');
  let s = read(p);
  s = s.replace(/FccVideo\.js\?v=fcc-ui-200/g, 'FccVideo.js?v=fcc-ui-201');

  if (!s.includes('rtWrapRow')) {
    s = s.replace(
      container.add( rtSizeRow );

\tconst kindRow = new UIRow();,
      container.add( rtSizeRow );

\tconst rtWrapRow = new UIRow();
\trtWrapRow.add( new UIText( isZh ? '采样' : 'Wrap' ).setClass( 'Label' ) );
\tconst rtWrapSelect = new UISelect().setWidth( '140px' ).setOptions( {
\t\tclamp: 'Clamp',
\t\trepeat: 'Repeat',
\t\tmirroredRepeat: 'Mirrored Repeat',
\t} ).onChange( onWrapChange );
\trtWrapRow.add( rtWrapSelect );
\tcontainer.add( rtWrapRow );

\tconst kindRow = new UIRow();
    );

    s = s.replace(
      tWidth.onChange( onSizeChange );
\trtHeight.onChange( onSizeChange );

\tfunction onKindChange(),
      tWidth.onChange( onSizeChange );
\trtHeight.onChange( onSizeChange );

\tfunction onWrapChange() {

\t\tif ( ! isFccRenderTexture( object ) ) return;
\t\tconst spec = object.userData[ RT_KEY ];
\t\tspec.wrapMode = rtWrapSelect.getValue() || 'clamp';
\t\tensureRenderTarget( object );
\t\tsignals.objectChanged.dispatch( object );
\t\tsignals.sceneGraphChanged.dispatch();

\t}

\tfunction onKindChange()
    );

    s = s.replace(
      tSizeRow.setDisplay( showRT ? '' : 'none' );
\t\tkindRow.setDisplay( showVP ? '' : 'none' );,
      tSizeRow.setDisplay( showRT ? '' : 'none' );
\t\trtWrapRow.setDisplay( showRT ? '' : 'none' );
\t\tkindRow.setDisplay( showVP ? '' : 'none' );
    );

    s = s.replace(
      const spec = object.userData[ RT_KEY ];
\t\t\trtWidth.setValue( spec.width || 512 );
\t\t\trtHeight.setValue( spec.height || 512 );
\t\t\tensureRenderTarget( object );,
      const spec = object.userData[ RT_KEY ];
\t\t\trtWidth.setValue( spec.width || 512 );
\t\t\trtHeight.setValue( spec.height || 512 );
\t\t\tif ( ! spec.wrapMode ) spec.wrapMode = 'clamp';
\t\t\trtWrapSelect.setValue( spec.wrapMode );
\t\t\tensureRenderTarget( object );
    );
  }

  write(p, s);
}

console.log('part1 ok');
