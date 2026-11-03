const fs = require("fs");
const path = require("path");
// Use sucrase or @babel/parser if present
let parse;
try {
  parse = require("@babel/parser").parse;
} catch {
  try {
    const ts = require("typescript");
    for (const f of ["src/vfxpack/pack-video.ts", "src/vfxpack/text-template-media.ts"]) {
      const src = fs.readFileSync(f, "utf8");
      const r = ts.transpileModule(src, { compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.Preserve } });
      console.log(f, "transpile ok", r.outputText.length);
    }
    process.exit(0);
  } catch (e) {
    console.error("no parser", e.message);
    process.exit(1);
  }
}
for (const f of ["src/vfxpack/pack-video.ts", "src/vfxpack/text-template-media.ts"]) {
  const src = fs.readFileSync(f, "utf8");
  try {
    parse(src, { sourceType: "module", plugins: ["typescript"] });
    console.log(f, "parse ok");
  } catch (e) {
    console.error(f, "PARSE FAIL", e.message);
  }
}