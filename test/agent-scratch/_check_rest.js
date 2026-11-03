const fs = require('fs');
const path = require('path');

// Korean ? false positive confirm
const s = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Strings.js');
for (const i of [132217,133012,133069,133179]) {
  console.log('KO', s.subarray(i-40,i+5).toString('utf8'));
}

// VfxPackExporter contexts as utf8
const v = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/VfxPackExporter.js');
for (const i of [45598,46437,46656]) {
  console.log('VFX', JSON.stringify(v.subarray(i-60,i+40).toString('utf8')));
}

// find script tags / imports for textanim cache
const editorRoot = 'D:/GrokbotWork/FreeFilmCut/three.js/editor';
function grep(dir, re, max=30) {
  const out = [];
  function walk(d) {
    for (const name of fs.readdirSync(d)) {
      const p = path.join(d, name);
      const st = fs.statSync(p);
      if (st.isDirectory()) {
        if (['node_modules','libs','build'].includes(name)) continue;
        walk(p);
      } else if (/\.(html|js)$/.test(name)) {
        const t = fs.readFileSync(p,'utf8');
        if (re.test(t)) {
          for (const m of t.matchAll(new RegExp(re.source, 'g'))) {
            out.push(p.replace(/\\/g,'/') + ' :: ' + m[0].slice(0,120));
            if (out.length >= max) return;
          }
        }
      }
    }
  }
  walk(dir);
  return out;
}
console.log('--- fcc-tanim / TextAnimBuiltins loads ---');
for (const line of grep(editorRoot, /fcc-tanim|TextAnimBuiltins|Sidebar\.Object\.TextAnim|fcc-ui-\d+/)) console.log(line);
