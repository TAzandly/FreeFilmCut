const fs = require('fs');
const path = require('path');
const p = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js';
let t = fs.readFileSync(p, 'utf8');

const oldReveal = `\t\t\t\tfloat soft = max( uSoft, 1e-4 );
\t\t\t\tfloat pExp = uProgress * ( 1.0 + 2.0 * soft ) - soft;
\t\t\t\tfloat thresh = 1.0 - pExp;
\t\t\t\tfloat reveal = smoothstep( thresh - soft, thresh + soft, mask );`;

const newReveal = `\t\t\t\tfloat soft = max( uSoft, 1e-4 );
\t\t\t\tfloat pExp = uProgress * ( 1.0 + 2.0 * soft ) - soft;
\t\t\t\tfloat thresh = 1.0 - pExp;
\t\t\t\t// Hard cut on the unrevealed side (mask < thresh); soft only bleeds
\t\t\t\t// back into already-revealed fill so the leading edge stays crisp.
\t\t\t\tfloat reveal = smoothstep( thresh, thresh + soft, mask );`;

if (!t.includes(oldReveal)) {
  // try CRLF
  const o2 = oldReveal.replace(/\n/g, '\r\n');
  const n2 = newReveal.replace(/\n/g, '\r\n');
  if (t.includes(o2)) { t = t.split(o2).join(n2); console.log('reveal_fixed CRLF'); }
  else {
    console.log('OLD NOT FOUND');
    const i = t.indexOf('float reveal = smoothstep');
    console.log(JSON.stringify(t.slice(i-120, i+80)));
    process.exit(1);
  }
} else {
  t = t.split(oldReveal).join(newReveal);
  console.log('reveal_fixed LF');
}

// bump shader schema so material recompiles
t = t.replace(/__fccWipeV !== 26/g, '__fccWipeV !== 27');
t = t.replace(/__fccWipeV = 26/g, '__fccWipeV = 27');

fs.writeFileSync(p, t, 'utf8');

// bump TextLayerRT cache refs
const root = 'D:/GrokbotWork/FreeFilmCut/three.js/editor';
let bumped = 0;
(function walk(d) {
  for (const name of fs.readdirSync(d)) {
    const fp = path.join(d, name);
    const st = fs.statSync(fp);
    if (st.isDirectory()) {
      if (['libs','node_modules','build'].includes(name)) continue;
      walk(fp);
    } else if (/\.(js|html)$/.test(name)) {
      let x = fs.readFileSync(fp, 'utf8');
      const y = x.replace(/TextLayerRT\.js\?v=fcc-ui-\d+/g, 'TextLayerRT.js?v=fcc-ui-119');
      if (y !== x) { fs.writeFileSync(fp, y, 'utf8'); bumped++; console.log('bump', fp.replace(/\\/g,'/')); }
    }
  }
})(root);
console.log('bumped', bumped);

// verify
const check = fs.readFileSync(p,'utf8');
console.log('has_hard', check.includes('smoothstep( thresh, thresh + soft, mask )'));
console.log('wipeV', (check.match(/__fccWipeV = 27/)||[])[0]);
