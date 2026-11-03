// Trace every render call in the camera-mode frame: quad attached? children hidden?
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
await page.waitForTimeout( 2800 );

await page.evaluate( () => {

	const ed = window.editor;
	const orig = ed.renderer.render.bind( ed.renderer );
	window.__frames = [];
	let calls = [];

	ed.renderer.render = function ( scene, camera ) {

		let quad = null;
		let hiddenKids = 0;
		let canvasKids = 0;
		scene.traverse( ( o ) => {

			if ( o.name === 'FreeFilmCut.UICaptureQuad' ) quad = o;
			const ui = o.userData && o.userData.fccUI;
			if ( ui && ui.type === 'canvas' ) {

				canvasKids = o.children.length;
				hiddenKids = o.children.filter( ( c ) => ! c.visible ).length;

			}

		} );
		calls.push( {
			cam: camera.type,
			quadParent: quad ? !! quad.parent : false,
			quadVisible: quad ? quad.visible : null,
			hasMap: quad && quad.parent ? !! quad.material.uniforms.tDiffuse.value : null,
			canvasKids,
			hiddenKids,
		} );

		return orig( scene, camera );

	};

	window.__flush = () => {

		window.__frames.push( calls );
		calls = [];

	};

} );

await page.evaluate( () => { window.editor.textAnimTime = 0.9; window.editor.signals.windowResize.dispatch(); } );
await page.waitForTimeout( 1200 );
await page.evaluate( () => window.__flush() );

const frames = await page.evaluate( () => window.__frames );
const last = frames[ frames.length - 1 ] || [];
console.log( 'render calls in last frame:', last.length );
console.log( JSON.stringify( last, null, 1 ) );
console.log( 'wipeLog:', logs.filter( ( l ) => l.includes( 'wipe' ) ).slice( - 3 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
