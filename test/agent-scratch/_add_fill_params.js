const fs = require('fs');
const path = require('path');

// --- TextLayerRT.js ---
const tlPath = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/ui/TextLayerRT.js';
let tl = fs.readFileSync(tlPath, 'utf8');

// Add uniforms
if (!tl.includes('uFillDim')) {
  tl = tl.replace(
    `uBlendMode: { value: 0 }, // 0 normal, 1 add, 2 screen, 3 multiply\r\n\t\t\tuDebug: { value: 0 },`,
    `uBlendMode: { value: 0 }, // 0 normal, 1 add, 2 screen, 3 multiply\r\n\t\t\tuFillDim: { value: 0.35 },\r\n\t\t\tuFillRange: { value: 0.12 },\r\n\t\t\tuFillPower: { value: 2.5 },\r\n\t\t\tuDebug: { value: 0 },`
  );
  tl = tl.replace(
    `uniform float uBlendMode;\r\n\t\t\tuniform float uDebug;`,
    `uniform float uBlendMode;\r\n\t\t\tuniform float uFillDim;\r\n\t\t\tuniform float uFillRange;\r\n\t\t\tuniform float uFillPower;\r\n\t\t\tuniform float uDebug;`
  );
}

// Replace hardcoded FILL_* block
const oldFill = `\t\t\t\t// Revealed-side falloff (left of blade for LTR): flat reveal==1 looked
\t\t\t\t// pure-white / too hot. Local 0..1 factor via pow so brightness sits
\t\t\t\t// near the blade; deep-inside fill is dimmer. Settles to 1 at end.
\t\t\t\t// FILL_POWER > 1 = faster drop away from blade (non-linear).
\t\t\t\tconst float FILL_POWER = 2.5;
\t\t\t\tconst float FILL_DIM = 0.35;
\t\t\t\tfloat dRev = max( 0.0, mask - thresh );
\t\t\t\tfloat fallW = max( max( ew * 3.0, soft * 2.0 ), 0.12 );
\t\t\t\tfloat tFill = clamp( dRev / fallW, 0.0, 1.0 );
\t\t\t\tfloat bladeProx = pow( max( 1.0 - tFill, 0.0 ), FILL_POWER );
\t\t\t\tfloat fillMod = mix( FILL_DIM, 1.0, bladeProx );
\t\t\t\tfloat settle = smoothstep( 0.92, 1.0, uProgress );
\t\t\t\tfillMod = mix( fillMod, 1.0, settle );`.replace(/\n/g, '\r\n');

const newFill = `\t\t\t\t// Revealed-side falloff: dim deep fill, bright near blade.
\t\t\t\t// uFillDim / uFillRange / uFillPower are sidebar-tunable.
\t\t\t\tfloat dRev = max( 0.0, mask - thresh );
\t\t\t\tfloat fallW = max( uFillRange, max( ew * 3.0, soft * 2.0 ) );
\t\t\t\tfloat tFill = clamp( dRev / max( fallW, 1e-4 ), 0.0, 1.0 );
\t\t\t\tfloat bladeProx = pow( max( 1.0 - tFill, 0.0 ), max( uFillPower, 0.01 ) );
\t\t\t\tfloat fillMod = mix( clamp( uFillDim, 0.0, 1.0 ), 1.0, bladeProx );
\t\t\t\tfloat settle = smoothstep( 0.92, 1.0, uProgress );
\t\t\t\tfillMod = mix( fillMod, 1.0, settle );`.replace(/\n/g, '\r\n');

if (!tl.includes(oldFill)) {
  // try find fragment
  const i = tl.indexOf('const float FILL_POWER');
  console.log('fill block missing?', i, JSON.stringify(tl.slice(i, i+200)));
} else {
  tl = tl.split(oldFill).join(newFill);
  console.log('fill_shader_ok');
}

// Guard version + uniform check
tl = tl.replace(/__fccWipeV !== 27/g, '__fccWipeV !== 28');
tl = tl.replace(/__fccWipeV = 27/g, '__fccWipeV = 28');
tl = tl.replace(
  '! wipeMat.uniforms.uBlendMode )',
  '! wipeMat.uniforms.uBlendMode || ! wipeMat.uniforms.uFillDim )'
);

// applyWipeReveal: read args + set uniforms
tl = tl.replace(
  `wipeMat.uniforms.uBlendMode.value = blendMode;\r\n\twipeMat.uniforms.uDebug.value = args.debugMask ? 1 : 0;`,
  `wipeMat.uniforms.uBlendMode.value = blendMode;\r\n\twipeMat.uniforms.uFillDim.value = Math.max( 0, Math.min( 1, Number( args.fillDim ) ) );\r\n\tif ( ! Number.isFinite( wipeMat.uniforms.uFillDim.value ) ) wipeMat.uniforms.uFillDim.value = 0.35;\r\n\twipeMat.uniforms.uFillRange.value = Math.max( 0.02, Math.min( 1, Number( args.fillRange ) || 0.12 ) );\r\n\twipeMat.uniforms.uFillPower.value = Math.max( 0.5, Math.min( 8, Number( args.fillPower ) || 2.5 ) );\r\n\twipeMat.uniforms.uDebug.value = args.debugMask ? 1 : 0;`
);

