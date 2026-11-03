const fs = require('fs');
const files = [
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js',
  'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Sidebar.Object.TextAnim.js',
];
for (const p of files) {
  const lines = fs.readFileSync(p,'utf8').split(/\r?\n/);
  console.log('\n====', p.split('/').pop());
  for (let i=0;i<lines.length;i++) {
    if (/console\.(log|debug|info|warn)|wipeMask|debugWipe|showWipe|扫光遮罩|__fccWipe|wipeDebug/i.test(lines[i])) {
      console.log(String(i+1).padStart(5), lines[i]);
    }
  }
}
