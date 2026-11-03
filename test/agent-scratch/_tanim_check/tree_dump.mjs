import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
	.setInputFiles( path.resolve( '_tanim_check/cases/camera_viewport.json' ) );
await page.waitForTimeout( 2800 );

const tree = await page.evaluate( () => {

	const ed = window.editor;
	const out = [];
	ed.scene.traverse( ( o ) => {

		const ui = o.userData && o.userData.fccUI;
		out.push( {
			depth: ( () => { let d = 0, p = o.parent; while ( p ) { d ++; p = p.parent; } return d; } )(),
			name: o.name,
			type: o.type,
			ui: ui ? ui.type : null,
			mode: ui && ui.renderMode ? ui.renderMode : null,
			vis: o.visible,
			kids: o.children.length,
			layer: o.layers.mask,
			isText: typeof o.text === 'string',
		} );

	} );
	return { time: ed.textAnimTime, canvasTextAnim: ( () => {

		let r = null;
		ed.scene.traverse( ( o ) => {

			const ui = o.userData && o.userData.fccUI;
			if ( ui && ui.type === 'text' ) r = { enabled: ui.textAnim && ui.textAnim.enabled, comps: ui.textAnim && ui.textAnim.components.map( ( c ) => c.type + ':' + c.enabled ) };

		} );
		return r;

	} )(), tree: out };

} );

console.log( JSON.stringify( tree, null, 1 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
