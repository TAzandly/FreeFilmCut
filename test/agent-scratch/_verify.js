const fs = require('fs');
function dump(p) {
  const buf = fs.readFileSync(p);
  console.log('====', p);
  for (let i = 1; i < buf.length; i++) {
    if (buf[i] === 0x3f && buf[i-1] >= 0x80) {
      const a = Math.max(0,i-50), b = Math.min(buf.length,i+30);
      const ascii = [...buf.subarray(a,b)].map(c=>(c>=32&&c<127)?String.fromCharCode(c):'.').join('');
      const hex = [...buf.subarray(i-3,i+2)].map(c=>c.toString(16).padStart(2,'0')).join(' ');
      console.log(i, ascii);
      console.log('  hex', hex);
    }
  }
}
dump('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Strings.js');
dump('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/VfxPackExporter.js');

// also verify textanim core files
const { execFileSync } = require('child_process');
const cores = [
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimEngine.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimRegistry.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimTypes.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextAnim.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Sidebar.Object.TextAnim.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js',
];
for (const p of cores) {
  try {
    execFileSync(process.execPath, ['--check', p], {stdio:'pipe'});
    const t = fs.readFileSync(p,'utf8');
    const f = [...t].filter(c=>c==='\uFFFD').length;
    console.log('OK', p.split('/').pop(), 'fffd', f);
  } catch(e) {
    console.log('FAIL', p.split('/').pop(), String(e.stderr||e).slice(0,200));
  }
}

// find cache bumps for textanim
const idx = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/index.html','utf8');
const bumps = [...idx.matchAll(/textanim[^"'?\s]*\?v=([^"'\s]+)|TextAnim[^"'?\s]*\?v=([^"'\s]+)|Sidebar\.Object\.TextAnim[^"'?\s]*\?v=([^"'\s]+)/g)];
console.log('index bumps', bumps.map(m=>m[0]));
