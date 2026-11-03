import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
  .setInputFiles( path.resolve( '_tanim_check/cases/camera_scenecam.json' ) );
await page.waitForTimeout( 2500 );
await page.evaluate( async () => {
  const ed = window.editor;
  let cam = null;
  ed.scene.traverse( ( o ) => { if ( o.isCamera ) cam = o; } );
  if ( cam ) ed.setViewportCamera( cam.uuid );
  const gl = ed.renderer.getContext();
  window.__grab = null;
  ed.signals.sceneRendered.add( () => {
    if ( ! window.__grabNext ) return;
    window.__grabNext = false;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array( w * h * 4 );
    gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
    let lit = 0, minX = 1e9, maxX = -1, minY = 1e9, maxY = -1;
    for ( let i = 0; i < buf.length; i += 4 ) {
      if ( buf[ i ] < 200 || buf[ i+1 ] < 200 || buf[ i+2 ] < 200 ) continue;
      lit ++; const p = i/4, x = p % w, y = ( p / w ) | 0;
      if ( x < minX ) minX = x; if ( x > maxX ) maxX = x;
      if ( y < minY ) minY = y; if ( y > maxY ) maxY = y;
    }
    window.__grab = { lit, minX, maxX, minY, maxY };
  } );
} );

const shot = async ( wipeOn, t ) => {
  await page.evaluate( async ( { wipeOn, t } ) => {
    const ed = window.editor;
    const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-104' );
    let text = null;
    ed.scene.traverse( ( o ) => { const ui = o.userData && o.userData[ UC.FCC_UI_KEY ]; if ( ui && ui.type === 'text' ) text = o; } );
    const ui = { ...text.userData[ UC.FCC_UI_KEY ] };
    ui.textAnim = { ...ui.textAnim, enabled: wipeOn };
    text.userData[ UC.FCC_UI_KEY ] = ui;
    ed.textAnimTime = t;
    window.__grab = null; window.__grabNext = true;
    ed.signals.windowResize.dispatch();
    await new Promise( ( r ) => setTimeout( r, 700 ) );
  }, { wipeOn, t } );
  return page.evaluate( () => window.__grab );
};

console.log( 'wipe OFF t=1.6:', JSON.stringify( await shot( false, 1.6 ) ) );
console.log( 'wipe ON  t=1.6:', JSON.stringify( await shot( true, 1.6 ) ) );
console.log( 'wipe ON  t=0.9:', JSON.stringify( await shot( true, 0.9 ) ) );
console.log( 'vpCam:', await page.evaluate( () => { const c = window.editor.viewportCamera; return { name: c.name, fov: c.fov, aspect: +c.aspect.toFixed(3), near: c.near, far: c.far }; } ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
