const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message));
  page.on('console', m => logs.push(m.type() + ' ' + m.text().slice(0, 220)));

  await page.goto('http://localhost:5174/editor/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2500);

  // Clear broken autosave
  await page.evaluate(async () => {
    await new Promise((resolve) => {
      window.editor.storage.clear();
      setTimeout(resolve, 200);
    });
    // remove any live children
    [...window.editor.scene.children].forEach(c => window.editor.removeObject(c));
  });

  // Seed shader cube with autosave on
  await page.evaluate(async () => {
    const editor = window.editor;
    const THREE = window.THREE;
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({ color: 0xff0000 }));
    mesh.name = 'RecoverCube';
    editor.addObject(mesh);
    const mod = await import('./js/FreeCapCutShaders.js');
    const { SetMaterialCommand } = await import('./js/commands/SetMaterialCommand.js');
    const { SetMaterialValueCommand } = await import('./js/commands/SetMaterialValueCommand.js');
    editor.execute(new SetMaterialCommand(editor, mesh, mod.createFreeFilmCutShaderMaterial('ShaderMaterial', mesh.material)));
    const cmd = new SetMaterialValueCommand(editor, mesh, 'uniforms', mod.normalizeShaderUniforms({
      map: { value: null }, color: { value: [1, 0, 0] }, color2: { value: [0, 0, 1] },
      opacity: { value: 1 }, uTime: { value: 0 }, useMap: { value: false }
    }));
    cmd.updatable = false;
    editor.execute(cmd);
    // force save after loading flag is false
    editor.isLoadingState = false;
    const json = editor.toJSON();
    // verify scrub
    const mat = Object.values(json.scene.materials)[0];
    window.__scrubCheck = { hasColor: mat.color !== undefined, hasMap: mat.map !== undefined, hasUniformColor: !!mat.uniforms.color, type: mat.type };
    await new Promise(r => { editor.storage.set(json); setTimeout(r, 300); });
  });

  const scrub = await page.evaluate(() => window.__scrubCheck);
  console.log('SCRUB', scrub);

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(3500);

  const after = await page.evaluate(() => ({
    children: window.editor.scene.children.map(c => c.name + ':' + c.type + ':' + (c.material && c.material.type)),
    outliner: document.getElementById('outliner') && document.getElementById('outliner').innerText,
    hasColorBridge: !!(window.editor.scene.children[0] && window.editor.scene.children[0].material && window.editor.scene.children[0].material.color),
    loading: window.editor.isLoadingState,
  }));
  console.log('AFTER', after);
  console.log('LOGS\n' + logs.filter(l => /PAGEERROR|error|Error|Restored|Saved|failed|FreeFilmCut/i.test(l)).join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
