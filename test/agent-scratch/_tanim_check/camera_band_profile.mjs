// Why does the SCENE camera path light only a horizontal band? Profile lit
// pixels per Y band + dump layout/post info for both camera variants.
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
		const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
		const buf = new Uint8Array( w * h * 4 );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
		const bands = new Array( Math.ceil( h / 40 ) ).fill( 0 );
		let lit = 0;
		for ( let i = 0; i < buf.length; i += 4 ) {

			if ( buf[ i ] < 200 || buf[ i + 1 ] < 200 || buf[ i + 2 ] < 200 ) continue;
			lit ++;
			const y = ( ( i / 4 ) / w ) | 0;
			bands[ Math.floor( y / 40 ) ] ++;

		}

		window.__grab = { lit, bands, w, h };

	} );

} );

async function run( useSceneCam ) {

	return page.evaluate( async ( { useSceneCam } ) => {

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
		ui.renderMode = UC.RENDER_MODE_CAMERA;
		ui.planeDistance = ui.planeDistance ?? UC.DEFAULT_PLANE_DISTANCE;
		if ( useSceneCam && camObj ) {

			ui.cameraUuid = camObj.uuid;
			ed.setViewportCamera( camObj.uuid );

		} else {

			delete ui.cameraUuid;
			ed.setViewportCamera( '__editor__' );

		}

		canvas.userData[ UC.FCC_UI_KEY ] = ui;
		RL.rebindCanvasSubtree( canvas );
		ed.textAnimTime = 0.9;
		ed.signals.sceneGraphChanged.dispatch();
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 600 ) );
		window.__grab = null;
		window.__grabNext = true;
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 600 ) );

		const cam = ed.viewportCamera;
		return {
			vpCam: {
				name: cam.name, type: cam.type,
				fov: cam.fov, aspect: + ( cam.aspect || 0 ).toFixed( 3 ),
				pos: cam.position.toArray().map( ( v ) => + v.toFixed( 2 ) ),
				near: cam.near, far: cam.far,
				zoom: cam.zoom,
				post: !! ( cam.postProcessStack && ( cam.postProcessStack.effects || [] ).some( ( e ) => e.enabled ) ),
				stack: cam.postProcessStack ? ( cam.postProcessStack.effects || [] ).map( ( e ) => e.type + ':' + e.enabled ) : null,
			},
			canvasScale: canvas.scale.toArray().map( ( v ) => + v.toFixed( 5 ) ),
			canvasPos: canvas.position.toArray().map( ( v ) => + v.toFixed( 2 ) ),
			grab: window.__grab,
		};

	}, { useSceneCam } );

}

const a = await run( false );
console.log( 'EDITOR CAM:', JSON.stringify( { vpCam: a.vpCam, grab: a.grab } ) );
const b = await run( true );
console.log( 'SCENE  CAM:', JSON.stringify( { vpCam: b.vpCam, grab: b.grab } ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|TypeError/i.test( l ) ).slice( 0, 4 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
