const fs = require('fs');
const path = require('path');
const root = 'D:/GrokbotWork/FreeFilmCut/three.js/editor';
let filesChanged = 0, repl = 0;
function walk(d) {
  for (const name of fs.readdirSync(d)) {
    const p = path.join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (['node_modules','libs','build'].includes(name)) continue;
      walk(p);
    } else if (/\.(js|html)$/.test(name)) {
      let t = fs.readFileSync(p, 'utf8');
      let n = 0;
      const t2 = t.replace(/fcc-tanim-7/g, () => { n++; return 'fcc-tanim-8'; })
                  .replace(/Sidebar\.Object\.TextAnim\.js\?v=fcc-ui-115/g, () => { n++; return 'Sidebar.Object.TextAnim.js?v=fcc-ui-116'; });
      if (n) {
        fs.writeFileSync(p, t2, 'utf8');
        filesChanged++;
        repl += n;
        console.log('bumped', n, p.replace(/\\/g,'/'));
      }
    }
  }
}
walk(root);

// final scan focused
const { execFileSync } = require('child_process');
const cores = [
  'js/textanim/TextAnimBuiltins.js',
  'js/textanim/TextAnimEngine.js',
  'js/textanim/TextAnimRegistry.js',
  'js/textanim/TextAnimTypes.js',
  'js/ui/TextAnim.js',
  'js/Sidebar.Object.TextAnim.js',
  'js/ui/TextLayerRT.js',
  'js/BuiltinEffects.js',
  'js/PostProcessStack.js',
  'js/UICompositePass.js',
];
for (const rel of cores) {
  const p = path.join(root, rel);
  if (!fs.existsSync(p)) { console.log('missing', rel); continue; }
  const buf = fs.readFileSync(p);
  const t = buf.toString('utf8');
  let fffd = [...t].filter(c=>c==='\uFFFD').length;
  let cq = 0;
  for (let i=1;i<buf.length;i++) if (buf[i]===0x3f && buf[i-1]>=0x80) cq++;
  try { execFileSync(process.execPath,['--check',p],{stdio:'pipe'}); console.log('OK', rel, 'fffd',fffd,'cq',cq); }
  catch(e){ console.log('FAIL', rel, String(e.stderr||e).slice(0,150)); }
}
console.log('total_files', filesChanged, 'total_repl', repl);
