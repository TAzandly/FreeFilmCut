import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
  .setInputFiles( path.resolve( '_tanim_check/cases/camera_viewport.json' ) );
await page.waitForTimeout( 2600 );

const st = await page.evaluate( async () => {
  const ed = window.editor;
  const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-104' );
  let canvas = null, text = null;
  ed.scene.traverse( ( o ) => {
    const ui = o.userData && o.userData[ UC.FCC_UI_KEY ];
    if ( ui && ui.type === 'canvas' ) canvas = o;
    if ( ui && ui.type === 'text' ) text = o;
  } );
  // run a few frames of the wipe
  for ( const t of [ 0, 0.4, 0.9, 1.3 ] ) {
    ed.textAnimTime = t;
    ed.signals.windowResize.dispatch();
    await new Promise( ( r ) => setTimeout( r, 200 ) );
  }
  const raw = JSON.stringify( ed.toJSON() );
  return {
    canvasVisible: canvas.visible,
    textVisible: text.visible,
    textChildrenVisible: text.children.every( ( c ) => c.visible ),
    savedHidden: raw.includes( '"visible":false' ),
    savedQuad: raw.includes( 'UICaptureQuad' ),
    canvasMode: canvas.userData[ UC.FCC_UI_KEY ].renderMode,
  };
} );
console.log( JSON.stringify( st, null, 1 ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|TypeError|Shader/i.test( l ) ).slice( 0, 5 ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
