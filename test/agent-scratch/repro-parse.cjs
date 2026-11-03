const { chromium } = require('playwright');
(async () => {
  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  page.on('pageerror', e => console.log('PAGEERROR', e.message));
  page.on('console', m => { if (m.type()==='error' || m.type()==='warning') console.log(m.type(), m.text().slice(0,200)); });
  await page.goto('http://localhost:5174/editor/', { waitUntil: 'domcontentloaded', timeout: 60000 });
  await page.waitForTimeout(2000);

  const result = await page.evaluate(async () => {
    const editor = window.editor;
    const THREE = window.THREE;
    // clear scene children
    [...editor.scene.children].forEach(c => editor.removeObject(c));

    const geo = new THREE.BoxGeometry();
    const mat = new THREE.MeshStandardMaterial({ color: 0xff0000 });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.name = 'CubeA';
    editor.addObject(mesh);

    const mod = await import('./js/FreeCapCutShaders.js');
    const { SetMaterialCommand } = await import('./js/commands/SetMaterialCommand.js');
    const { SetMaterialValueCommand } = await import('./js/commands/SetMaterialValueCommand.js');
    const shaderMat = mod.createFreeFilmCutShaderMaterial('ShaderMaterial', mat);
    editor.execute(new SetMaterialCommand(editor, mesh, shaderMat));
    const uniforms = mod.normalizeShaderUniforms({
      map: { value: null }, color: { value: [1,0,0] }, color2: { value: [0,0,1] },
      opacity: { value: 1 }, uTime: { value: 0 }, useMap: { value: false }
    });
    const cmd = new SetMaterialValueCommand(editor, mesh, 'uniforms', uniforms);
    cmd.updatable = false;
    editor.execute(cmd);

    const json = editor.toJSON();
    const sceneJSON = json.scene;

    // Try parse
    let parseResult = {};
    try {
      const loader = new THREE.ObjectLoader();
      const scene = await loader.parseAsync(JSON.parse(JSON.stringify(sceneJSON)));
      parseResult = {
        ok: true,
        childCount: scene.children.length,
        names: scene.children.map(c => c.name),
        matType: scene.children[0] && scene.children[0].material && scene.children[0].material.type,
      };
    } catch (e) {
      parseResult = { ok: false, error: String(e.message||e), stack: String(e.stack||'').slice(0,600) };
    }

    // Compare: strip top-level color/map from shader materials and retry
    let parseStripped = {};
    try {
      const copy = JSON.parse(JSON.stringify(sceneJSON));
      if (copy.materials) {
        for (const m of Object.values(copy.materials)) {
          if (m.type === 'ShaderMaterial' || m.type === 'RawShaderMaterial') {
            delete m.color;
            delete m.map;
            delete m.opacity; // opacity is valid on Material base
          }
        }
      }
      const loader = new THREE.ObjectLoader();
      const scene = await loader.parseAsync(copy);
      parseStripped = { ok: true, childCount: scene.children.length, names: scene.children.map(c => c.name) };
    } catch (e) {
      parseStripped = { ok: false, error: String(e.message||e) };
    }

    // Also try without uniforms useMap bool weirdness
    return {
      geoCount: sceneJSON.geometries ? Object.keys(sceneJSON.geometries).length : 0,
      matCount: sceneJSON.materials ? Object.keys(sceneJSON.materials).length : 0,
      childCount: sceneJSON.object.children.length,
      materialSample: sceneJSON.materials && Object.values(sceneJSON.materials)[0],
      parseResult,
      parseStripped,
      // Does setScene from parsed work?
    };
  });
  console.log(JSON.stringify(result, null, 2));
  await browser.close();
})().catch(e => { console.error(e); process.exit(1); });
