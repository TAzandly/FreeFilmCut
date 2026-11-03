import { chromium } from 'playwright';
import path from 'node:path';
const files = [ 'projects/sweep-demo/project.json', 'projects/sweep-demo/project-camera.json' ];
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
for ( const f of files ) {
  const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
  const logs = [];
  page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
  page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
  await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
  await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
  await page.waitForTimeout( 400 );
  await page.evaluate( () => { window.editor.textAnimWipeDebug = true; } );
  await page.locator( 'form input[type=file][accept=".json"]' ).first().setInputFiles( path.resolve( f ) );
  await page.waitForTimeout( 2800 );
  const aabb = logs.filter( ( l ) => l.includes( 'progress' ) ).slice( - 1 )[ 0 ] || 'none';
  await page.evaluate( () => {
    window.editor.textAnimWipeDebug = false;
    const ed = window.editor, gl = ed.renderer.getContext();
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
  const curve = {};
  for ( const t of [ 0, 0.45, 0.9, 1.3, 1.6 ] ) {
    await page.evaluate( async ( t ) => {
      const ed = window.editor;
      ed.textAnimTime = t; window.__grab = null; window.__grabNext = true;
      ed.signals.windowResize.dispatch();
      await new Promise( ( r ) => setTimeout( r, 650 ) );
    }, t );
    curve[ t ] = await page.evaluate( () => window.__grab );
  }
  console.log( '\n==', f );
  console.log( '   previewTime:', await page.evaluate( () => window.editor.textAnimTime ) );
  console.log( '   AABB:', aabb );
  console.log( '   curve:', JSON.stringify( curve ) );
  console.log( '   errors:', logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) ).slice( 0, 3 ) );
  await page.close();
}
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
