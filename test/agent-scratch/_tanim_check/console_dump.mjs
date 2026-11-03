import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text().slice( 0, 400 ) ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message.slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
  .setInputFiles( path.resolve( '_tanim_check/cases/camera_viewport.json' ) );
await page.waitForTimeout( 2500 );
logs.length = 0;
await page.evaluate( () => { window.editor.textAnimTime = 0.9; window.editor.signals.windowResize.dispatch(); } );
await page.waitForTimeout( 1500 );
console.log( 'renderer:', await page.evaluate( () => window.editor.renderer.constructor.name + ' / ' + ( window.editor.renderer.isWebGPURenderer ? 'webgpu' : 'webgl' ) ) );
console.log( logs.filter( ( l ) => ! /IDBObjectStore/.test( l ) ).slice( 0, 25 ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
