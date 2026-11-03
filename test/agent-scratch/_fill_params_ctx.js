const fs = require('fs');
const builtins = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js';
const tl = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js';
const vp = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js';

// Show wipeReveal params block and where applyWipeReveal is called
const b = fs.readFileSync(builtins,'utf8').split(/\r?\n/);
for (let i=250;i<310;i++) console.log('B', i+1, b[i]);

const v = fs.readFileSync(vp,'utf8');
const idx = v.indexOf('applyWipeReveal');
console.log('\n--- applyWipeReveal call sites ---');
let from = 0;
while ((from = v.indexOf('applyWipeReveal', from)) >= 0) {
  console.log(JSON.stringify(v.slice(from, from+500)));
  from += 1;
}

const t = fs.readFileSync(tl,'utf8');
console.log('\n--- applyWipeReveal signature area ---');
const a = t.indexOf('export function applyWipeReveal');
console.log(t.slice(a, a+900));
