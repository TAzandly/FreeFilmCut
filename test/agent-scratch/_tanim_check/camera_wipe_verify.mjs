// Verify the SS-Camera wipe against overlay mode with numeric assertions only.
// Case A: overlay canvas.  Case B: same canvas as SS-Camera (viewport camera).
import { chromium } from 'playwright';
import path from 'node:path';

const file = path.resolve( 'projects/sweep-demo/project.json' );
const V = 'fcc-ui-103';

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
	window.__quad = { seen: 0, sample: null };
	const orig = ed.renderer.render.bind( ed.renderer );
	ed.renderer.render = function ( scene, camera ) {

		let quad = null;
		scene.traverse( ( o ) => { if ( o.name === 'FreeFilmCut.UICaptureQuad' && o.parent ) quad = o; } );
		if ( quad && quad.visible ) {

			window.__quad.seen ++;
			if ( ! window.__quad.sample ) {

				window.__quad.sample = {
					parent: quad.parent.name,
					hasMap: !! quad.material.uniforms.tDiffuse.value,
					scale: quad.scale.toArray().map( ( v ) => Math.round( v ) ),
					depthTest: quad.material.depthTest,
					siblingsHidden: quad.parent.children.filter( ( c ) => c !== quad ).every( ( c ) => ! c.visible ),
				};

			}

		}

		return orig( scene, camera );

	};

} );

async function setMode( mode ) {

	await page.evaluate( async ( mode ) => {

		const UC = await import( './js/ui/UIConstants.js?v=' + 'fcc-ui-103' );
		const RL = await import( './js/ui/UIRectLayout.js?v=fcc-ui-103' );
		const ed = window.editor;
		let canvas = null;
		ed.scene.traverse( ( o ) => {

			const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
			if ( ui && ui.type === 'canvas' ) canvas = o;

		} );
		const ui = { ...canvas.userData[ UC.FCC_UI_KEY ] };
		ui.renderMode = mode === 'camera' ? UC.RENDER_MODE_CAMERA : UC.RENDER_MODE_OVERLAY;
		ui.planeDistance = ui.planeDistance ?? UC.DEFAULT_PLANE_DISTANCE;
		delete ui.cameraUuid; // place relative to the camera we actually render with
		canvas.userData[ UC.FCC_UI_KEY ] = ui;
		RL.rebindCanvasSubtree( canvas );
		ed.textAnimTime = 0.9;
		ed._fccWipeDbgLogged = false;
		ed.signals.sceneGraphChanged.dispatch();
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 800 ) );

	}, mode );

}

const grabAabb = ( list ) => {

	const line = list.slice().reverse().find( ( l ) => l.includes( 'progress' ) );
	if ( ! line ) return null;
	const m = line.match( /minX: ([\d.-]+), maxX: ([\d.-]+), minY: ([\d.-]+), maxY: ([\d.-]+)/ );
	return m ? { minX: + m[ 1 ], maxX: + m[ 2 ], minY: + m[ 3 ], maxY: + m[ 4 ] } : null;

};

await setMode( 'overlay' );
const aabbOverlay = grabAabb( logs );
logs.length = 0;

await setMode( 'camera' );
const aabbCamera = grabAabb( logs );
await page.waitForTimeout( 400 );

const state = await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-103' );
	const ed = window.editor;
	let canvas = null;
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.type === 'canvas' ) canvas = o;

	} );
	const raw = JSON.stringify( ed.toJSON() );
	return {
		quad: window.__quad,
		childrenAfterFrame: canvas.children.map( ( c ) => ( { n: c.name, vis: c.visible } ) ),
		savedHasQuad: raw.includes( 'UICaptureQuad' ),
		savedHidden: raw.includes( '"visible":false' ),
	};

} );

const d = ( a, b ) => a && b ? {
	dx: + ( b.minX - a.minX ).toFixed( 1 ),
	dx2: + ( b.maxX - a.maxX ).toFixed( 1 ),
	dy: + ( b.minY - a.minY ).toFixed( 1 ),
	dy2: + ( b.maxY - a.maxY ).toFixed( 1 ),
} : null;

console.log( 'AABB overlay:', JSON.stringify( aabbOverlay ) );
console.log( 'AABB camera :', JSON.stringify( aabbCamera ) );
console.log( 'delta       :', JSON.stringify( d( aabbOverlay, aabbCamera ) ) );
console.log( 'quad:', JSON.stringify( state.quad ) );
console.log( 'children after frame:', JSON.stringify( state.childrenAfterFrame ) );
console.log( 'savedHasQuad:', state.savedHasQuad, '| savedHidden:', state.savedHidden );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|TypeError|error:/i.test( l ) && ! /GPU stall/i.test( l ) ).slice( 0, 6 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
