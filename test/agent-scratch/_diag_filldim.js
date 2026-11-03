const fs = require('fs');
const path = require('path');

// 1) Verify TextLayerRT shader + uniforms set
const tl = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js','utf8');
console.log('=== fillDim in TextLayerRT ===');
for (const m of tl.matchAll(/uFillDim|fillDim|fillMod|FILL_DIM/g)) {
  const i = m.index;
  const line = tl.slice(0,i).split(/\r?\n/).length;
  console.log(line, JSON.stringify(tl.slice(i-40, i+80).replace(/\s+/g,' ')));
}

// 2) Builtins resolve
const b = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js','utf8');
console.log('\n=== builtins wipe ===');
const wi = b.indexOf("registerTextAnim( 'wipeReveal'");
console.log(b.slice(wi, wi+1800));

// 3) How sidebar writes params + how wipeInfo is sampled
const files = [
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextAnim.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Sidebar.Object.TextAnim.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js',
];
for (const p of files) {
  const t = fs.readFileSync(p,'utf8');
  if (!/wipe|fillDim|sampleWipe|params/.test(t)) continue;
  console.log('\n====', path.basename(p));
  const lines = t.split(/\r?\n/);
  for (let i=0;i<lines.length;i++) {
    if (/fillDim|sampleWipe|wipe\.|kind:\s*'wipe'|params\[|comp\.params|setKey.*param/i.test(lines[i])) {
      console.log(String(i+1).padStart(5), lines[i].slice(0,140));
    }
  }
}
