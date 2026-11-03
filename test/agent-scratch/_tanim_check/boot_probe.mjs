import { chromium } from 'playwright';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
page.on( 'pageerror', ( e ) => console.log( 'PAGEERROR:', e.message ) );
page.on( 'console', ( m ) => console.log( m.type().toUpperCase() + ':', m.text() ) );
page.on( 'requestfailed', ( r ) => console.log( 'REQFAIL:', r.url(), r.failure() && r.failure().errorText ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForTimeout( 6000 );
console.log( 'editor?', await page.evaluate( () => typeof window.editor ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 3000 ) ) ] );
