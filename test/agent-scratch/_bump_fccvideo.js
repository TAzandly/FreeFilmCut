const fs = require("fs");
const ROOT = "D:/GrokbotWork/FreeFilmCut/three.js/editor/js";
const files = [
  "Viewport.js",
  "Sidebar.Object.UI.js",
  "ui/UIText.js",
  "preview/PreviewCapture.js",
  "Sidebar.Object.Media.js",
  "Menubar.Add.js",
  "Menubar.File.js",
  "Editor.js",
  "timeline/FccTimelineEditor.js",
];
for (const rel of files) {
  const p = ROOT + "/" + rel;
  let s = fs.readFileSync(p, "utf8");
  const before = s;
  s = s.replace(/FccVideo\.js\?v=fcc-ui-\d+/g, "FccVideo.js?v=fcc-ui-199");
  if (s !== before) {
    fs.writeFileSync(p, s);
    console.log("bumped", rel);
  } else {
    console.log("no FccVideo import?", rel);
  }
}
