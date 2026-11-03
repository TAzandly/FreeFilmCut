// Focused diagnostic: with `invert` on, print the actual pixel values along the
// text line so we can see whether the UI is inside the post chain or pasted on top.
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const errs = [];
page.on( 'pageerror', ( e ) => errs.push( 'PAGEERROR: ' + e.message ) );
page.on( 'console', ( m ) => { if ( m.type() === 'error' ) errs.push( 'CONSOLE: ' + m.text() ); } );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 500 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
  .setInputFiles( path.join( ROOT, 'projects/sweep-demo/project-camera.json' ) );
await page.waitForTimeout( 3000 );

await page.evaluate( () => {
  const ed = window.editor, gl = ed.renderer.getContext();
  window.__snap = null;
  ed.signals.sceneRendered.add( () => {
    if ( ! window.__want ) return;
    window.__want = false;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    const buf = new Uint8Array( w * h * 4 );
    gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
    // bbox of "bright" pixels
    let minX = 1e9, maxX = -1, minY = 1e9, maxY = -1, lit = 0;
    for ( let i = 0; i < buf.length; i += 4 ) {
      if ( buf[ i ] < 200 || buf[ i + 1 ] < 200 || buf[ i + 2 ] < 200 ) continue;
      lit ++; const p = i / 4, x = p % w, y = ( p / w ) | 0;
      if ( x < minX ) minX = x; if ( x > maxX ) maxX = x;
      if ( y < minY ) minY = y; if ( y > maxY ) maxY = y;
    }
    const yMid = ( ( minY + maxY ) / 2 ) | 0;
    const row = [];
    for ( let x = minX - 10; x < maxX + 10; x += 25 ) {
      const i = ( yMid * w + x ) * 4;
      row.push( x + ':' + buf[ i ] + ',' + buf[ i + 1 ] + ',' + buf[ i + 2 ] );
    }
    window.__snap = { w, h, lit, bbox: [ minX, maxX, minY, maxY ], yMid, row, passes: window.__passes };
  } );
} );

const shoot = async ( postOn ) => {

  await page.evaluate( async ( on ) => {
    const ed = window.editor;
    if ( on ) ed.viewportCamera.userData.postProcessStack = { effects: [ { id: 'i', type: 'invert', enabled: true, params: {} } ] };
    else delete ed.viewportCamera.userData.postProcessStack;
    ed.textAnimTime = 1.6;
    window.__want = true;
    ed.signals.windowResize.dispatch();
    await new Promise( ( r ) => setTimeout( r, 800 ) );
  }, postOn );
  return page.evaluate( () => window.__snap );

};

const off = await shoot( false );
const on = await shoot( true );

console.log( 'post OFF', JSON.stringify( { lit: off.lit, bbox: off.bbox } ) );
console.log( '   row:', off.row.slice( 0, 8 ).join( '  ' ) );
console.log( 'post ON ', JSON.stringify( { lit: on.lit, bbox: on.bbox } ) );
console.log( '   row:', on.row.slice( 0, 8 ).join( '  ' ) );
console.log( 'errors', errs.slice( 0, 4 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
