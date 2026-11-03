const fs = require("fs");
const ROOT = "D:/GrokbotWork/FreeFilmCut";
function read(p){ return fs.readFileSync(p,"utf8"); }
function write(p,s){ fs.writeFileSync(p,s,"utf8"); console.log("wrote", p); }

// flower-pack-catalog bindStyleToPackDir
{
  const p = ROOT + "/freefilmcut/apps/web/src/vfxpack/flower-pack-catalog.ts";
  let s = read(p);
  const nl = s.includes("\r\n") ? "\r\n" : "\n";
  const old = [
    "if (",
    "\t\t\tpath.startsWith(\"http\") ||",
    "\t\t\tpath.startsWith(\"blob:\") ||",
    "\t\t\tpath.startsWith(\"data:\") ||",
    "\t\t\tpath.startsWith(\"/\")",
    "\t\t) {",
    "\t\t\treturn c;",
    "\t\t}",
  ].join(nl);
  const neu = [
    "if (",
    "\t\t\tpath.startsWith(\"http\") ||",
    "\t\t\tpath.startsWith(\"blob:\") ||",
    "\t\t\tpath.startsWith(\"data:\") ||",
    "\t\t\tpath.startsWith(\"/\") ||",
    "\t\t\tpath.startsWith(\"rt:\")",
    "\t\t) {",
    "\t\t\treturn c;",
    "\t\t}",
  ].join(nl);
  if (!s.includes(old)) throw new Error("bindStyleToPackDir guard not found");
  s = s.replace(old, neu);
  write(p, s);
}

// flower-style.ts remapFlowerStyleTexturePathsForOpenCut
{
  const p = ROOT + "/freefilmcut/apps/web/src/vfxpack/flower-style.ts";
  let s = read(p);
  const nl = s.includes("\r\n") ? "\r\n" : "\n";
  const old = [
    "if (",
    "\t\t\tp.startsWith(\"http\") ||",
    "\t\t\tp.startsWith(\"blob:\") ||",
    "\t\t\tp.startsWith(\"data:\") ||",
    "\t\t\tp.startsWith(\"/\")",
    "\t\t) {",
    "\t\t\treturn c;",
    "\t\t}",
  ].join(nl);
  const neu = [
    "if (",
    "\t\t\tp.startsWith(\"http\") ||",
    "\t\t\tp.startsWith(\"blob:\") ||",
    "\t\t\tp.startsWith(\"data:\") ||",
    "\t\t\tp.startsWith(\"/\") ||",
    "\t\t\tp.startsWith(\"rt:\")",
    "\t\t) {",
    "\t\t\treturn c;",
    "\t\t}",
  ].join(nl);
  if (!s.includes(old)) {
    const i = s.indexOf("remapFlowerStyleTexturePathsForOpenCut");
    console.log(JSON.stringify(s.slice(i, i+500)));
    throw new Error("flower-style remap guard not found");
  }
  s = s.replace(old, neu);
  // comment at top
  if (!s.includes("rt:<uuid>")) {
    s = s.replace(
      " * texture.range: CapCut horizontal atlas strips (default 1); char i uses strip i%range.",
      " * texture.range: CapCut horizontal atlas strips (default 1); char i uses strip i%range.\n * texture.path may be a file URL/path or live RT ref `rt:<RenderTextureObjectUuid>` (MediaFrame GIF/seq/video)."
    );
  }
  write(p, s);
}

// Editor FlowerStyle.js collectFlowerTexturePaths — skip rt: for prefetch
{
  const p = ROOT + "/three.js/editor/js/ui/FlowerStyle.js";
  let s = read(p);
  const nl = s.includes("\r\n") ? "\r\n" : "\n";
  const old = [
    "if ( c.renderType === 'texture' && c.texture && c.texture.path ) {",
    "",
    "\t\t\tconst p = c.texture.path;",
    "\t\t\tif ( ! seen.has( p ) ) {",
  ].join(nl);
  const neu = [
    "if ( c.renderType === 'texture' && c.texture && c.texture.path ) {",
    "",
    "\t\t\tconst p = c.texture.path;",
    "\t\t\tif ( String( p ).startsWith( 'rt:' ) ) return;",
    "\t\t\tif ( ! seen.has( p ) ) {",
  ].join(nl);
  if (!s.includes(old)) {
    const i = s.indexOf("collectFlowerTexturePaths");
    console.log(JSON.stringify(s.slice(i, i+450)));
    throw new Error("collectFlowerTexturePaths not found");
  }
  s = s.replace(old, neu);
  write(p, s);
}

// Version bumps for importers
const bumps = [
  ["three.js/editor/js/Sidebar.Object.js", "Sidebar.Object.UI.js?v=fcc-ui-197", "Sidebar.Object.UI.js?v=fcc-ui-199"],
  ["three.js/editor/js/ui/UIFactory.js", "UIText.js?v=fcc-ui-197", "UIText.js?v=fcc-ui-199"],
  ["three.js/editor/js/ui/TextAnimRuntime.js", "UIText.js?v=fcc-ui-197", "UIText.js?v=fcc-ui-199"],
  ["three.js/editor/js/ui/TextGeomFx.js", "UIText.js?v=fcc-ui-197", "UIText.js?v=fcc-ui-199"],
  ["three.js/editor/js/ui/UIRectLayout.js", "UIText.js?v=fcc-ui-197", "UIText.js?v=fcc-ui-199"],
  ["three.js/editor/js/Editor.js", "UIText.js?v=fcc-ui-197", "UIText.js?v=fcc-ui-199"],
  ["three.js/editor/js/Menubar.File.js", "UIText.js?v=fcc-ui-197", "UIText.js?v=fcc-ui-199"],
];
for (const [rel, a, b] of bumps) {
  const p = ROOT + "/" + rel;
  let s = read(p);
  if (!s.includes(a) && s.includes(b)) { console.log("already", rel); continue; }
  if (!s.includes(a)) throw new Error("bump miss " + rel + " " + a);
  s = s.split(a).join(b);
  write(p, s);
}

console.log("catalog+bumps ok");
