const fs = require("fs");
const { spawnSync } = require("child_process");
// Use node --experimental-vm-modules or just transform: remove import/export lines and parse
const p = "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/UIText.js";
let code = fs.readFileSync(p, "utf8");
// Strip import/export for syntax-only check of body
const stripped = code
  .replace(/^import\s+[\s\S]*?from\s+['"][^'"]+['"];?\s*$/gm, "")
  .replace(/^export\s+\{[\s\S]*?\};?\s*$/gm, "")
  .replace(/^export\s+(async\s+)?function\s+/gm, "function ")
  .replace(/^export\s+(const|let|var|class)\s+/gm, "$1 ");
const vm = require("vm");
try {
  new vm.Script(stripped, { filename: "UIText.js" });
  console.log("PARSE_OK");
} catch (e) {
  console.log("PARSE_FAIL", e.message);
  // print line context
  const m = /UIText\.js:(\d+)/.exec(e.stack || "");
  if (m) {
    const lines = stripped.split(/\n/);
    const n = Number(m[1]) - 1;
    console.log("around:", lines.slice(Math.max(0,n-2), n+3).join("\n"));
  }
}
