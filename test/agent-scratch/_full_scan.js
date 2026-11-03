const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const roots = [
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor',
];
const files = [];
function walk(d) {
  for (const name of fs.readdirSync(d)) {
    const p = path.join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (name === 'node_modules' || name === 'libs' || name === 'examples') continue;
      walk(p);
    } else if (/\.(js|mjs|ts|tsx)$/.test(name)) files.push(p);
  }
}
for (const r of roots) if (fs.existsSync(r)) walk(r);

const report = [];
for (const p of files) {
  const buf = fs.readFileSync(p);
  const t = buf.toString('utf8');
  let fffd = 0, corruptQ = 0, odd = 0;
  for (const c of t) if (c === '\uFFFD') fffd++;
  for (let i = 1; i < buf.length; i++) {
    if (buf[i] === 0x3f && buf[i-1] >= 0x80) corruptQ++;
  }
  // syntax check only for .js under editor/js that are likely modules
  let syn = null;
  if (p.endsWith('.js') && !p.includes('libs') && (p.includes('textanim') || p.includes('TextAnim') || p.includes('TextLayer') || p.includes('Builtin') || p.includes('PostProcess') || p.includes('UIComposite') || p.includes('Viewport') || p.includes('Sidebar.Object'))) {
    try { execFileSync(process.execPath, ['--check', p], {stdio:'pipe'}); syn = 'ok'; }
    catch (e) { syn = String(e.stderr||e.message).split('\n')[0].slice(0,120); }
  }
  const lines = t.split(/\r?\n/);
  const oddLines = [];
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    let c = 0;
    for (let j = 0; j < L.length; j++) if (L[j] === "'" && (j===0 || L[j-1] !== '\\')) c++;
    if (c % 2 !== 0 && (/[\u4e00-\u9fff]/.test(L) || /pair\(|labelZh|UIText\(/.test(L))) {
      odd++;
      if (oddLines.length < 3) oddLines.push(i+1);
    }
  }
  if (fffd || corruptQ || odd || (syn && syn !== 'ok')) {
    report.push({ p: p.replace(/\\/g,'/'), fffd, corruptQ, odd, oddLines, syn });
  }
}
report.sort((a,b) => (b.fffd+b.corruptQ+b.odd) - (a.fffd+a.corruptQ+a.odd));
console.log('scanned', files.length, 'flagged', report.length);
for (const r of report.slice(0, 40)) {
  console.log(JSON.stringify(r));
}
