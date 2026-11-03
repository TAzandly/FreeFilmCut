const fs = require("fs");
const f = "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/services/renderer/compositor/three-compositor.ts";
let s = fs.readFileSync(f, "utf8");
const NL = s.includes("\r\n") ? "\r\n" : "\n";

// Fix mis-indented revive if
const bad =
  "\t\t\t// fcc-tl-flower-60: revive ::embedded-textanim after refresh (virtual pack not persisted)." + NL +
  "\t\tif (!pack && typeof packId === \"string\" && packId.endsWith(\"::embedded-textanim\")) {" + NL +
  "\t\t\t\tconst parentId = packId.slice(0, -\"::embedded-textanim\".length);" + NL +
  "\t\t\t\tconst parent = getPackRegistrySnapshot().packs.find((entry) => entry.id === parentId);" + NL +
  "\t\t\t\tif (parent && normalizeVfxPackType(parent.type) === \"text-template\") {" + NL +
  "\t\t\t\t\tensureEmbeddedTextAnimFromTemplatePack(parent);" + NL +
  "\t\t\t\t\tpack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);" + NL +
  "\t\t\t\t}" + NL +
  "\t\t\t}" + NL;
const good =
  "\t\t\t// fcc-tl-flower-60: revive ::embedded-textanim after refresh (virtual pack not persisted)." + NL +
  "\t\t\tif (!pack && typeof packId === \"string\" && packId.endsWith(\"::embedded-textanim\")) {" + NL +
  "\t\t\t\tconst parentId = packId.slice(0, -\"::embedded-textanim\".length);" + NL +
  "\t\t\t\tconst parent = getPackRegistrySnapshot().packs.find((entry) => entry.id === parentId);" + NL +
  "\t\t\t\tif (parent && normalizeVfxPackType(parent.type) === \"text-template\") {" + NL +
  "\t\t\t\t\tensureEmbeddedTextAnimFromTemplatePack(parent);" + NL +
  "\t\t\t\t\tpack = getPackRegistrySnapshot().packs.find((entry) => entry.id === packId);" + NL +
  "\t\t\t\t}" + NL +
  "\t\t\t}" + NL;
if (!s.includes(bad)) {
  console.log("indent already ok or different");
  // dump current
  const i = s.indexOf("fcc-tl-flower-60: revive");
  console.log(JSON.stringify(s.slice(i-20, i+450)));
} else {
  s = s.replace(bad, good);
  fs.writeFileSync(f, s);
  console.log("fixed indent");
}

// Show rehydrate block
const j = s.indexOf("fcc-tl-flower-60: rehydrate");
console.log("---rehydrate---");
console.log(s.slice(j, j+700));

// Verify versions
const tl = fs.readFileSync("D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/timeline-flower-text.ts","utf8");
const sb = fs.readFileSync("D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/scene-builder.ts","utf8");
console.log("rev", /rev: \d+/.exec(tl)?.[0], "sigRev", /sigRev: \d+/.exec(sb)?.[0]);

// Ensure pack-registry exports onPackRegistered from index if needed
let idx = fs.readFileSync("D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/index.ts","utf8");
console.log("index has onPackRegistered", idx.includes("onPackRegistered"));
console.log("index has ensure", idx.includes("ensureEmbeddedTextAnimFromTemplatePack"));
