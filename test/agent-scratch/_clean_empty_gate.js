const fs = require('fs');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js';
let t = fs.readFileSync(p, 'utf8');
const block = `\t\t\tif ( editor.textAnimWipeDebug ) {

\t\t\t\tif ( ! editor._fccWipeDbgLogged ) {

\t\t\t\t\teditor._fccWipeDbgLogged = true;


\t\t\t\t}

\t\t\t} else {

\t\t\t\teditor._fccWipeDbgLogged = false;

\t\t\t}

`;
const blockCRLF = block.replace(/\n/g, '\r\n');
if (t.includes(blockCRLF)) {
  t = t.split(blockCRLF).join('');
  console.log('removed empty debug log gate CRLF');
} else if (t.includes(block)) {
  t = t.split(block).join('');
  console.log('removed empty debug log gate LF');
} else {
  // flexible regex
  const re = /\r?\n\t\t\tif \( editor\.textAnimWipeDebug \) \{\r?\n\r?\n\t\t\t\tif \( ! editor\._fccWipeDbgLogged \) \{\r?\n\r?\n\t\t\t\t\teditor\._fccWipeDbgLogged = true;\r?\n\r?\n\r?\n\t\t\t\t\}\r?\n\r?\n\t\t\t\} else \{\r?\n\r?\n\t\t\t\teditor\._fccWipeDbgLogged = false;\r?\n\r?\n\t\t\t\}\r?\n/;
  if (re.test(t)) { t = t.replace(re, '\n'); console.log('removed via regex'); }
  else {
    console.log('block not found, dumping nearby:');
    const i = t.indexOf('_fccWipeDbgLogged');
    console.log(JSON.stringify(t.slice(i-120, i+200)));
  }
}
// also remove leftover _fccWipeDbgLogged refs if any
t = t.replace(/[ \t]*editor\._fccWipeDbgLogged\s*=\s*(true|false);\r?\n/g, '');
fs.writeFileSync(p, t, 'utf8');
console.log('refs_left', (t.match(/_fccWipeDbgLogged/g)||[]).length);

// TextLayerRT - check for empty remnants around removed logs
const tl = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js','utf8');
const lines = tl.split(/\r?\n/);
for (let i=550;i<670;i++) {
  if (lines[i] && /console\.|debug:|_fccWipe|alpha-AABB/.test(lines[i])) console.log(i+1, lines[i]);
}
// if computeWipeAlphaBounds still has debug-only logging path, leave warn
console.log('warns', (tl.match(/console\.warn\(\s*'\[FreeFilmCut wipe\]/g)||[]).length);
console.log('logs', (tl.match(/console\.log\(\s*'\[FreeFilmCut wipe\]/g)||[]).length);
