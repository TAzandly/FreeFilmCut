// SS-Camera bound to a scene camera + view through it (the common setup).
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
await page.evaluate( () => { window.editor.textAnimWipeDebug = true; } );
await page.locator( 'form input[type=file][accept=".json"]' ).first().setInputFiles( file );
await page.waitForTimeout( 2600 );

await page.evaluate( () => {

	const ed = window.editor;
	const gl = ed.renderer.getContext();
	window.__grab = null;
	ed.signals.sceneRendered.add( () => {

		if ( ! window.__grabNext ) return;
		window.__grabNext = false;
		const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
		const buf = new Uint8Array( w * h * 4 );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
		let lit = 0, minX = 1e9, maxX = - 1, minY = 1e9, maxY = - 1;
		for ( let i = 0; i < buf.length; i += 4 ) {

			if ( buf[ i ] < 200 || buf[ i + 1 ] < 200 || buf[ i + 2 ] < 200 ) continue;
			lit ++;
			const p = i / 4;
			const x = p % w, y = ( p / w ) | 0;
			if ( x < minX ) minX = x;
			if ( x > maxX ) maxX = x;
			if ( y < minY ) minY = y;
			if ( y > maxY ) maxY = y;

		}

		window.__grab = { lit, minX, maxX, minY, maxY };

	} );

} );

async function shot( label, apply ) {

	await page.evaluate( async ( { apply } ) => {

		const UC = await import( './js/ui/UIConstants.js?v=' + 'fcc-ui-103' );
		const RL = await import( './js/ui/UIRectLayout.js?v=' + 'fcc-ui-103' );
		const ed = window.editor;
		let canvas = null, camObj = null;
		ed.scene.traverse( ( o ) => {

			const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
			if ( ui && ui.type === 'canvas' ) canvas = o;
			if ( o.isCamera ) camObj = o;

		} );
		const ui = { ...canvas.userData[ UC.FCC_UI_KEY ] };
		if ( apply === 'overlay' ) {

			ui.renderMode = UC.RENDER_MODE_OVERLAY;
			delete ui.cameraUuid;
			ed.setViewportCamera( '__editor__' );

		} else if ( apply === 'camera-editor' ) {

			ui.renderMode = UC.RENDER_MODE_CAMERA;
			delete ui.cameraUuid;
			ed.setViewportCamera( '__editor__' );

		} else if ( apply === 'camera-scene' ) {

			ui.renderMode = UC.RENDER_MODE_CAMERA;
			ui.cameraUuid = camObj ? camObj.uuid : null;
			if ( camObj ) ed.setViewportCamera( camObj.uuid );

		}

		canvas.userData[ UC.FCC_UI_KEY ] = ui;
		RL.rebindCanvasSubtree( canvas );
		ed.textAnimTime = 0.9;
		ed._fccWipeDbgLogged = false;
		ed.signals.sceneGraphChanged.dispatch();
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 600 ) );
		window.__grab = null;
		window.__grabNext = true;
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 600 ) );

	}, { apply } );

	const grab = await page.evaluate( () => window.__grab );
	const wipe = logs.filter( ( l ) => l.includes( 'alpha-AABB' ) && l.includes( 'progress' ) ).slice( - 1 );
	logs.length = 0;
	return { label, grab, wipe };

}

const out = [];
out.push( await shot( 'overlay', 'overlay' ) );
out.push( await shot( 'camera @editor cam', 'camera-editor' ) );
out.push( await shot( 'camera @scene cam', 'camera-scene' ) );

for ( const r of out ) console.log( r.label, '| px:', JSON.stringify( r.grab ), '|', r.wipe[ 0 ] || 'no-log' );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) ).slice( 0, 4 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
