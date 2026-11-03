const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[PAGEERROR] ${e.message}`));
  await page.goto('http://localhost:5174/editor/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(4000);
  const diag = await page.evaluate(async () => {
    const out = { err: null, childCount: null, parseError: null, stateInfo: null };
    try {
      const state = await new Promise((resolve, reject) => {
        const req = indexedDB.open('threejs-editor');
        req.onerror = () => reject(req.error);
        req.onsuccess = () => {
          const db = req.result;
          const tx = db.transaction('states', 'readonly');
          const g = tx.objectStore('states').get(0);
          g.onsuccess = () => resolve(g.result);
          g.onerror = () => reject(g.error);
        };
      });
      if (!state) { out.stateInfo = 'empty'; return out; }
      out.stateInfo = {
        keys: Object.keys(state),
        sceneChildCount: state.scene?.object?.children?.length,
        sceneChildren: (state.scene?.object?.children || []).map(c => ({ type: c.type, name: c.name, childLen: c.children?.length })),
        materialTypes: state.scene?.materials ? Object.values(state.scene.materials).map(m => m.type) : [],
        shaderUniformSample: null,
        cameraType: state.camera?.object?.type,
        historyUndoLen: state.history?.undos?.length,
      };
      const mats = state.scene?.materials || {};
      for (const m of Object.values(mats)) {
        if (m.type === 'ShaderMaterial' || m.type === 'RawShaderMaterial') {
          out.stateInfo.shaderUniformSample = m.uniforms;
          out.stateInfo.shaderHasColorProp = m.color !== undefined;
          out.stateInfo.shaderHasMapProp = m.map !== undefined;
          out.stateInfo.vertexHead = (m.vertexShader || '').slice(0, 80);
          break;
        }
      }
      // try parse with THREE from page
      if (window.THREE && state.scene) {
        try {
          const loader = new THREE.ObjectLoader();
          const scene = await loader.parseAsync(state.scene);
          out.childCount = scene.children.length;
          out.childNames = scene.children.map(c => c.type + ':' + c.name);
        } catch (e) {
          out.parseError = String(e && e.message || e);
          out.parseStack = String(e && e.stack || '').slice(0, 800);
        }
      } else {
        out.noThree = !window.THREE;
      }
    } catch (e) {
      out.err = String(e);
    }
    out.outliner = document.getElementById('outliner')?.innerText?.slice(0, 400);
    return out;
  });
  console.log(JSON.stringify({ logs: logs.filter(l => /error|Error|Restored|Saved|PAGEERROR|fail/i.test(l)).slice(0, 50), diag }, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
