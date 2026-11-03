const fs = require('fs');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js';
const buf = fs.readFileSync(p);
const t = buf.toString('utf8');
const lines = t.split(/\r?\n/);
console.log('lineCount', lines.length);
for (let i = 250; i < Math.min(280, lines.length); i++) {
  const L = lines[i];
  const bytes = Buffer.from(L, 'utf8');
  console.log('---', i+1, 'len', L.length);
  console.log(JSON.stringify(L));
  // show any non-ascii as hex
  let hex = '';
  for (let j=0;j<bytes.length;j++) {
    const c = bytes[j];
    if (c < 32 || c > 126) hex += bytes[j].toString(16).padStart(2,'0') + ' ';
  }
  if (hex) console.log('nonascii', hex.slice(0,200));
}

// raw search for 右
const yi = buf.indexOf(Buffer.from('右','utf8'));
console.log('first 右 at', yi);
if (yi>=0) console.log(JSON.stringify(buf.subarray(yi-30, yi+40).toString('utf8')));
// search for optionLabelsZh
const oi = t.indexOf('optionLabelsZh');
console.log('optionLabelsZh contexts:');
let idx = 0;
while ((idx = t.indexOf('optionLabelsZh', idx)) >= 0) {
  console.log(JSON.stringify(t.slice(idx, idx+120)));
  idx += 1;
}
