import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
  .setInputFiles( path.resolve( '_tanim_check/cases/overlay.json' ) );
await page.waitForTimeout( 2600 );

await page.evaluate( () => {
  const ed = window.editor; const gl = ed.renderer.getContext();
  window.__grab = null;
  ed.signals.sceneRendered.add( () => {
    if ( ! window.__grabNext ) return;
    window.__grabNext = false;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array( w * h * 4 );
    gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
    let lit = 0, maxX = -1, minY = 1e9, maxY = -1;
    for ( let i = 0; i < buf.length; i += 4 ) {
      if ( buf[ i ] < 200 || buf[ i+1 ] < 200 || buf[ i+2 ] < 200 ) continue;
      lit ++; const p = i/4, x = p % w, y = ( p / w ) | 0;
      if ( x > maxX ) maxX = x; if ( y < minY ) minY = y; if ( y > maxY ) maxY = y;
    }
    window.__grab = { lit, maxX, minY, maxY };
  } );
} );

const grab = async ( t ) => {
  await page.evaluate( async ( t ) => {
    const ed = window.editor;
    ed.textAnimTime = t;
    window.__grab = null; window.__grabNext = true;
    ed.signals.windowResize.dispatch();
    await new Promise( ( r ) => setTimeout( r, 700 ) );
  }, t );
  return page.evaluate( () => window.__grab );
};

// emulate the sidebar dropdown: set renderMode + rebindCanvasSubtree + signals
const setMode = async ( mode ) => {
  await page.evaluate( async ( mode ) => {
    const ed = window.editor;
    const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-104' );
    const RL = await import( './js/ui/UIRectLayout.js?v=fcc-ui-104' );
    let canvas = null;
    ed.scene.traverse( ( o ) => { const ui = o.userData && o.userData[ UC.FCC_UI_KEY ]; if ( ui && ui.type === 'canvas' ) canvas = o; } );
    const ui = { ...canvas.userData[ UC.FCC_UI_KEY ] };
    ui.renderMode = mode === 'camera' ? UC.RENDER_MODE_CAMERA : UC.RENDER_MODE_OVERLAY;
    if ( ! ui.planeDistance ) ui.planeDistance = UC.DEFAULT_PLANE_DISTANCE;
    delete ui.cameraUuid;
    canvas.userData[ UC.FCC_UI_KEY ] = ui;
    RL.rebindCanvasSubtree( canvas );
    ed.select( null ); ed.select( canvas );
    ed.signals.sceneGraphChanged.dispatch();
    ed.signals.windowResize.dispatch();
    await new Promise( ( r ) => setTimeout( r, 800 ) );
  }, mode );
};

console.log( 'overlay  t=0.9:', JSON.stringify( await grab( 0.9 ) ) );
await setMode( 'camera' );
console.log( '-> cam   t=0.9:', JSON.stringify( await grab( 0.9 ) ) );
console.log( '-> cam   t=1.6:', JSON.stringify( await grab( 1.6 ) ) );
await setMode( 'overlay' );
console.log( '-> over  t=0.9:', JSON.stringify( await grab( 0.9 ) ) );
console.log( 'errors:', logs.slice( 0, 3 ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
