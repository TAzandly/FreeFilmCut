const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const builtins = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js';
const lines = fs.readFileSync(builtins, 'utf8').split(/\r?\n/);
console.log('L70', JSON.stringify(lines[69]));

// Scan entire editor/js for TextAnimBuiltins imports and tanim files with odd quotes / corrupt ?
const root = 'D:/GrokbotWork/FreeFilmCut/three.js/editor';
const bad = [];
function walk(d) {
  for (const ent of fs.readdirSync(d, {withFileTypes:true})) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'build') continue;
      walk(p);
    } else if (ent.name.endsWith('.js')) {
      const buf = fs.readFileSync(p);
      for (let i = 1; i < buf.length; i++) {
        if (buf[i] === 0x3f && buf[i-1] >= 0x80) { bad.push({p, kind:'corrupt_q', i}); break; }
      }
      if (buf[0]===0xEF && buf[1]===0xBB && buf[2]===0xBF) bad.push({p, kind:'BOM'});
      let text;
      try { text = buf.toString('utf8'); } catch { bad.push({p, kind:'utf8'}); continue; }
      const ls = text.split(/\r?\n/);
      for (let i = 0; i < ls.length; i++) {
        let n = 0; const L = ls[i];
        for (let j = 0; j < L.length; j++) if (L[j] === "'" && L[j-1] !== '\\') n++;
        // only flag if line looks like JS string-heavy and odd quotes AND contains CJK or pair(
        if (n % 2 !== 0 && (L.includes('pair(') || L.includes('labelZh') || L.includes('hintZh') || /[\u4e00-\u9fff]/.test(L))) {
          bad.push({p, kind:'odd_quote', line:i+1, sample:L.slice(0,100)});
        }
      }
      if (p.includes('textanim') || /TextAnimBuiltins/.test(text.slice(0,500)) === false && false) {}
      if (p.includes('textanim')) {
        try { execFileSync(process.execPath, ['--check', p], {stdio:'pipe'}); }
        catch (e) { bad.push({p, kind:'syntax', msg:String(e.stderr||'').slice(0,200)}); }
      }
    }
  }
}
walk(root);
console.log('BAD_COUNT', bad.length);
for (const b of bad.slice(0,50)) console.log(JSON.stringify(b));

// Bump fcc-tanim-6 -> fcc-tanim-7 across editor
let bumped = 0;
function bumpWalk(d) {
  for (const ent of fs.readdirSync(d, {withFileTypes:true})) {
    const p = path.join(d, ent.name);
    if (ent.isDirectory()) {
      if (ent.name === 'node_modules' || ent.name === 'build') continue;
      bumpWalk(p);
    } else if (/\.(js|html)$/.test(ent.name)) {
      let t = fs.readFileSync(p, 'utf8');
      if (!t.includes('fcc-tanim-6')) continue;
      const n = t.split('fcc-tanim-6').join('fcc-tanim-7');
      if (n !== t) { fs.writeFileSync(p, n, 'utf8'); bumped++; console.log('bump', p); }
    }
  }
}
bumpWalk(root);
console.log('bumped_files', bumped);
