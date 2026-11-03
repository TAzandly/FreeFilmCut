const fs = require("fs");
const vm = require("vm");
const p = "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/UIText.js";
const code = fs.readFileSync(p, "utf8");
const i = code.indexOf("vertexDefs:");
console.log("vertexDefs snippet:", JSON.stringify(code.slice(i, i + 80)));
try {
  new vm.Script(code, { filename: "UIText.js" });
  console.log("PARSE_OK");
} catch (e) {
  console.log("PARSE_FAIL", e.message);
}
