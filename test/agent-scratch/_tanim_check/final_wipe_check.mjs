// Final check: overlay must be unchanged; camera must reveal progressively.
// Debug mask is OFF while measuring pixels, ON only when reading the AABB log.
import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );

async function open( file ) {

	const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
	const logs = [];
	page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
	page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
	await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
	await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
	await page.waitForTimeout( 400 );
	await page.locator( 'form input[type=file][accept=".json"]' ).first()
		.setInputFiles( path.resolve( '_tanim_check/cases', file ) );
	await page.waitForTimeout( 2800 );
	return { page, logs };

}

async function installGrab( page ) {

	await page.evaluate( () => {

		const ed = window.editor;
		const gl = ed.renderer.getContext();
		window.__grab = null;
		window.__grabNext = false;
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
				const p = i / 4, x = p % w, y = ( p / w ) | 0;
				if ( x < minX ) minX = x;
				if ( x > maxX ) maxX = x;
				if ( y < minY ) minY = y;
				if ( y > maxY ) maxY = y;

			}

			window.__grab = { lit, minX, maxX, minY, maxY };

		} );

	} );

}

async function grabAt( page, t ) {

	await page.evaluate( async ( t ) => {

		const ed = window.editor;
		ed.textAnimTime = t;
		window.__grab = null;
		window.__grabNext = true;
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 700 ) );

	}, t );
	return page.evaluate( () => window.__grab );

}

// ---- 1) overlay regression: AABB + reveal curve
{

	const { page, logs } = await open( 'overlay.json' );
	await page.evaluate( () => { window.editor.textAnimWipeDebug = true; window.editor._fccWipeDbgLogged = false; } );
	await page.evaluate( () => { window.editor.textAnimTime = 0.9; window.editor.signals.windowResize.dispatch(); } );
	await page.waitForTimeout( 900 );
	const aabb = logs.filter( ( l ) => l.includes( 'progress' ) ).slice( - 1 );
	await page.evaluate( () => { window.editor.textAnimWipeDebug = false; } );
	await installGrab( page );
	const curve = {};
	for ( const t of [ 0, 0.9, 1.6 ] ) curve[ 't=' + t ] = await grabAt( page, t );
	console.log( 'OVERLAY  aabb:', aabb[ 0 ] || 'none' );
	console.log( 'OVERLAY  pixels:', JSON.stringify( curve ) );
	await page.close();

}

// ---- 2) SS-Camera (viewport camera)
{

	const { page, logs } = await open( 'camera_viewport.json' );
	await installGrab( page );
	const curve = {};
	for ( const t of [ 0, 0.9, 1.6 ] ) curve[ 't=' + t ] = await grabAt( page, t );
	console.log( 'CAMERA   pixels:', JSON.stringify( curve ) );
	console.log( 'CAMERA   errors:', logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) ).slice( 0, 3 ) );
	await page.close();

}

// ---- 3) SS-Camera bound to a scene camera, viewed through it
{

	const { page, logs } = await open( 'camera_scenecam.json' );
	await page.evaluate( async () => {

		const ed = window.editor;
		let cam = null;
		ed.scene.traverse( ( o ) => { if ( o.isCamera ) cam = o; } );
		if ( cam ) ed.setViewportCamera( cam.uuid );
		await new Promise( ( r ) => setTimeout( r, 900 ) );

	} );
	await installGrab( page );
	const curve = {};
	for ( const t of [ 0, 0.9, 1.6 ] ) curve[ 't=' + t ] = await grabAt( page, t );
	console.log( 'SCENE CAM pixels:', JSON.stringify( curve ) );
	console.log( 'SCENE CAM errors:', logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) ).slice( 0, 3 ) );
	await page.close();

}

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
