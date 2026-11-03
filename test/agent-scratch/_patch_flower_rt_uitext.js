const fs = require("fs");
const ROOT = "D:/GrokbotWork/FreeFilmCut";
function read(p){ return fs.readFileSync(p,"utf8"); }
function write(p,s){ fs.writeFileSync(p,s,"utf8"); console.log("wrote", p); }

const p = ROOT + "/three.js/editor/js/ui/UIText.js";
let s = read(p);
const nl = s.includes("\r\n") ? "\r\n" : "\n";

s = s.replace(/from '\.\/FlowerStyle\.js\?v=fcc-ui-\d+'/g, "from './FlowerStyle.js?v=fcc-ui-199'");

if (!s.includes("textureForRenderTextureUuid")) {
  s = s.replace(
    "from './FlowerStyle.js?v=fcc-ui-199';",
    "from './FlowerStyle.js?v=fcc-ui-199';" + nl + "import { textureForRenderTextureUuid } from '../media/FccVideo.js?v=fcc-ui-190';"
  );
}

const start = s.indexOf("function loadFlowerTexture( path, onReady ) {");
if (start < 0) throw new Error("loadFlowerTexture not found");
const end = s.indexOf("function hookFccStrokeExpandVertex( vertexShader ) {", start);
if (end < 0) throw new Error("hookFccStrokeExpandVertex not found");
let keepFrom = end;
const doc = s.lastIndexOf("/**", end);
if (doc > start) keepFrom = doc;

const L = (lines) => lines.join(nl) + nl;

const loadNew = L([
"function isFlowerRtPath( path ) {",
"",
"\treturn typeof path === 'string' && path.startsWith( 'rt:' );",
"",
"}",
"",
"function resolveFlowerRtTexture( path ) {",
"",
"\tif ( ! isFlowerRtPath( path ) ) return null;",
"\tconst uuid = path.slice( 3 );",
"\tif ( ! uuid ) return null;",
"\tconst ed = typeof window !== 'undefined' ? window.editor : null;",
"\tif ( ! ed ) return null;",
"\treturn textureForRenderTextureUuid( ed, uuid );",
"",
"}",
"",
"function stampFlowerTexRtSlot( material, path ) {",
"",
"\tif ( ! material ) return;",
"\tmaterial.userData = material.userData || {};",
"\tif ( isFlowerRtPath( path ) ) {",
"",
"\t\tmaterial.userData.fccRtSlots = [ { key: 'uFccTex', uuid: path.slice( 3 ) } ];",
"",
"\t} else if ( material.userData.fccRtSlots ) {",
"",
"\t\tdelete material.userData.fccRtSlots;",
"",
"\t}",
"",
"}",
"",
"function loadFlowerTexture( path, onReady ) {",
"",
"\tif ( ! path ) {",
"\t\tonReady( null );",
"\t\treturn;",
"\t}",
"\t// Live MediaFrame RT — always resolve (do not TextureLoader / static-cache).",
"\tif ( isFlowerRtPath( path ) ) {",
"\t\tconst live = resolveFlowerRtTexture( path );",
"\t\tonReady( live || null );",
"\t\treturn;",
"\t}",
"\tif ( _fccTexCache.has( path ) ) {",
"\t\tonReady( _fccTexCache.get( path ) );",
"\t\treturn;",
"\t}",
"\t_fccTexLoader.load(",
"\t\tpath,",
"\t\t( tex ) => {",
"\t\t\ttex.colorSpace = THREE.SRGBColorSpace;",
"\t\t\ttex.wrapS = THREE.RepeatWrapping;",
"\t\t\ttex.wrapT = THREE.RepeatWrapping;",
"\t\t\ttex.needsUpdate = true;",
"\t\t\t_fccTexCache.set( path, tex );",
"\t\t\tonReady( tex );",
"\t\t},",
"\t\tundefined,",
"\t\t( err ) => {",
"\t\t\tconsole.warn( '[FreeFilmCut] flower texture load failed', path, err );",
"\t\t\tonReady( null );",
"\t\t},",
"\t);",
"",
"}",
"",
"",
]);
s = s.slice(0, start) + loadNew + s.slice(keepFrom);

const applyIdx = s.indexOf("function applyTextureMaterial( troika, content, opacity, mode, contentExpand ) {");
if (applyIdx < 0) throw new Error("applyTextureMaterial not found");
const nextFn = s.indexOf(nl + "function applyGradientMaterial(", applyIdx);
if (nextFn < 0) throw new Error("applyGradientMaterial not found");
let block = s.slice(applyIdx, nextFn);

const needle = L([
"\tloadFlowerTexture( path, ( map ) => {",
"\t\tapplyWithMap( map );",
"\t} );",
]).trimEnd() + nl;

const nIdx = block.lastIndexOf(needle);
if (nIdx < 0) {
  // try without assuming exact tabs
  const alt = block.lastIndexOf("loadFlowerTexture( path,");
  console.log("alt", alt, JSON.stringify(block.slice(alt, alt+120)));
  throw new Error("loadFlowerTexture call not found");
}

const oldChunkStart = block.lastIndexOf("if ( ! path ) {", nIdx);
if (oldChunkStart < 0) throw new Error("if (!path) not found");

const newTail = L([
"\tconst finishTex = ( map ) => {",
"",
"\t\t// RT path: still build texture wrap even if live RT not ready yet (rebind fills uFccTex).",
"\t\tif ( ! map && isFlowerRtPath( path ) ) {",
"",
"\t\t\tconst ph = new THREE.DataTexture( new Uint8Array( [ 255, 255, 255, 255 ] ), 1, 1 );",
"\t\t\tph.needsUpdate = true;",
"\t\t\tph.colorSpace = THREE.SRGBColorSpace;",
"\t\t\tapplyWithMap( ph );",
"\t\t\tconst face = resolveTroikaFaceMaterial( troika );",
"\t\t\tstampFlowerTexRtSlot( face, path );",
"\t\t\tif ( face && face.userData && face.userData.fccTextureUniforms ) {",
"\t\t\t\tface.userData.fccTextureUniforms.uFccTexUse.value = 0;",
"\t\t\t}",
"\t\t\treturn;",
"",
"\t\t}",
"\t\tapplyWithMap( map );",
"\t\tconst face = resolveTroikaFaceMaterial( troika );",
"\t\tstampFlowerTexRtSlot( face, path );",
"",
"\t};",
"",
"\tif ( ! path ) {",
"\t\tapplyWithMap( null );",
"\t\treturn;",
"\t}",
"\tloadFlowerTexture( path, ( map ) => {",
"\t\tfinishTex( map );",
"\t} );",
"",
]);

let replaceEnd = nIdx + needle.length;
block = block.slice(0, oldChunkStart) + newTail + block.slice(replaceEnd);
s = s.slice(0, applyIdx) + block + s.slice(nextFn);

s = s.replace(
  "sdfMargin: 0.25, // fcc-ui-198 texture.range CapCut atlas strips",
  "sdfMargin: 0.25, // fcc-ui-199 flower texture rt:<uuid> + range"
);

write(p, s);
console.log("UIText ok");
