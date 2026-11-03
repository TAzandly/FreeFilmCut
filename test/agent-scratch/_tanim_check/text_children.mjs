import { chromium } from 'playwright';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );

const snap = async ( label ) => {

	const r = await page.evaluate( async () => {

		const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
		let t = null;
		window.editor.scene.traverse( ( o ) => { const ui = o.userData && o.userData[ UC.FCC_UI_KEY ]; if ( ui && ui.type === 'text' ) t = o; } );
		if ( ! t ) return null;
		return {
			children: t.children.map( ( c ) => ( {
				name: c.name,
				isText: c.text !== undefined,
				textVal: c.text !== undefined ? String( c.text ).slice( 0, 16 ) : null,
				type: c.type,
				geomVerts: c.geometry && c.geometry.attributes.position ? c.geometry.attributes.position.count : null,
				vis: c.visible,
			} ) ),
			sig: !! t.userData.__fccTextSig,
		};

	} );
	console.log( label, JSON.stringify( r, null, 1 ) );

};

await page.evaluate( async () => {

	const UF = await import( './js/ui/UIFactory.js?v=fcc-ui-102' );
	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	const ed = window.editor;
	ed.clear();
	const c = UF.createUICanvas(); ed.scene.add( c );
	const t = UF.createUIText( 'Probe' );
	t.userData[ UC.FCC_UI_KEY ].text = '扫光 SWEEP';
	t.userData[ UC.FCC_UI_KEY ].fontSize = 120;
	c.add( t );

} );

await snap( 't+0ms' );
await page.waitForTimeout( 1500 );
await snap( 't+1500ms' );
await page.waitForTimeout( 2500 );
await snap( 't+4000ms' );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
