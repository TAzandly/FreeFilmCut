// One fresh load per project variant; numeric wipe metrics only.
import { chromium } from 'playwright';
import path from 'node:path';

const cases = [
	{ name: 'overlay.json', viewThrough: false },
	{ name: 'overlay_nowipe.json', viewThrough: false },
	{ name: 'camera_viewport.json', viewThrough: false },
	{ name: 'camera_scenecam.json', viewThrough: true },
];

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );

async function measure( c ) {

	const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
	const logs = [];
	page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
	page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );

	await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
	await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
	await page.waitForTimeout( 500 );
	await page.evaluate( () => {

		window.editor.textAnimWipeDebug = false; // debug mask would hide the real composite
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

			window.__grab = { lit, minX, maxX, minY, maxY, w, h };

		} );

	} );

	await page.locator( 'form input[type=file][accept=".json"]' ).first()
		.setInputFiles( path.resolve( '_tanim_check/cases', c.name ) );
	await page.waitForTimeout( 2800 );

	if ( c.viewThrough ) {

		await page.evaluate( async () => {

			const ed = window.editor;
			let cam = null;
			ed.scene.traverse( ( o ) => { if ( o.isCamera ) cam = o; } );
			if ( cam ) ed.setViewportCamera( cam.uuid );
			await new Promise( ( r ) => setTimeout( r, 800 ) );

		} );

	}

	const shots = {};
	for ( const t of [ 0, 0.9, 1.6 ] ) {

		await page.evaluate( async ( t ) => {

			const ed = window.editor;
			ed.textAnimTime = t;
			ed._fccWipeDbgLogged = false;
			window.__grab = null;
			window.__grabNext = true;
			ed.signals.windowResize.dispatch();
			await new Promise( ( r ) => setTimeout( r, 600 ) );

		}, t );
		shots[ 't=' + t ] = await page.evaluate( () => window.__grab );

	}

	const aabb = logs.filter( ( l ) => l.includes( 'alpha-AABB' ) && l.includes( 'progress' ) ).slice( - 1 )[ 0 ] || null;
	const errs = logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) );
	await page.close();
	return { case: c.name + ( c.viewThrough ? ' (view through)' : '' ), shots, aabb, errs: errs.slice( 0, 2 ) };

}

for ( const c of cases ) {

	const r = await measure( c );
	const s = r.shots;
	console.log( '\n==', r.case );
	for ( const k of Object.keys( s ) ) {

		const g = s[ k ];
		console.log( '  ', k, g ? `lit=${g.lit} x=[${g.minX},${g.maxX}] y=[${g.minY},${g.maxY}]` : 'null' );

	}

	console.log( '   AABB:', r.aabb || 'none' );
	if ( r.errs.length ) console.log( '   errs:', r.errs );

}

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
