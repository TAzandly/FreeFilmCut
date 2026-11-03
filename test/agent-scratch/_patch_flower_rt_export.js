const fs = require("fs");
const ROOT = "D:/GrokbotWork/FreeFilmCut";
function read(p){ return fs.readFileSync(p,"utf8"); }
function write(p,s){ fs.writeFileSync(p,s,"utf8"); console.log("wrote", p); }

// 1) pack-video rebindPackRenderTextures — set uFccTexUse when binding uFccTex
{
  const p = ROOT + "/freefilmcut/apps/web/src/vfxpack/pack-video.ts";
  let s = read(p);
  const nl = s.includes("\r\n") ? "\r\n" : "\n";
  const old = [
    "if (shader.uniforms && shader.uniforms[slot.key]) {",
    "\t\t\t\t\tshader.uniforms[slot.key].value = texture;",
    "\t\t\t\t\tif (shader.uniforms.useMap) shader.uniforms.useMap.value = true;",
    "\t\t\t\t}",
  ].join(nl);
  const neu = [
    "if (shader.uniforms && shader.uniforms[slot.key]) {",
    "\t\t\t\t\tshader.uniforms[slot.key].value = texture;",
    "\t\t\t\t\tif (shader.uniforms.useMap) shader.uniforms.useMap.value = true;",
    "\t\t\t\t\t// Flower texture fill (uFccTex) may start with placeholder until RT is live.",
    "\t\t\t\t\tif (slot.key === \"uFccTex\" && shader.uniforms.uFccTexUse) {",
    "\t\t\t\t\t\tshader.uniforms.uFccTexUse.value = 1;",
    "\t\t\t\t\t}",
    "\t\t\t\t}",
  ].join(nl);
  if (!s.includes(old)) throw new Error("pack-video rebind block not found");
  s = s.replace(old, neu);
  write(p, s);
}

// 2) FlowerPackExporter — preserve rt: in embedTexture + absolutizeStylePaths
{
  const p = ROOT + "/three.js/editor/js/FlowerPackExporter.js";
  let s = read(p);
  const nl = s.includes("\r\n") ? "\r\n" : "\n";

  if (!s.includes("path.startsWith( 'rt:' )")) {
    const old = [
      "async function embedTexture( editor, zipRoot, path, preferredName, map, idxRef ) {",
      "",
      "\tif ( ! path || typeof path !== 'string' ) return '';",
      "\tif ( map.has( path ) ) return map.get( path );",
    ].join(nl);
    const neu = [
      "async function embedTexture( editor, zipRoot, path, preferredName, map, idxRef ) {",
      "",
      "\tif ( ! path || typeof path !== 'string' ) return '';",
      "\tif ( map.has( path ) ) return map.get( path );",
      "\t// Live RenderTexture ref — keep as rt:<uuid>, do not rasterize.",
      "\tif ( path.startsWith( 'rt:' ) ) {",
      "\t\tmap.set( path, path );",
      "\t\treturn path;",
      "\t}",
    ].join(nl);
    if (!s.includes(old)) throw new Error("FlowerPackExporter embedTexture header not found");
    s = s.replace(old, neu);
  }

  const absOld = [
    "const p = String( content.texture.path );",
    "\t\t\tif ( ! p.startsWith( '/' ) && ! p.startsWith( 'http' ) && ! p.startsWith( 'blob:' ) ) {",
    "\t\t\t\tcontent.texture.path = prefix + p.replace( /^\\/+/, '' );",
    "\t\t\t}",
  ].join(nl);
  const absNew = [
    "const p = String( content.texture.path );",
    "\t\t\tif ( p.startsWith( 'rt:' ) ) return;",
    "\t\t\tif ( ! p.startsWith( '/' ) && ! p.startsWith( 'http' ) && ! p.startsWith( 'blob:' ) ) {",
    "\t\t\t\tcontent.texture.path = prefix + p.replace( /^\\/+/, '' );",
    "\t\t\t}",
  ].join(nl);
  if (!s.includes(absOld)) {
    // show context
    const i = s.indexOf("content.texture.path");
    console.log("abs ctx", JSON.stringify(s.slice(i, i+200)));
    throw new Error("absolutizeStylePaths guard not found");
  }
  s = s.replace(absOld, absNew);
  write(p, s);
}

// 3) TextTemplatePackExporter embedOne — early rt: keep
{
  const p = ROOT + "/three.js/editor/js/TextTemplatePackExporter.js";
  let s = read(p);
  const nl = s.includes("\r\n") ? "\r\n" : "\n";
  // There may be multiple embedOne — patch flower one specifically by unique nearby comment or both
  const old = [
    "async function embedOne( path, preferredName ) {",
    "",
    "\t\tif ( ! path || typeof path !== 'string' ) return '';",
    "\t\tif ( map.has( path ) ) return map.get( path );",
    "\t\tif ( path.startsWith( 'textures/' ) ) {",
  ].join(nl);
  const neu = [
    "async function embedOne( path, preferredName ) {",
    "",
    "\t\tif ( ! path || typeof path !== 'string' ) return '';",
    "\t\tif ( map.has( path ) ) return map.get( path );",
    "\t\tif ( path.startsWith( 'rt:' ) ) {",
    "\t\t\tmap.set( path, path );",
    "\t\t\treturn path;",
    "\t\t}",
    "\t\tif ( path.startsWith( 'textures/' ) ) {",
  ].join(nl);
  if (!s.includes(old)) {
    // try without double blank
    const i = s.indexOf("async function embedOne( path, preferredName )");
    console.log(JSON.stringify(s.slice(i, i+220)));
    throw new Error("TextTemplatePackExporter embedOne not found");
  }
  // replace all occurrences of this pattern (flower + maybe stickers share)
  const count = s.split(old).length - 1;
  s = s.split(old).join(neu);
  console.log("TextTemplate embedOne patches", count);
  write(p, s);
}

// 4) VfxPackExporter flower rewrite — preserve rt:
{
  const p = ROOT + "/three.js/editor/js/VfxPackExporter.js";
  let s = read(p);
  const nl = s.includes("\r\n") ? "\r\n" : "\n";
  // Find flower-style rewriteContent that embeds texture.path
  const needle = "if ( rt === 'texture' && c.texture && c.texture.path ) {\n\t\t\tconst rel = await embedOne( c.texture.path";
  // CRLF aware
  const marker = "c.texture.path = rel;";
  // Add guard before embed in rewriteContent for flower - look for unique block
  const block = [
    "if ( rt === 'texture' && c.texture && c.texture.path ) {",
    "\t\t\tconst rel = await embedOne( c.texture.path, c.texture.fileName || c.texture.name || '' );",
    "\t\t\tc.texture.path = rel;",
    "\t\t}",
  ].join(nl);
  const blockNew = [
    "if ( rt === 'texture' && c.texture && c.texture.path ) {",
    "\t\t\tif ( String( c.texture.path ).startsWith( 'rt:' ) ) {",
    "\t\t\t\t/* keep live RT ref */",
    "\t\t\t} else {",
    "\t\t\t\tconst rel = await embedOne( c.texture.path, c.texture.fileName || c.texture.name || '' );",
    "\t\t\t\tc.texture.path = rel;",
    "\t\t\t}",
    "\t\t}",
  ].join(nl);
  if (!s.includes(block)) {
    const i = s.indexOf("c.texture.fileName || c.texture.name");
    console.log("vfx", JSON.stringify(s.slice(i-80, i+120)));
    throw new Error("VfxPackExporter flower rewrite block not found");
  }
  s = s.split(block).join(blockNew);
  write(p, s);
}

console.log("exporters ok");
