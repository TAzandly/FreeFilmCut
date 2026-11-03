const fs = require("fs");
const path = require("path");
const { pathToFileURL } = require("url");
const p = "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/UIText.js";
const code = fs.readFileSync(p, "utf8");
// Syntax check as module via dynamic import of a data URL won't work for relative imports.
// Use acorn if available, else strip import/export and vm.Script.
let acorn;
try { acorn = require("acorn"); } catch (_) {}
if (!acorn) {
  try { acorn = require("D:/GrokbotWork/FreeFilmCut/three.js/editor/node_modules/acorn"); } catch (_) {}
}
if (acorn) {
  try {
    acorn.parse(code, { ecmaVersion: "latest", sourceType: "module" });
    console.log("ACORN_PARSE_OK");
  } catch (e) {
    console.log("ACORN_PARSE_FAIL", e.message);
  }
} else {
  // Fallback: look for bare GLSL keywords outside strings
  const i = code.indexOf("vertexDefs:");
  console.log("vertexDefs:", JSON.stringify(code.slice(i, i + 50)));
  const bare = /vertexDefs:\s*\r?\nvarying/.test(code);
  console.log("bare_vertexDefs=", bare);
  const hasTicks = /vertexDefs:\s*`/.test(code);
  console.log("has_backticks=", hasTicks);
}
// Also scan for other bare GLSL after property colon
const re = /(\w+):\s*\r?\n\s*(varying|uniform|vec2|vec3|vec4|float|void|if\s*\()/g;
let m;
while ((m = re.exec(code))) {
  console.log("SUSPECT_BARE", m[1], "at", m.index);
}
