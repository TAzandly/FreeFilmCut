import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
  .setInputFiles( path.resolve( '_tanim_check/cases/camera_viewport.json' ) );
await page.waitForTimeout( 2500 );

const res = await page.evaluate( async () => {
  const ed = window.editor;
  const THREE = await import( 'three' );
  const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-103' );
  // produce a wipe texture (debug on so the capture runs)
  ed.textAnimWipeDebug = true;
  ed.textAnimTime = 0.9;
  ed.signals.windowResize.dispatch();
  await new Promise( ( r ) => setTimeout( r, 900 ) );
  const dbg = ed._fccCameraWipeDbg;
  if ( ! dbg ) return { err: 'no dbg' };
  const tex = dbg.tex;
  ed.textAnimWipeDebug = false;

  let canvas = null, text = null;
  ed.scene.traverse( ( o ) => {
    const ui = o.userData && o.userData[ UC.FCC_UI_KEY ];
    if ( ui && ui.type === 'canvas' ) canvas = o;
    if ( ui && ui.type === 'text' ) text = o;
  } );
  const ui = { ...text.userData[ UC.FCC_UI_KEY ] };
  ui.textAnim = { ...ui.textAnim, enabled: false };
  text.userData[ UC.FCC_UI_KEY ] = ui;

  const gl = ed.renderer.getContext();
  const grab = () => new Promise( ( resolve ) => {
    window.__grabNext = true; window.__grabOut = null;
    ed.signals.windowResize.dispatch();
    const t0 = performance.now();
    const tick = () => {
      if ( window.__grabOut ) return resolve( window.__grabOut );
      if ( performance.now() - t0 > 1500 ) return resolve( null );
      requestAnimationFrame( tick );
    };
    tick();
  } );
  ed.signals.sceneRendered.add( () => {
    if ( ! window.__grabNext ) return;
    window.__grabNext = false;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array( w * h * 4 );
    gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
    let lit = 0;
    for ( let i = 0; i < buf.length; i += 4 ) if ( buf[ i ] > 200 && buf[ i + 1 ] > 200 && buf[ i + 2 ] > 200 ) lit ++;
    window.__grabOut = { lit };
  } );

  const place = ( mat ) => {
    const q = new THREE.Mesh( new THREE.PlaneGeometry( 1920, 1080 ), mat );
    q.position.set( 960, 540, 0 );
    q.layers.set( UC.UI_CAMERA_LAYER );
    q.frustumCulled = false;
    q.renderOrder = 1000;
    canvas.add( q );
    return q;
  };

  const basic = place( new THREE.MeshBasicMaterial( { map: tex, transparent: true, depthTest: true, depthWrite: false, toneMapped: false } ) );
  const r1 = await grab();
  canvas.remove( basic ); basic.geometry.dispose(); basic.material.dispose();

  const sh = new THREE.ShaderMaterial( {
    uniforms: { tDiffuse: { value: tex }, uOpacity: { value: 1 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4( position, 1.0 ); }',
    fragmentShader: 'uniform sampler2D tDiffuse; uniform float uOpacity; varying vec2 vUv; void main(){ vec4 c = texture2D( tDiffuse, vUv ); if ( c.a < 0.001 ) discard; gl_FragColor = vec4( c.rgb, c.a * uOpacity ); }',
    transparent: true, depthTest: true, depthWrite: false, toneMapped: false, premultipliedAlpha: false,
  } );
  const q2 = place( sh );
  const r2 = await grab();
  canvas.remove( q2 ); q2.geometry.dispose(); sh.dispose();

  return { basicQuad: r1, shaderQuad: r2, texType: tex.type };
} );

console.log( JSON.stringify( res, null, 1 ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
