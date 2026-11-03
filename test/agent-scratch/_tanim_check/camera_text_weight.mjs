// Is the "bold text" difference caused by the wipe, or is it how SS-Camera
// renders UI text in general? Measure lit pixels with the wipe ON and OFF.
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

await page.evaluate( () => {

	const ed = window.editor;
	const gl = ed.renderer.getContext();
	window.__grab = null;
	ed.signals.sceneRendered.add( () => {

		if ( ! window.__grabNext ) return;
		window.__grabNext = false;
		const w = gl.drawingBufferWidth;
		const h = gl.drawingBufferHeight;
		const buf = new Uint8Array( w * h * 4 );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
		let lit = 0, ink = 0, sumR = 0, minX = 1e9, maxX = - 1;
		for ( let i = 0; i < buf.length; i += 4 ) {

			const r = buf[ i ], g = buf[ i + 1 ], b = buf[ i + 2 ];
			const lum = Math.max( r, g, b );
			if ( lum > 20 ) {

				ink ++;
				sumR += lum;
				if ( lum > 200 ) {

					lit ++;
					const x = ( i / 4 ) % w;
					if ( x < minX ) minX = x;
					if ( x > maxX ) maxX = x;

				}

			}

		}

		window.__grab = { lit, ink, meanLum: ink ? + ( sumR / ink ).toFixed( 1 ) : 0, minX, maxX };

	} );

} );

async function shot( mode, t, wipeOn ) {

	await page.evaluate( async ( { mode, t, wipeOn } ) => {

		const UC = await import( './js/ui/UIConstants.js?v=' + 'fcc-ui-103' );
		const RL = await import( './js/ui/UIRectLayout.js?v=' + 'fcc-ui-103' );
		const ed = window.editor;
		let canvas = null, text = null;
		ed.scene.traverse( ( o ) => {

			const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
			if ( ui && ui.type === 'canvas' ) canvas = o;
			if ( ui && ui.type === 'text' ) text = o;

		} );
		const ui = { ...canvas.userData[ UC.FCC_UI_KEY ] };
		ui.renderMode = mode === 'camera' ? UC.RENDER_MODE_CAMERA : UC.RENDER_MODE_OVERLAY;
		ui.planeDistance = ui.planeDistance ?? UC.DEFAULT_PLANE_DISTANCE;
		delete ui.cameraUuid;
		canvas.userData[ UC.FCC_UI_KEY ] = ui;
		RL.rebindCanvasSubtree( canvas );

		const tui = { ...text.userData[ UC.FCC_UI_KEY ] };
		if ( tui.textAnim ) {

			tui.textAnim = { ...tui.textAnim, enabled: wipeOn };
			text.userData[ UC.FCC_UI_KEY ] = tui;

		}

		ed.textAnimTime = t;
		ed.signals.sceneGraphChanged.dispatch();
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 500 ) );
		window.__grab = null;
		window.__grabNext = true;
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 500 ) );

	}, { mode, t, wipeOn } );

	return page.evaluate( () => window.__grab );

}

const res = {};
for ( const wipeOn of [ false, true ] ) {

	res[ 'wipe=' + wipeOn ] = {};
	for ( const mode of [ 'overlay', 'camera' ] ) {

		res[ 'wipe=' + wipeOn ][ mode ] = await shot( mode, 1.6, wipeOn );

	}

}

console.log( JSON.stringify( res, null, 2 ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) ).slice( 0, 4 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
