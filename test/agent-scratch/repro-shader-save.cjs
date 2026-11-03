const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  page.on('console', m => logs.push(`[${m.type()}] ${m.text()}`));
  page.on('pageerror', e => logs.push(`[PAGEERROR] ${e.message}\n${e.stack}`));
  await page.goto('http://localhost:5174/editor/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  const dump = await page.evaluate(async () => {
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
    return {
      sceneObject: state && state.scene && state.scene.object,
      sceneKeys: state && state.scene && Object.keys(state.scene),
      geometries: state && state.scene && state.scene.geometries && Object.keys(state.scene.geometries).length,
      materials: state && state.scene && state.scene.materials && Object.keys(state.scene.materials).length,
      localStorageKeys: Object.keys(localStorage).filter(k => /three|editor|freecap/i.test(k)),
    };
  });
  console.log('DUMP', JSON.stringify(dump, null, 2));

  // Reproduce: add cube, switch to ShaderMaterial, edit uniforms, force save, reload
  const repro = await page.evaluate(async () => {
    const editor = window.editor;
    if (!editor) return { error: 'no editor' };
    const THREE = window.THREE;
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'ReproCube';
    editor.addObject(mesh);
    editor.select(mesh);

    // import createFreeFilmCutShaderMaterial path by switching type via command if available
    // Use FreeFilmCut helper by dynamic import
    const mod = await import('./js/FreeCapCutShaders.js');
    const shaderMat = mod.createFreeFilmCutShaderMaterial('ShaderMaterial', mat);
    editor.execute(new (await import('./js/commands/SetMaterialCommand.js')).SetMaterialCommand(editor, mesh, shaderMat));

    // Apply uniforms like Info panel
    const uniforms = mod.normalizeShaderUniforms({
      map: { value: null },
      color: { value: [1, 0, 0] },
      color2: { value: [0, 0, 1] },
      opacity: { value: 1 },
      uTime: { value: 0 },
      useMap: { value: false }
    });
    const { SetMaterialValueCommand } = await import('./js/commands/SetMaterialValueCommand.js');
    const cmd = new SetMaterialValueCommand(editor, mesh, 'uniforms', uniforms);
    cmd.updatable = false;
    editor.execute(cmd);

    // Force immediate save
    editor.storage.set(editor.toJSON());

    const json = editor.toJSON();
    return {
      liveChildren: editor.scene.children.map(c => c.name + ':' + c.type),
      savedChildren: json.scene.object.children.map(c => ({ type: c.type, name: c.name })),
      savedMatTypes: json.scene.materials ? Object.values(json.scene.materials).map(m => ({
        type: m.type,
        color: m.color,
        map: m.map,
        uniformKeys: m.uniforms && Object.keys(m.uniforms),
        colorU: m.uniforms && m.uniforms.color,
        color2U: m.uniforms && m.uniforms.color2,
      })) : [],
    };
  });
  console.log('REPRO_SAVE', JSON.stringify(repro, null, 2));

  // Reload page and see if cube survives
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3000);
  const after = await page.evaluate(() => {
    const editor = window.editor;
    return {
      children: editor.scene.children.map(c => c.name + ':' + c.type),
      outliner: document.getElementById('outliner') && document.getElementById('outliner').innerText,
      errors: null,
    };
  });
  console.log('AFTER_RELOAD', JSON.stringify(after, null, 2));
  console.log('LOGS', logs.filter(l => /PAGEERROR|Error|error|Restored|Saved/i.test(l)).join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
