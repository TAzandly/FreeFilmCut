const fs = require('fs');
const path = require('path');
function du(dir) {
  let sum = 0, n = 0;
  function walk(d) {
    let ents;
    try { ents = fs.readdirSync(d, {withFileTypes:true}); } catch { return; }
    for (const e of ents) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) walk(p);
      else if (e.isFile()) { try { sum += fs.statSync(p).size; n++; } catch {} }
    }
  }
  walk(dir);
  return { sum, n, mb: +(sum/1e6).toFixed(1) };
}
console.log('editor', du('D:/GrokbotWork/FreeFilmCut/three.js/editor'));
console.log('build', du('D:/GrokbotWork/FreeFilmCut/three.js/build'));
const html = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/index.html','utf8').split(/\r?\n/).slice(0,50);
html.forEach((l,i)=>console.log(String(i+1).padStart(3), l.slice(0,140)));
