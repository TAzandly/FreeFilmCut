import { chromium } from 'playwright';
import path from 'node:path';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text().slice( 0, 300 ) ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
  .setInputFiles( path.resolve( '_tanim_check/cases/camera_viewport.json' ) );
await page.waitForTimeout( 2500 );
await page.evaluate( () => { window.editor.textAnimWipeDebug = true; window.editor.textAnimTime = 0.9; window.editor._fccWipeDbgLogged = false; window.editor.signals.windowResize.dispatch(); } );
await page.waitForTimeout( 1200 );

const out = await page.evaluate( async () => {
  const ed = window.editor;
  const THREE = await import( 'three' );
  const dbg = ed._fccCameraWipeDbg;
  if ( ! dbg ) return { err: 'no debug stash' };
  const read = ( target, label ) => {
    const w = target.width, h = target.height;
    const buf = new Uint8Array( w * h * 4 );
    ed.renderer.readRenderTargetPixels( target, 0, 0, w, h, buf );
    let nonzero = 0, maxA = 0, maxRGB = 0;
    for ( let i = 0; i < buf.length; i += 4 ) {
      const a = buf[ i + 3 ];
      const m = Math.max( buf[ i ], buf[ i + 1 ], buf[ i + 2 ] );
      if ( a > 2 ) nonzero ++;
      if ( a > maxA ) maxA = a;
      if ( m > maxRGB ) maxRGB = m;
    }
    return { label, w, h, nonzero, maxA, maxRGB };
  };
  const capStats = read( dbg.capture, 'capture' );

  // blit the wipe output into a readable RT
  const rt = new THREE.WebGLRenderTarget( 256, 144, { type: THREE.UnsignedByteType } );
  const scene = new THREE.Scene();
  const cam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
  const quad = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), new THREE.MeshBasicMaterial( { map: dbg.tex, transparent: true, depthTest: false, toneMapped: false } ) );
  scene.add( quad );
  const prev = ed.renderer.getRenderTarget();
  ed.renderer.setRenderTarget( rt );
  ed.renderer.setClearColor( 0x000000, 0 );
  ed.renderer.clear( true, true, true );
  ed.renderer.render( scene, cam );
  ed.renderer.setRenderTarget( prev );
  const texStats = read( rt, 'wipe-tex' );
  rt.dispose(); quad.geometry.dispose(); quad.material.dispose();
  return { capture: capStats, tex: texStats, texInfo: { type: dbg.tex.type, cs: dbg.tex.colorSpace }, layout: dbg.layout };
} );

console.log( JSON.stringify( out, null, 1 ) );
console.log( 'wipeLog:', logs.filter( ( l ) => l.includes( 'alpha-AABB' ) ).slice( - 2 ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
