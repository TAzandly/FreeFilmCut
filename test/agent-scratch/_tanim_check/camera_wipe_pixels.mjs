// End-to-end pixel check (no screenshots): read the drawing buffer synchronously
// inside sceneRendered and compare how much of the text is lit in overlay vs
// SS-Camera mode at the same wipe progress.
import { chromium } from 'playwright';
import path from 'node:path';

const file = path.resolve( 'projects/sweep-demo/project.json' );

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 500 );
await page.locator( 'form input[type=file][accept=".json"]' ).first().setInputFiles( file );
await page.waitForTimeout( 2600 );

// Install a synchronous frame grabber.
await page.evaluate( () => {

	const ed = window.editor;
	const gl = ed.renderer.getContext();
	window.__grab = null;
	window.__armGrab = () => { window.__grabNext = true; };

	ed.signals.sceneRendered.add( () => {

		if ( ! window.__grabNext ) return;
		window.__grabNext = false;

		const w = gl.drawingBufferWidth;
		const h = gl.drawingBufferHeight;
		const buf = new Uint8Array( w * h * 4 );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );

		let lit = 0, minX = 1e9, maxX = - 1, minY = 1e9, maxY = - 1, sumX = 0;
		for ( let y = 0; y < h; y ++ ) {

			for ( let x = 0; x < w; x ++ ) {

				const i = ( y * w + x ) * 4;
				// White-ish glyph interior only (grid/helpers are grey, < 200).
				if ( buf[ i ] < 200 || buf[ i + 1 ] < 200 || buf[ i + 2 ] < 200 ) continue;
				lit ++;
				sumX += x;
				if ( x < minX ) minX = x;
				if ( x > maxX ) maxX = x;
				if ( y < minY ) minY = y;
				if ( y > maxY ) maxY = y;

			}

		}

		window.__grab = {
			w, h, lit,
			minX, maxX, minY, maxY,
			centroidX: lit ? + ( sumX / lit ).toFixed( 1 ) : null,
		};

	} );

} );

async function shot( mode, time ) {

	await page.evaluate( async ( { mode, time } ) => {

		const UC = await import( './js/ui/UIConstants.js?v=' + 'fcc-ui-103' );
		const RL = await import( './js/ui/UIRectLayout.js?v=' + 'fcc-ui-103' );
		const ed = window.editor;
		let canvas = null;
		ed.scene.traverse( ( o ) => {

			const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
			if ( ui && ui.type === 'canvas' ) canvas = o;

		} );
		const ui = { ...canvas.userData[ UC.FCC_UI_KEY ] };
		ui.renderMode = mode === 'camera' ? UC.RENDER_MODE_CAMERA : UC.RENDER_MODE_OVERLAY;
		ui.planeDistance = ui.planeDistance ?? UC.DEFAULT_PLANE_DISTANCE;
		delete ui.cameraUuid;
		canvas.userData[ UC.FCC_UI_KEY ] = ui;
		RL.rebindCanvasSubtree( canvas );
		ed.textAnimTime = time;
		ed.signals.sceneGraphChanged.dispatch();
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 500 ) );
		window.__grab = null;
		window.__grabNext = true;
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 500 ) );

	}, { mode, time } );

	return page.evaluate( () => window.__grab );

}

const out = {};
for ( const mode of [ 'overlay', 'camera' ] ) {

	out[ mode ] = {};
	for ( const t of [ 0, 0.9, 1.6 ] ) {

		out[ mode ][ 't=' + t ] = await shot( mode, t );

	}

}

console.log( JSON.stringify( out, null, 2 ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) ).slice( 0, 5 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
