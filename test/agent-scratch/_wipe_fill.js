const fs = require('fs');
const lines = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js','utf8').split(/\r?\n/);
for (let i=600;i<640;i++) console.log(String(i+1).padStart(4), lines[i]);
console.log('--- FILL constants ---');
for (let i=160;i<200;i++) console.log(String(i+1).padStart(4), lines[i]);
