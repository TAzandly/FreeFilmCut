
import fs from 'fs';
const s = fs.readFileSync('d:\\GrokbotWork\\FreeFilmCut\\three.js\\editor\\js\\Sidebar.Object.PostProcess.CustomEditor.js', 'utf8');
try {
  await import('data:text/javascript,' + encodeURIComponent(s));
  console.log('data import OK');
} catch (e) {
  console.log('ERR', e.message);
}
