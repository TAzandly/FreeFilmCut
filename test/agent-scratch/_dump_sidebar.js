const fs = require('fs');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Sidebar.Object.TextAnim.js';
fs.copyFileSync(p, p + '.bak_corrupt');
let buf = Buffer.from(fs.readFileSync(p));
// Collect contexts around corrupt ?
const hits = [];
for (let i = 1; i < buf.length; i++) {
  if (buf[i] === 0x3f && buf[i-1] >= 0x80) {
    const a = Math.max(0, i - 40), b = Math.min(buf.length, i + 20);
    hits.push({ i, ctx: buf.subarray(a, b).toString('latin1') });
  }
}
console.log('hits', hits.length);
for (const h of hits) {
  const safe = [...Buffer.from(h.ctx,'latin1')].map(c => (c>=32&&c<127)?String.fromCharCode(c):('\\x'+c.toString(16).padStart(2,'0'))).join('');
  console.log('---', h.i, safe);
}
