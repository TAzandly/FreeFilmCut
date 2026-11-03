const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');
const root = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim';
const files = fs.readdirSync(root).filter(f => f.endsWith('.js')).map(f => path.join(root, f));
function scanFile(p) {
  const buf = fs.readFileSync(p);
  const issues = [];
  if (buf[0] === 0xEF && buf[1] === 0xBB && buf[2] === 0xBF) issues.push('BOM');
  // invalid utf8 / ? after high byte
  for (let i = 1; i < buf.length; i++) {
    if (buf[i] === 0x3f && buf[i-1] >= 0x80) issues.push('corrupt_q@'+i);
  }
  let text;
  try { text = buf.toString('utf8'); } catch (e) { issues.push('utf8_fail:'+e.message); return {p, issues}; }
  // naive: find unmatched single-quoted strings with Chinese likely broken: pattern ', [a-z] without closing mid
  const lines = text.split(/\r?\n/);
  for (let i = 0; i < lines.length; i++) {
    const L = lines[i];
    // pair( 'X', 'YMISSING
    if (/pair\(\s*'[^']*',\s*'[^']*,\s*defs\./.test(L)) issues.push('line '+(i+1)+': pair labelZh missing closing quote');
    if (/labelZh:\s*'[^']*[^'\\]\s*\},/.test(L) && !/labelZh:\s*'[^']*'/.test(L)) issues.push('line '+(i+1)+': labelZh missing quote');
    if (/hintZh:\s*'[^']*,\s*$/.test(L) && !/hintZh:\s*'[^']*',\s*$/.test(L)) issues.push('line '+(i+1)+': hintZh broken');
  }
  try {
    execFileSync(process.execPath, ['--check', p], {stdio:['ignore','pipe','pipe']});
  } catch (e) {
    issues.push('syntax:'+String(e.stderr||e.message).slice(0,200));
  }
  return {p, issues, lines: lines.length};
}
const results = files.map(scanFile);
for (const r of results) {
  if (r.issues.length) console.log('BAD', r.p, r.issues.join(' | '));
  else console.log('OK', path.basename(r.p), 'lines', r.lines);
}
