const fs = require('fs');
const vp = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js','utf8');
// find wipe / bloom / composer / UIComposite order clues
const keys = [
  'applyWipeReveal','textAnimWipe','UIComposite','EffectComposer','bloom','deepGlow','postProcess','feedUIComposite','presentComposer','RenderPass'
];
const lines = vp.split(/\r?\n/);
for (let i=0;i<lines.length;i++) {
  const L = lines[i];
  if (keys.some(k => L.includes(k)) && /wipe|Bloom|bloom|deepGlow|UIComposite|composer|RenderPass|applyWipe|feedUI|presentComposer|postProcess/i.test(L)) {
    if (/^\s*\/\//.test(L) && !/wipe|Bloom|UIComposite|composer/.test(L)) continue;
    console.log(String(i+1).padStart(5), L.trim().slice(0,140));
  }
}
