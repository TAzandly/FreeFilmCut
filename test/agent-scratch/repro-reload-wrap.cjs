const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const context = await browser.newContext();
  const page = await context.newPage();
  const logs = [];
  page.on('pageerror', e => logs.push('PAGEERROR ' + e.message + '\n' + (e.stack||'').slice(0,400)));
  page.on('console', m => logs.push(m.type() + ' ' + m.text().slice(0, 250)));
  page.on('crash', () => logs.push('CRASH'));

  await page.goto('http://localhost:5174/editor/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  // Seed a shader cube into IDB
  await page.evaluate(async () => {
    const editor = window.editor;
    const THREE = window.THREE;
    [...editor.scene.children].forEach(c => editor.removeObject(c));
    const mesh = new THREE.Mesh(new THREE.BoxGeometry(), new THREE.MeshStandardMaterial({color:0xff0000}));
    mesh.name = 'SeedCube';
    editor.addObject(mesh);
    const mod = await import('./js/FreeCapCutShaders.js');
    const { SetMaterialCommand } = await import('./js/commands/SetMaterialCommand.js');
    const { SetMaterialValueCommand } = await import('./js/commands/SetMaterialValueCommand.js');
    editor.execute(new SetMaterialCommand(editor, mesh, mod.createFreeFilmCutShaderMaterial('ShaderMaterial', mesh.material)));
    const cmd = new SetMaterialValueCommand(editor, mesh, 'uniforms', mod.normalizeShaderUniforms({
      map:{value:null}, color:{value:[1,0,0]}, color2:{value:[0,0,1]}, opacity:{value:1}, uTime:{value:0}, useMap:{value:false}
    }));
    cmd.updatable = false;
    editor.execute(cmd);
    // Disable autosave temporarily by config
    editor.config.setKey('autosave', false);
    await new Promise(r => { editor.storage.set(editor.toJSON()); setTimeout(r, 300); });
    editor.config.setKey('autosave', true);
  });

  logs.length = 0;

  // Patch fromJSON before reload via init script
  await page.addInitScript(() => {
    window.__fccDiag = [];
    const push = (m) => window.__fccDiag.push(m);
    window.addEventListener('unhandledrejection', (e) => {
      push('unhandledrejection: ' + (e.reason && (e.reason.message || e.reason)));
    });
    // Wrap after editor exists - poll
    const iv = setInterval(() => {
      if (!window.editor || !window.editor.fromJSON || window.editor.__fccWrapped) return;
      clearInterval(iv);
      const orig = window.editor.fromJSON.bind(window.editor);
      window.editor.fromJSON = async function(json) {
        push('fromJSON start children=' + this.scene.children.length + ' jsonChildren=' + (json.scene && json.scene.object && json.scene.object.children && json.scene.object.children.length));
        push('json geos=' + (json.scene && json.scene.geometries && Object.keys(json.scene.geometries).length) + ' mats=' + (json.scene && json.scene.materials && Object.keys(json.scene.materials).length));
        try {
          const result = await orig(json);
          push('fromJSON done children=' + this.scene.children.length + ' names=' + this.scene.children.map(c=>c.name).join(','));
          return result;
        } catch (e) {
          push('fromJSON THROW: ' + e.message);
          push(String(e.stack||'').slice(0,500));
          throw e;
        }
      };
      window.editor.__fccWrapped = true;
      push('wrapped fromJSON');
    }, 10);
  });

  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForTimeout(4000);

  const diag = await page.evaluate(() => ({
    fccDiag: window.__fccDiag || [],
    children: window.editor.scene.children.map(c => c.name+':'+c.type),
    outliner: document.getElementById('outliner') && document.getElementById('outliner').innerText,
    autosave: window.editor.config.getKey('autosave'),
  }));

  console.log('DIAG', JSON.stringify(diag, null, 2));
  console.log('LOGS\n' + logs.filter(l => /PAGEERROR|unhandled|error|Error|Restored|Saved|fromJSON|fcc/i.test(l)).join('\n'));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
