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
  let canvas = null, text = null;
  ed.scene.traverse( ( o ) => {
    const ui = o.userData && o.userData[ UC.FCC_UI_KEY ];
    if ( ui && ui.type === 'canvas' ) canvas = o;
    if ( ui && ui.type === 'text' ) text = o;
  } );

  // 1) turn the wipe off so nothing is hidden
  const ui = { ...text.userData[ UC.FCC_UI_KEY ] };
  ui.textAnim = { ...ui.textAnim, enabled: false };
  text.userData[ UC.FCC_UI_KEY ] = ui;

  // 2) add a plain white quad at the same place the composite quad uses
  const q = new THREE.Mesh(
    new THREE.PlaneGeometry( 1920, 1080 ),
    new THREE.MeshBasicMaterial( { color: 0xffffff, transparent: true, depthTest: false, depthWrite: false, side: THREE.DoubleSide, toneMapped: false } )
  );
  q.name = 'TESTQUAD';
  q.position.set( 960, 540, 0 );
  q.layers.set( UC.UI_CAMERA_LAYER );
  q.frustumCulled = false;
  q.renderOrder = 1000;
  canvas.add( q );

  const gl = ed.renderer.getContext();
  ed.signals.windowResize.dispatch();
  await new Promise( ( r ) => setTimeout( r, 700 ) );

  let grab = null;
  window.__grabNext = true;
  window.__grabOut = null;
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
  ed.signals.windowResize.dispatch();
  await new Promise( ( r ) => setTimeout( r, 700 ) );
  grab = window.__grabOut;

  // 3) same quad but parented to the SCENE instead of the canvas
  canvas.remove( q );
  ed.scene.add( q );
  q.position.set( 0, 0, 0 );
  const cw = new THREE.Vector3();
  canvas.getWorldPosition( cw );
  q.quaternion.copy( canvas.quaternion );
  q.scale.copy( canvas.scale );
  q.position.copy( cw );
  q.updateMatrixWorld( true );
  let grab2 = null;
  window.__grabNext = true;
  window.__grabOut = null;
  ed.signals.windowResize.dispatch();
  await new Promise( ( r ) => setTimeout( r, 700 ) );
  grab2 = window.__grabOut;

  ed.scene.remove( q );
  q.geometry.dispose(); q.material.dispose();

  return { quadAsCanvasChild: grab, quadAtSceneRoot: grab2, canvasScale: canvas.scale.toArray(), canvasPos: canvas.position.toArray().map( v => +v.toFixed( 2 ) ) };
} );

console.log( JSON.stringify( res, null, 1 ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
