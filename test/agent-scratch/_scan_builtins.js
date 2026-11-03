const fs = require('fs');
const { execFileSync } = require('child_process');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js';
if (!fs.existsSync(p + '.bak_corrupt2')) fs.copyFileSync(p, p + '.bak_corrupt2');
const buf = fs.readFileSync(p);
console.log('bytes', buf.length);

// dump every FFFD and high+?
for (let i = 0; i < buf.length; i++) {
  if (i+2 < buf.length && buf[i]===0xef && buf[i+1]===0xbf && buf[i+2]===0xbd) {
    const a=Math.max(0,i-40), b=Math.min(buf.length,i+40);
    console.log('FFFD', i, [...buf.subarray(a,b)].map(c=>(c>=32&&c<127)?String.fromCharCode(c):'.').join(''));
  }
}
for (let i = 1; i < buf.length; i++) {
  if (buf[i]===0x3f && buf[i-1]>=0x80) {
    const a=Math.max(0,i-50), b=Math.min(buf.length,i+30);
    console.log('Q', i, [...buf.subarray(a,b)].map(c=>(c>=32&&c<127)?String.fromCharCode(c):'.').join(''));
  }
}

// Also find broken arrow patterns: → truncated as incomplete UTF-8 ending with ?
// Look for lines with odd quotes
const t = buf.toString('utf8');
const lines = t.split(/\r?\n/);
for (let i=0;i<lines.length;i++) {
  const L = lines[i];
  let c=0; for (let j=0;j<L.length;j++) if (L[j]==="'" && L[j-1]!=='\\') c++;
  if (c%2!==0) console.log('odd', i+1, JSON.stringify(L.slice(0,140)));
}
