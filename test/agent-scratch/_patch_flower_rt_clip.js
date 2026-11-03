const fs = require("fs");
const ROOT = "D:/GrokbotWork/FreeFilmCut";
function read(p){ return fs.readFileSync(p,"utf8"); }
function write(p,s){ fs.writeFileSync(p,s,"utf8"); console.log("wrote", p); }

const p = ROOT + "/freefilmcut/apps/web/src/vfxpack/scene-builder.ts";
let s = read(p);
const nl = s.includes("\r\n") ? "\r\n" : "\n";

const start = s.indexOf("const loadFlowerTex = (");
if (start < 0) throw new Error("loadFlowerTex not found");
const end = s.indexOf("const tuneMaterial = (", start);
if (end < 0) throw new Error("tuneMaterial after loadFlowerTex not found");

const loadNew = [
  "const resolveFlowerRtTex = (rtPath: string): THREE.Texture | null => {",
  "\tif (!rtPath.startsWith(\"rt:\")) return null;",
  "\tconst uuid = rtPath.slice(3);",
  "\tif (!uuid) return null;",
  "\tconst obj = objectsByUuid.get(uuid);",
  "\tif (!obj) return null;",
  "\tconst rt = (obj.userData as { __fccRT?: THREE.WebGLRenderTarget }).__fccRT;",
  "\treturn rt?.texture || null;",
  "};",
  "",
  "const stampFlowerTexRtSlot = (",
  "\tmaterial: THREE.Material | null | undefined,",
  "\ttexPath: string,",
  ") => {",
  "\tif (!material) return;",
  "\tmaterial.userData = material.userData || {};",
  "\tif (texPath.startsWith(\"rt:\")) {",
  "\t\t(material.userData as { fccRtSlots?: Array<{ key: string; uuid: string }> }).fccRtSlots = [",
  "\t\t\t{ key: \"uFccTex\", uuid: texPath.slice(3) },",
  "\t\t];",
  "\t} else if ((material.userData as { fccRtSlots?: unknown }).fccRtSlots) {",
  "\t\tdelete (material.userData as { fccRtSlots?: unknown }).fccRtSlots;",
  "\t}",
  "};",
  "",
  "const loadFlowerTex = (",
  "\tpath: string,",
  "\tcb: (tex: THREE.Texture | null) => void,",
  ") => {",
  "\tif (!path) {",
  "\t\tcb(null);",
  "\t\treturn;",
  "\t}",
  "\tif (path.startsWith(\"rt:\")) {",
  "\t\tcb(resolveFlowerRtTex(path));",
  "\t\treturn;",
  "\t}",
  "\tconst url = resolveFlowerTextureUrl(path);",
  "\tif (!url) {",
  "\t\tcb(null);",
  "\t\treturn;",
  "\t}",
  "\tif (flowerTexCache.has(url)) {",
  "\t\tcb(flowerTexCache.get(url) || null);",
  "\t\treturn;",
  "\t}",
  "\tflowerTexLoader.load(",
  "\t\turl,",
  "\t\t(tex) => {",
  "\t\t\ttex.colorSpace = THREE.SRGBColorSpace;",
  "\t\t\ttex.wrapS = THREE.RepeatWrapping;",
  "\t\t\ttex.wrapT = THREE.RepeatWrapping;",
  "\t\t\ttex.needsUpdate = true;",
  "\t\t\tflowerTexCache.set(url, tex);",
  "\t\t\tcb(tex);",
  "\t\t},",
  "\t\tundefined,",
  "\t\t() => cb(null),",
  "\t);",
  "};",
  "",
  "",
].join(nl) + nl;

s = s.slice(0, start) + loadNew + s.slice(end);

const oldChunk = [
  "if (!path) {",
  "\t\t\t\t\t\tapplyWithMap(null);",
  "\t\t\t\t\t\treturn;",
  "\t\t\t\t\t}",
  "\t\t\t\t\tloadFlowerTex(path, (map) => applyWithMap(map));",
].join(nl);

const newTail = [
  "const finishTex = (map: THREE.Texture | null) => {",
  "\t\t\t\t\t\tif (!map && path.startsWith(\"rt:\")) {",
  "\t\t\t\t\t\t\tconst ph = new THREE.DataTexture(",
  "\t\t\t\t\t\t\t\tnew Uint8Array([255, 255, 255, 255]),",
  "\t\t\t\t\t\t\t\t1,",
  "\t\t\t\t\t\t\t\t1,",
  "\t\t\t\t\t\t\t);",
  "\t\t\t\t\t\t\tph.needsUpdate = true;",
  "\t\t\t\t\t\t\tph.colorSpace = THREE.SRGBColorSpace;",
  "\t\t\t\t\t\t\tapplyWithMap(ph);",
  "\t\t\t\t\t\t\tconst face = resolveTroikaFaceMaterial(troika);",
  "\t\t\t\t\t\t\tstampFlowerTexRtSlot(face, path);",
  "\t\t\t\t\t\t\tconst ud = face?.userData as",
  "\t\t\t\t\t\t\t\t| { fccTextureUniforms?: { uFccTexUse: { value: number } } }",
  "\t\t\t\t\t\t\t\t| undefined;",
  "\t\t\t\t\t\t\tif (ud?.fccTextureUniforms) ud.fccTextureUniforms.uFccTexUse.value = 0;",
  "\t\t\t\t\t\t\treturn;",
  "\t\t\t\t\t\t}",
  "\t\t\t\t\t\tapplyWithMap(map);",
  "\t\t\t\t\t\tstampFlowerTexRtSlot(resolveTroikaFaceMaterial(troika), path);",
  "\t\t\t\t\t};",
  "",
  "\t\t\t\t\tif (!path) {",
  "\t\t\t\t\t\tapplyWithMap(null);",
  "\t\t\t\t\t\treturn;",
  "\t\t\t\t\t}",
  "\t\t\t\t\tloadFlowerTex(path, (map) => finishTex(map));",
].join(nl);

if (!s.includes(oldChunk)) {
  const i = s.indexOf("loadFlowerTex(path, (map) => applyWithMap(map));");
  console.log("nearby", JSON.stringify(s.slice(i-100, i+60)));
  throw new Error("oldChunk not found");
}
s = s.replace(oldChunk, newTail);

s = s.replace(
  "sigRev: 30, // fcc-tl-flower-33: texture.range CapCut atlas strips",
  "sigRev: 31, // fcc-tl-flower-34: flower texture rt:<uuid> MediaFrame RT"
);

write(p, s);
console.log("scene-builder ok", s.includes("resolveFlowerRtTex"), s.includes("finishTex"));
