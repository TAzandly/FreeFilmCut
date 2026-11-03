const fs = require("fs");
const checks = [
  ["Sidebar", "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Sidebar.Object.UI.js", ["listRenderTextureOptions", "rt:", "RT"]],
  ["UIText", "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/UIText.js", ["isFlowerRtPath", "stampFlowerTexRtSlot", "finishTex", "textureForRenderTextureUuid"]],
  ["scene-builder", "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/scene-builder.ts", ["resolveFlowerRtTex", "stampFlowerTexRtSlot", "finishTex", "sigRev: 31"]],
  ["pack-video", "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/pack-video.ts", ["uFccTexUse"]],
  ["FlowerPackExporter", "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/FlowerPackExporter.js", ["rt:"]],
  ["catalog", "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/flower-pack-catalog.ts", ['startsWith("rt:")']],
  ["flower-style", "D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/flower-style.ts", ['startsWith("rt:")']],
  ["FccVideo", "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/media/FccVideo.js", ["fccRtSlots", "uFccTexUse"]],
  ["TextTemplatePack", "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/TextTemplatePackExporter.js", ["startsWith( 'rt:' )"]],
];
for (const [name, p, need] of checks) {
  const s = fs.readFileSync(p, "utf8");
  const miss = need.filter((n) => !s.includes(n));
  console.log(miss.length ? "FAIL " + name + ": " + miss.join(",") : "OK " + name);
}
