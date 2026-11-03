const fs = require('fs');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js';
const lines = fs.readFileSync(p,'utf8').split(/\r?\n/);
// find function applyWipeReveal and shader strings
for (let i=0;i<lines.length;i++) {
  if (/applyWipeReveal|fillMod|uProgress|edgeIntensity|blendMode|pow\(|smoothstep|gl_FragColor|revealed|uFill/.test(lines[i])) {
    console.log(String(i+1).padStart(4), lines[i]);
  }
}
