const fs = require('fs');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Sidebar.Object.TextAnim.js';
const buf = fs.readFileSync(p);
// dump raw around remaining FFFD
for (let i = 0; i < buf.length - 2; i++) {
  if (buf[i]===0xef && buf[i+1]===0xbf && buf[i+2]===0xbd) {
    const a = Math.max(0, i-25), b = Math.min(buf.length, i+35);
    const hex = [...buf.subarray(a,b)].map(c=>c.toString(16).padStart(2,'0')).join(' ');
    const ascii = [...buf.subarray(a,b)].map(c=>(c>=32&&c<127)?String.fromCharCode(c):'.').join('');
    console.log('---', i);
    console.log(ascii);
    console.log(hex);
  }
}