// Fix fillDim default when args.fillDim is undefined - Number(undefined) is NaN, then Math.max(0, Math.min(1, NaN)) is NaN
// Better:
tl = tl.replace(
  `wipeMat.uniforms.uFillDim.value = Math.max( 0, Math.min( 1, Number( args.fillDim ) ) );\r\n\tif ( ! Number.isFinite( wipeMat.uniforms.uFillDim.value ) ) wipeMat.uniforms.uFillDim.value = 0.35;`,
  `{\r\n\t\tconst fd = Number( args.fillDim );\r\n\t\twipeMat.uniforms.uFillDim.value = Number.isFinite( fd ) ? Math.max( 0, Math.min( 1, fd ) ) : 0.35;\r\n\t}`
);

fs.writeFileSync(tlPath, tl, 'utf8');
console.log('TextLayerRT written', tl.includes('uFillDim'), tl.includes('__fccWipeV = 28'));

// --- Builtins ---
const bPath = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/textanim/TextAnimBuiltins.js';
let b = fs.readFileSync(bPath, 'utf8');
const oldParams = `\t\tedgeWidth: { type: 'number', default: 0.03, min: 0.005, max: 0.25, step: 0.005, label: 'Edge width', labelZh: '刃光宽度' },
\t\tblendMode: {`.replace(/\n/g,'\r\n');
const newParams = `\t\tedgeWidth: { type: 'number', default: 0.03, min: 0.005, max: 0.25, step: 0.005, label: 'Edge width', labelZh: '刃光宽度' },
\t\tfillDim: { type: 'number', default: 0.35, min: 0, max: 1, step: 0.05, label: 'Fill dim', labelZh: '露出压暗' },
\t\tfillRange: { type: 'number', default: 0.12, min: 0.02, max: 1, step: 0.01, label: 'Fill range', labelZh: '压暗范围' },
\t\tfillPower: { type: 'number', default: 2.5, min: 0.5, max: 8, step: 0.1, label: 'Fill power', labelZh: '压暗曲线' },
\t\tblendMode: {`.replace(/\n/g,'\r\n');
if (!b.includes('fillDim:')) {
  if (b.includes(oldParams)) { b = b.split(oldParams).join(newParams); console.log('builtins_params'); }
  else console.log('builtins params anchor missing');
}

const oldResolve = `\t\t\tedgeWidth: Math.max( 0.005, Math.min( 0.25, P.edgeWidth ) ),
\t\t\tblendMode: WIPE_BLENDS.includes( P.blendMode ) ? P.blendMode : 'normal',`.replace(/\n/g,'\r\n');
const newResolve = `\t\t\tedgeWidth: Math.max( 0.005, Math.min( 0.25, P.edgeWidth ) ),
\t\t\tfillDim: Math.max( 0, Math.min( 1, Number.isFinite( Number( P.fillDim ) ) ? Number( P.fillDim ) : 0.35 ) ),
\t\t\tfillRange: Math.max( 0.02, Math.min( 1, Number.isFinite( Number( P.fillRange ) ) ? Number( P.fillRange ) : 0.12 ) ),
\t\t\tfillPower: Math.max( 0.5, Math.min( 8, Number.isFinite( Number( P.fillPower ) ) ? Number( P.fillPower ) : 2.5 ) ),
\t\t\tblendMode: WIPE_BLENDS.includes( P.blendMode ) ? P.blendMode : 'normal',`.replace(/\n/g,'\r\n');
if (b.includes(oldResolve)) { b = b.split(oldResolve).join(newResolve); console.log('builtins_resolve'); }
else console.log('resolve missing', b.includes('edgeWidth: Math.max'));

fs.writeFileSync(bPath, b, 'utf8');

// --- Viewport pass-through ---
const vpPath = 'D:/GrokbotWork/FreeFilmCut/three.js/editor/js/Viewport.js';
let vp = fs.readFileSync(vpPath, 'utf8');
const oldCall = `\t\t\t\tedgeWidth: wipeInfo.wipe.edgeWidth,
\t\t\t\tblendMode: wipeInfo.wipe.blendMode || 'normal',`.replace(/\n/g,'\r\n');
const newCall = `\t\t\t\tedgeWidth: wipeInfo.wipe.edgeWidth,
\t\t\t\tfillDim: wipeInfo.wipe.fillDim,
\t\t\t\tfillRange: wipeInfo.wipe.fillRange,
\t\t\t\tfillPower: wipeInfo.wipe.fillPower,
\t\t\t\tblendMode: wipeInfo.wipe.blendMode || 'normal',`.replace(/\n/g,'\r\n');
if (vp.includes(oldCall)) { vp = vp.split(oldCall).join(newCall); console.log('viewport_ok'); }
else console.log('viewport call missing');
fs.writeFileSync(vpPath, vp, 'utf8');

// bump caches
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
      let y = x
        .replace(/TextLayerRT\.js\?v=fcc-ui-\d+/g, 'TextLayerRT.js?v=fcc-ui-120')
        .replace(/fcc-tanim-9/g, 'fcc-tanim-10');
      if (y !== x) { fs.writeFileSync(fp, y, 'utf8'); bumped++; console.log('bump', fp.replace(/\\/g,'/')); }
    }
  }
})('D:/GrokbotWork/FreeFilmCut/three.js/editor');
console.log('bumped', bumped);

const { execFileSync } = require('child_process');
for (const p of [tlPath, bPath, vpPath]) {
  try { execFileSync(process.execPath, ['--check', p], {stdio:'pipe'}); console.log('syntax', path.basename(p)); }
  catch (e) { console.log('FAIL', path.basename(p), String(e.stderr||e).slice(0,300)); }
}
