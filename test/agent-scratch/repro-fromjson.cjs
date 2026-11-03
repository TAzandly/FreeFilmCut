const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  page.on('console', m => logs.push(m.type() + ' ' + m.text().slice(0, 180)));
  await page.goto('http://localhost:5174/editor/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const mid = await page.evaluate(async () => {
    const editor = window.editor;
    const THREE = window.THREE;
    [...editor.scene.children].forEach(c => editor.removeObject(c));
    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'CubeB';
    editor.addObject(mesh);
    const mod = await import('./js/FreeCapCutShaders.js');
    const { SetMaterialCommand } = await import('./js/commands/SetMaterialCommand.js');
    const { SetMaterialValueCommand } = await import('./js/commands/SetMaterialValueCommand.js');
    editor.execute(new SetMaterialCommand(editor, mesh, mod.createFreeFilmCutShaderMaterial('ShaderMaterial', mat)));
    const cmd = new SetMaterialValueCommand(editor, mesh, 'uniforms', mod.normalizeShaderUniforms({
      map:{value:null}, color:{value:[1,0,0]}, color2:{value:[0,0,1]}, opacity:{value:1}, uTime:{value:0}, useMap:{value:false}
    }));
    cmd.updatable = false;
    editor.execute(cmd);

    const json = editor.toJSON();
    // Save via IDB
    await new Promise((resolve, reject) => {
      editor.storage.set(json);
      // storage.set is sync start; wait a bit for oncomplete
      setTimeout(resolve, 200);
    });

    // Read back from IDB
    const state = await new Promise((resolve, reject) => {
      const req = indexedDB.open('threejs-editor');
      req.onsuccess = () => {
        const db = req.result;
        const tx = db.transaction('states', 'readonly');
        const g = tx.objectStore('states').get(0);
        g.onsuccess = () => resolve(g.result);
        g.onerror = () => reject(g.error);
      };
      req.onerror = () => reject(req.error);
    });

    let parseFromIdb = {};
    try {
      const scene = await new THREE.ObjectLoader().parseAsync(state.scene);
      parseFromIdb = { childCount: scene.children.length, names: scene.children.map(c => c.name), mat: scene.children[0]&&scene.children[0].material&&scene.children[0].material.type };
    } catch (e) {
      parseFromIdb = { error: String(e.message||e), stack: String(e.stack||'').slice(0,500) };
    }

    // Now call editor.fromJSON like the app does
    // First clear
    [...editor.scene.children].forEach(c => editor.removeObject(c));
    let fromJsonResult = {};
    try {
      await editor.fromJSON(state);
      fromJsonResult = {
        ok: true,
        children: editor.scene.children.map(c => c.name+':'+c.type),
        sceneUuid: editor.scene.uuid,
        stateSceneUuid: state.scene.object.uuid,
      };
    } catch (e) {
      fromJsonResult = { ok: false, error: String(e.message||e), stack: String(e.stack||'').slice(0,800), children: editor.scene.children.map(c => c.name) };
    }

    return {
      jsonChildCount: json.scene.object.children.length,
      idbChildCount: state.scene.object.children && state.scene.object.children.length,
      idbHasGeometries: !!(state.scene.geometries && Object.keys(state.scene.geometries).length),
      idbHasMaterials: !!(state.scene.materials && Object.keys(state.scene.materials).length),
      idbSceneKeys: Object.keys(state.scene),
      parseFromIdb,
      fromJsonResult,
    };
  });
  console.log(JSON.stringify(mid, null, 2));
  console.log('LOGS\n' + logs.filter(l => /PAGEERROR|error|Error|Restored|Saved/i.test(l)).join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
