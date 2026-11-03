const fs = require('fs');

function stripWipeLogs(p) {
  let t = fs.readFileSync(p, 'utf8');
  const before = t;
  // Remove console.log( '[FreeFilmCut wipe] ... ); blocks (multi-line)
  t = t.replace(/\n[ \t]*console\.log\(\s*'\[FreeFilmCut wipe\][^']*'[\s\S]*?\);[ \t]*/g, '\n');
  // Also single-line variants already covered
  if (t === before) {
    // try more permissive
    t = t.replace(/\n[ \t]*console\.log\(\s*'\[FreeFilmCut wipe\][\s\S]*?\);[ \t]*(?=\n)/g, '\n');
  }
  fs.writeFileSync(p, t, 'utf8');
  const left = (t.match(/console\.log\(\s*'\[FreeFilmCut wipe\]/g) || []).length;
  console.log(p.split('/').pop(), 'changed', t!==before, 'left', left);
}

stripWipeLogs('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js');
stripWipeLogs('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js');

// bump cache for these files in imports
const root = 'D:/GrokbotWork/FreeFilmCut/three.js/editor';
let bumped = 0;
function walk(d) {
  for (const name of fs.readdirSync(d)) {
    const p = require('path').join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) {
      if (['libs','node_modules','build'].includes(name)) continue;
      walk(p);
    } else if (/\.(js|html)$/.test(name)) {
      let x = fs.readFileSync(p,'utf8');
      let n = 0;
      const y = x
        .replace(/TextLayerRT\.js\?v=fcc-ui-\d+/g, m => { n++; return 'TextLayerRT.js?v=fcc-ui-118'; })
        .replace(/Viewport\.js\?v=fcc-ui-\d+/g, m => { n++; return m.includes('118') ? m : (n++, 'Viewport.js?v=fcc-ui-118'); });
      // careful - double count. Do separately.
    }
  }
}
// simpler bump
function bumpFile(relPattern, newV) {
  // handled below
}
let files = [];
(function walk(d) {
  for (const name of fs.readdirSync(d)) {
    const p = require('path').join(d, name);
    const st = fs.statSync(p);
    if (st.isDirectory()) { if (!['libs','node_modules','build'].includes(name)) walk(p); }
    else if (/\.(js|html)$/.test(name)) files.push(p);
  }
})(root);
for (const p of files) {
  let x = fs.readFileSync(p,'utf8');
  let y = x;
  y = y.replace(/TextLayerRT\.js\?v=fcc-ui-\d+/g, 'TextLayerRT.js?v=fcc-ui-118');
  y = y.replace(/\/Viewport\.js\?v=fcc-ui-\d+/g, '/Viewport.js?v=fcc-ui-118');
  y = y.replace(/'Viewport\.js\?v=fcc-ui-\d+/g, "'Viewport.js?v=fcc-ui-118");
  y = y.replace(/"Viewport\.js\?v=fcc-ui-\d+/g, '"Viewport.js?v=fcc-ui-118');
  // also index.html script tags
  y = y.replace(/(src="js\/Viewport\.js\?v=)fcc-ui-\d+/g, '$1fcc-ui-118');
  y = y.replace(/(src="[^"]*TextLayerRT\.js\?v=)fcc-ui-\d+/g, '$1fcc-ui-118');
  if (y !== x) { fs.writeFileSync(p,y,'utf8'); bumped++; console.log('bump', p.replace(/\\/g,'/')); }
}
console.log('files_bumped', bumped);

// verify remaining wipe logs
for (const p of [
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js',
]) {
  const lines = fs.readFileSync(p,'utf8').split(/\r?\n/);
  for (let i=0;i<lines.length;i++) {
    if (/console\.log.*wipe|wipe.*console\.log/i.test(lines[i]) || /console\.log\(\s*'\[FreeFilmCut wipe\]/.test(lines[i]))
      console.log('LEFT', p.split('/').pop(), i+1, lines[i].trim());
  }
}
