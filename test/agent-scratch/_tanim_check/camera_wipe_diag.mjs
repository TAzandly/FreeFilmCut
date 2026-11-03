// Reproduce the wipe failure when the canvas render mode is switched to SS-Camera.
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
await page.waitForTimeout( 600 );

await page.evaluate( () => { window.editor.textAnimWipeDebug = true; } );

const input = page.locator( 'form input[type=file][accept=".json"]' ).first();
await input.setInputFiles( file );
await page.waitForTimeout( 2500 );

const before = await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	const ed = window.editor;
	let canvas = null;
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.type === 'canvas' ) canvas = o;

	} );
	return { mode: canvas ? canvas.userData[ UC.FCC_UI_KEY ].renderMode : null };

} );

// switch to SS-Camera exactly like the sidebar does
await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	const RL = await import( './js/ui/UIRectLayout.js?v=fcc-ui-102' );
	const ed = window.editor;
	let canvas = null;
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.type === 'canvas' ) canvas = o;

	} );
	const ui = { ...canvas.userData[ UC.FCC_UI_KEY ] };
	ui.renderMode = UC.RENDER_MODE_CAMERA;
	ui.planeDistance = ui.planeDistance ?? UC.DEFAULT_PLANE_DISTANCE;
	canvas.userData[ UC.FCC_UI_KEY ] = ui;
	RL.rebindCanvasSubtree( canvas );
	ed._fccWipeDbgLogged = false;
	ed.signals.sceneGraphChanged.dispatch();
	ed.signals.windowResize.dispatch();

} );

await page.waitForTimeout( 1200 );
logs.length = 0;
await page.evaluate( () => {

	window.editor._fccWipeDbgLogged = false;
	window.editor.signals.windowResize.dispatch();

} );
await page.waitForTimeout( 900 );

const after = await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	const ed = window.editor;
	let canvas = null;
	let text = null;
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.type === 'canvas' ) canvas = o;
		if ( ui && ui.type === 'text' ) text = o;

	} );
	const reset = canvas && canvas.children.map( ( c ) => ( { n: c.name, vis: c.visible } ) );
	return {
		mode: canvas ? canvas.userData[ UC.FCC_UI_KEY ].renderMode : null,
		canvasPos: canvas ? canvas.position.toArray().map( ( v ) => +v.toFixed( 3 ) ) : null,
		canvasScale: canvas ? canvas.scale.toArray().map( ( v ) => +v.toFixed( 4 ) ) : null,
		textChildren: reset,
		textPos: text ? text.position.toArray().map( ( v ) => +v.toFixed( 2 ) ) : null,
		wipeTime: ed.textAnimTime,
	};

} );

console.log( 'before:', JSON.stringify( before ) );
console.log( 'after:', JSON.stringify( after, null, 2 ) );
console.log( 'wipeLog:', logs.filter( ( l ) => l.includes( 'wipe' ) ).slice( - 8 ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|error:/i.test( l ) && ! /GPU stall/i.test( l ) ).slice( 0, 6 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
