// Does post-processing touch the SS-Camera UI layer?
// Method: capture the set of "white text" pixels with post OFF, then enable `invert`
// (flips the whole composer buffer) and re-check those same pixels.
//   UI inside post  -> previously-white text pixels become BLACK
//   UI after  post  -> they stay WHITE (the UI is pasted on top of the inverted frame)
import { chromium } from 'playwright';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve( path.dirname( fileURLToPath( import.meta.url ) ), '..' );
const files = [
  [ 'overlay', 'projects/sweep-demo/project.json' ],
  [ 'camera ', 'projects/sweep-demo/project-camera.json' ],
];

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );

for ( const [ tag, f ] of files ) {

  const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
  const errs = [];
  page.on( 'pageerror', ( e ) => errs.push( 'PAGEERROR: ' + e.message ) );
  await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
  await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
  await page.waitForTimeout( 500 );
  await page.locator( 'form input[type=file][accept=".json"]' ).first().setInputFiles( path.join( ROOT, f ) );

  await page.waitForFunction( () => {
    let n = 0;
    window.editor.scene.traverse( ( o ) => {
      const ui = o.userData && o.userData.fccUI;
      if ( ui && ui.type === 'canvas' ) n ++;
    } );
    return n > 0;
  }, null, { timeout: 20000 } ).catch( () => errs.push( 'LOAD TIMEOUT: no fccUI canvas' ) );
  await page.waitForTimeout( 1500 );

  const info = await page.evaluate( () => {
    const ed = window.editor;
    const canvases = [];
    let texts = 0;
    ed.scene.traverse( ( o ) => {
      const ui = o.userData && o.userData.fccUI;
      if ( ! ui ) return;
      if ( ui.type === 'canvas' ) canvases.push( { mode: ui.renderMode || 'overlay', visible: o.visible, cam: ui.cameraUuid || null } );
      if ( ui.type === 'text' ) texts ++;
    } );
    return {
      t: ed.textAnimTime,
      canvases,
      texts,
      vpCam: ed.viewportCamera && ed.viewportCamera.name,
      vpLayers: ed.viewportCamera && ed.viewportCamera.layers.mask,
    };
  } );

  await page.evaluate( () => {
    const ed = window.editor, gl = ed.renderer.getContext();
    window.__snap = null;
    window.__mask = null;
    ed.signals.sceneRendered.add( () => {
      if ( ! window.__want ) return;
      window.__want = false;
      const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
      const buf = new Uint8Array( w * h * 4 );
      gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
      const isWhite = ( i ) => buf[ i ] > 200 && buf[ i + 1 ] > 200 && buf[ i + 2 ] > 200 && buf[ i + 3 ] > 8;
      let white = 0, black = 0;
      for ( let i = 0; i < buf.length; i += 4 ) {
        if ( isWhite( i ) ) white ++;
        else if ( buf[ i ] < 40 && buf[ i + 1 ] < 40 && buf[ i + 2 ] < 40 && buf[ i + 3 ] > 8 ) black ++;
      }
      const s = { w, h, white, black };
      if ( window.__mode === 'mask' ) {

        const mask = [];
        for ( let i = 0; i < buf.length; i += 4 ) if ( isWhite( i ) ) mask.push( i );
        window.__mask = mask;
        s.maskCount = mask.length;

      } else if ( window.__mode === 'check' && window.__mask ) {

        let stillWhite = 0, nowBlack = 0, other = 0;
        for ( const i of window.__mask ) {

          if ( isWhite( i ) ) stillWhite ++;
          else if ( buf[ i ] < 40 && buf[ i + 1 ] < 40 && buf[ i + 2 ] < 40 ) nowBlack ++;
          else other ++;

        }
        Object.assign( s, { stillWhite, nowBlack, other } );

      }
      window.__snap = s;
    } );
  } );

  const frame = async ( mode ) => {

    await page.evaluate( ( mode ) => {

      window.__mode = mode;
      window.__want = true;
      window.editor.signals.windowResize.dispatch();

    }, mode );
    await page.waitForTimeout( 900 );
    return page.evaluate( () => window.__snap );

  };

  const setPost = ( on ) => page.evaluate( ( on ) => {

    const cam = window.editor.viewportCamera;
    if ( on ) cam.userData.postProcessStack = { effects: [ { id: 'inv1', type: 'invert', enabled: true, params: {} } ] };
    else delete cam.userData.postProcessStack;
    window.editor.signals.windowResize.dispatch();

  }, on );

  const setT = ( t ) => page.evaluate( ( t ) => {

    window.editor.textAnimTime = t;
    window.editor.signals.windowResize.dispatch();

  }, t );

  console.log( `\n== ${ tag }  ${ f }` );
  console.log( '   ' + JSON.stringify( info ) );

  for ( const t of [ 0.9, 1.6 ] ) {

    await setPost( false );
    await setT( t );
    await page.waitForTimeout( 700 );
    const a = await frame( 'mask' );
    await setPost( true );
    await page.waitForTimeout( 700 );
    const b = await frame( 'check' );
    await setPost( false );
    console.log( `   t=${ t }  mask=${ a.maskCount }  ->  stillWhite=${ b.stillWhite }  nowBlack=${ b.nowBlack }  other=${ b.other }` );

  }

  console.log( '   errors:', errs.slice( 0, 3 ) );
  await page.close();

}

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
