// Where does the SS-Camera canvas actually land in the capture RT?
import { chromium } from 'playwright';
import path from 'node:path';

const file = path.resolve( 'projects/sweep-demo/project.json' );

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 500 );
await page.evaluate( () => { window.editor.textAnimWipeDebug = true; } );
await page.locator( 'form input[type=file][accept=".json"]' ).first().setInputFiles( file );
await page.waitForTimeout( 2600 );

const info = await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-103' );
	const THREE = await import( 'three' );
	const ed = window.editor;
	let canvas = null;
	let text = null;
	const cameras = [];
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.type === 'canvas' ) canvas = o;
		if ( ui && ui.type === 'text' ) text = o;
		if ( o.isCamera ) cameras.push( { name: o.name, uuid: o.uuid, type: o.type } );

	} );
	ed.textAnimTime = 0.9;
	ed.signals.windowResize.dispatch();
	await new Promise( ( r ) => setTimeout( r, 500 ) );

	const vpCam = ed.viewportCamera;
	vpCam.updateMatrixWorld( true );
	canvas.updateMatrixWorld( true );

	const world = new THREE.Vector3();
	text.getWorldPosition( world );
	const ndc = world.clone().project( vpCam );
	const rtPx = {
		x: ( ndc.x * 0.5 + 0.5 ) * 1920,
		y: ( ndc.y * 0.5 + 0.5 ) * 1080,
	};

	const canvasUI = canvas.userData[ UC.FCC_UI_KEY ];
	const corners = [];
	for ( const [ x, y ] of [ [ 0, 0 ], [ 1920, 0 ], [ 0, 1080 ], [ 1920, 1080 ] ] ) {

		const p = new THREE.Vector3( x, y, 0 );
		canvas.localToWorld( p );
		const n = p.project( vpCam );
		corners.push( [ +( ( n.x * 0.5 + 0.5 ) * 1920 ).toFixed( 1 ), +( ( n.y * 0.5 + 0.5 ) * 1080 ).toFixed( 1 ) ] );

	}

	return {
		canvasMode: canvasUI.renderMode,
		cameraUuid: canvasUI.cameraUuid,
		planeDistance: canvasUI.planeDistance,
		sceneCameras: cameras,
		vpCam: {
			name: vpCam.name,
			uuid: vpCam.uuid,
			type: vpCam.type,
			fov: vpCam.fov,
			aspect: +( vpCam.aspect || 0 ).toFixed( 4 ),
			pos: vpCam.position.toArray().map( ( v ) => + v.toFixed( 2 ) ),
			quat: vpCam.quaternion.toArray().map( ( v ) => + v.toFixed( 3 ) ),
		},
		canvasPos: canvas.position.toArray().map( ( v ) => + v.toFixed( 3 ) ),
		canvasScale: canvas.scale.toArray().map( ( v ) => + v.toFixed( 4 ) ),
		canvasQuat: canvas.quaternion.toArray().map( ( v ) => + v.toFixed( 3 ) ),
		textWorld: world.toArray().map( ( v ) => + v.toFixed( 2 ) ),
		textNDC: ndc.toArray().map( ( v ) => + v.toFixed( 3 ) ),
		textRtPx: { x: + rtPx.x.toFixed( 1 ), y: + rtPx.y.toFixed( 1 ) },
		canvasCornersRtPx: corners,
		textChildren: text.children.map( ( c ) => ( { n: c.name, isText: typeof c.text === 'string' } ) ),
		textRect: canvasUI._resolved || null,
	};

} );

console.log( JSON.stringify( info, null, 2 ) );
console.log( 'wipeLog:', logs.filter( ( l ) => l.includes( 'alpha-AABB' ) ).slice( - 2 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
