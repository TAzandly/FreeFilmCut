const fs = require('fs');
const { execFileSync } = require('child_process');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js';
const lines = fs.readFileSync(p,'utf8').split(/\r?\n/);
console.log('L269', lines[268]);
execFileSync(process.execPath, ['--check', p], {stdio:'pipe'});
console.log('syntax_ok');
// also dynamic import via http? already browser-tested
// confirm cache bump present
const ui = fs.readFileSync('D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Sidebar.Object.UI.js','utf8');
const m = ui.match(/Sidebar\.Object\.TextAnim\.js\?v=[^'"]+/);
console.log('sidebar_import', m && m[0]);
const b = fs.readFileSync(p,'utf8');
const m2 = b.match(/TextAnimRegistry\.js\?v=[^'"]+/);
console.log('builtins_import', m2 && m2[0]);
