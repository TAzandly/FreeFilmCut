const fs = require("fs");
const vm = require("vm");
const p = "D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/UIText.js";
const code = fs.readFileSync(p, "utf8");
const start = code.indexOf("function applyGradientMaterial");
const end = code.indexOf("function applyContentToTroika");
const block = code.slice(start, end);
// wrap as function body check - extract the createDerivedMaterial call args
const i = block.indexOf("derived = createDerivedMaterial");
const snippet = block.slice(i, i + 1200);
console.log("---createDerivedMaterial call head---");
console.log(snippet.slice(0, 400));
console.log("---json check backticks---");
console.log("vertexDefs tick?", /vertexDefs:\s*`/.test(block));
console.log("vertexTransform tick?", /vertexTransform:\s*`/.test(block));
console.log("fragmentDefs tick?", /fragmentDefs:\s*`/.test(block));
console.log("fragmentColorTransform tick?", /fragmentColorTransform:\s*`/.test(block));
// Parse just the object literal by constructing a fake assignment
const objStart = block.indexOf("createDerivedMaterial( baseMat, {");
const objEnd = block.indexOf("} );", objStart);
const objLit = block.slice(objStart + "createDerivedMaterial( baseMat, ".length, objEnd + 1);
try {
  new vm.Script("(" + objLit + ")", { filename: "grad-opts.js" });
  console.log("GRAD_OPTS_PARSE_OK");
} catch (e) {
  console.log("GRAD_OPTS_PARSE_FAIL", e.message);
}
