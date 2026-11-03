const fs = require('fs');
const { execFileSync } = require('child_process');
const path = require('path');

for (const p of [
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js',
]) {
  try { execFileSync(process.execPath,['--check',p],{stdio:'pipe'}); console.log('ok', path.basename(p)); }
  catch(e){ console.log('FAIL', path.basename(p), String(e.stderr||e).slice(0,400)); }
}

// show what was around the log sites / any remaining FreeFilmCut wipe console
const root = 'D:/GrokbotWork/FreeFilmCut/three.js/editor';
const hits = [];
(function walk(d){
  for (const name of fs.readdirSync(d)) {
    const p = path.join(d,name); const st=fs.statSync(p);
    if (st.isDirectory()) { if (!['libs','node_modules','build'].includes(name)) walk(p); }
    else if (/\.js$/.test(name)) {
      const t=fs.readFileSync(p,'utf8');
      if (/console\.(log|debug|info).*\[FreeFilmCut wipe\]|\[FreeFilmCut wipe\].*console/.test(t)) hits.push(p);
      for (const m of t.matchAll(/TextLayerRT\.js\?v=[^'"\s]+/g)) hits.push(p.replace(/\\/g,'/')+' :: '+m[0]);
    }
  }
})(root);
console.log(hits.join('\n')||'no wipe logs left; TextLayerRT imports:');
// always print TextLayerRT imports
(function walk(d){
  for (const name of fs.readdirSync(d)) {
    const p = path.join(d,name); const st=fs.statSync(p);
    if (st.isDirectory()) { if (!['libs','node_modules','build'].includes(name)) walk(p); }
    else if (/\.(js|html)$/.test(name)) {
      const t=fs.readFileSync(p,'utf8');
      for (const m of t.matchAll(/TextLayerRT\.js\?v=[^'"\s]+/g)) console.log(p.replace(/\\/g,'/'), m[0]);
      for (const m of t.matchAll(/Viewport\.js\?v=[^'"\s]+/g)) console.log(p.replace(/\\/g,'/'), m[0]);
    }
  }
})(root);

// peek Viewport around wipe debug
const vp = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js','utf8').split(/\r?\n/);
for (let i=1260;i<1295;i++) console.log(String(i+1).padStart(5), vp[i]);
