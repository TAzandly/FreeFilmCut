// Where does the composite quad land in NDC during the beauty render?
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

await page.evaluate( async () => { window.__THREE = await import( 'three' ); } );

await page.evaluate( () => {

	const ed = window.editor;
	ed.textAnimTime = 0.9;
	const orig = ed.renderer.render.bind( ed.renderer );
	window.__trace = [];
	ed.renderer.render = function ( scene, camera ) {

		let quad = null;
		scene.traverse( ( o ) => { if ( o.name === 'FreeFilmCut.UICaptureQuad' && o.parent ) quad = o; } );
		if ( quad && quad.visible && window.__trace.length < 4 ) {

			const THREE = window.__THREE;
			const info = {
				camType: camera.type,
				rt: ed.renderer.getRenderTarget() ? {
					w: ed.renderer.getRenderTarget().width,
					h: ed.renderer.getRenderTarget().height,
				} : null,
				layerMask: camera.layers.mask,
				quadLayer: quad.layers.mask,
				matVisible: quad.material.visible,
				opacity: quad.material.uniforms.uOpacity.value,
				tex: quad.material.uniforms.tDiffuse.value ? {
					w: quad.material.uniforms.tDiffuse.value.image ? quad.material.uniforms.tDiffuse.value.image.width : null,
					h: quad.material.uniforms.tDiffuse.value.image ? quad.material.uniforms.tDiffuse.value.image.height : null,
					type: quad.material.uniforms.tDiffuse.value.type,
				} : null,
				matrixWorld: quad.matrixWorld.elements.map( ( v ) => + v.toFixed( 3 ) ),
				worldCorners: [],
			};
			if ( THREE ) {

				for ( const p of [ [ - 0.5, - 0.5 ], [ 0.5, - 0.5 ], [ 0.5, 0.5 ], [ - 0.5, 0.5 ] ] ) {

					const v = new THREE.Vector3( p[ 0 ], p[ 1 ], 0 ).applyMatrix4( quad.matrixWorld ).project( camera );
					info.worldCorners.push( [ + v.x.toFixed( 3 ), + v.y.toFixed( 3 ), + v.z.toFixed( 4 ) ] );

				}

			}

			window.__trace.push( info );

		}

		return orig( scene, camera );

	};

} );

await page.evaluate( () => { window.editor.signals.windowResize.dispatch(); } );
await page.waitForTimeout( 1200 );

const trace = await page.evaluate( () => window.__trace );
console.log( JSON.stringify( trace.slice( 0, 2 ), null, 2 ) );
console.log( 'wipe:', logs.filter( ( l ) => l.includes( 'alpha-AABB' ) ).slice( - 2 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
