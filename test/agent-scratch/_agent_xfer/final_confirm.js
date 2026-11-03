const fs = require("fs");
const sb = fs.readFileSync("D:/GrokbotWork/FreeFilmCut/freefilmcut/apps/web/src/vfxpack/scene-builder.ts", "utf8");
console.log("sb tick", /vertexDefs:\s*`/.test(sb));
console.log("sb bare", /vertexDefs:\s*\r?\nvarying/.test(sb));
const idx = fs.readFileSync("D:/GrokbotWork/FreeFilmCut/three.js/editor/index.html", "utf8");
const m1 = idx.match(/Editor\.js\?v=([^'"\s>]+)/);
const m2 = idx.match(/Sidebar\.js\?v=([^'"\s>]+)/);
console.log("Editor", m1 && m1[1]);
console.log("Sidebar", m2 && m2[1]);
