const fs = require('fs');
const ta = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextAnim.js','utf8');
const i = ta.indexOf('export function sampleWipeRevealProgress');
console.log(ta.slice(i, i+1200));
console.log('\n--- Engine resolve ---');
const eng = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimEngine.js','utf8');
for (const key of ['resolvePass','kind: \'wipe\'','wipe']) {
  let from=0, n=0;
  while ((from = eng.indexOf(key, from))>=0 && n<5) {
    console.log('ENG', key, JSON.stringify(eng.slice(from, from+200)));
    from++; n++;
  }
}
// How wipe info object is built in Viewport around 1795
const vp = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js','utf8');
const j = vp.indexOf('sampleWipeRevealProgress');
// find function containing it
const k = vp.lastIndexOf('function', j);
console.log('\n--- Viewport wipe helper ---');
console.log(vp.slice(k, k+900));
