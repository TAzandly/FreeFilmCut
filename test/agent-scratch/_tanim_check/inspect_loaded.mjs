import { chromium } from 'playwright';
import fs from 'node:fs';

const projectJson = JSON.parse( fs.readFileSync( 'projects/sweep-demo/project.json', 'utf8' ) );
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 600 );

const r = await page.evaluate( async ( json ) => {

	const ed = window.editor;
	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	ed.clear();
	await new Promise( ( r ) => setTimeout( r, 200 ) );
	await ed.fromJSON( json );
	await new Promise( ( r ) => setTimeout( r, 800 ) );
	const UT = await import( './js/ui/UIText.js?v=fcc-ui-102' );
	let first = null;
	ed.scene.traverse( ( o ) => { const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null; if ( ui && ui.type === 'text' && ! first ) first = o; } );
	const beforeManual = first ? first.children.map( ( c ) => ( { n: c.name, isText: typeof c.text === 'string' } ) ) : null;
	// does the render loop lay out UI at all? wipe marker, wait, re-check
	const ui0 = first.userData[ UC.FCC_UI_KEY ];
	delete ui0.rect;
	delete ui0._layoutRect;
	const frameA = window.editor.renderer ? window.editor.renderer.info.render.frame : -1;
	await new Promise( ( r ) => setTimeout( r, 600 ) );
	const frameB = window.editor.renderer ? window.editor.renderer.info.render.frame : -1;
	window.__loop = {
		framesAdvanced: frameB - frameA,
		rectAfter: ui0.rect || null,
		isTextAfter: first.children.map( ( c ) => typeof c.text === 'string' ),
	};
	const RL = await import( './js/ui/UIRectLayout.js?v=fcc-ui-102' );
	let canvases = 0;
	ed.scene.traverse( ( o ) => { const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null; if ( ui && ui.type === 'canvas' ) { canvases ++; window.__mode = ui.renderMode; } } );
	RL.layoutAllCanvases( ed.scene, 1920, 1080, { forMode: 'overlay' } );
	const afterLayout = first ? first.children.map( ( c ) => ( { n: c.name, isText: typeof c.text === 'string' } ) ) : null;
	window.__layout = { canvases, mode: window.__mode, afterLayout, loading: ed.isLoadingState };
	if ( first && ! ( afterLayout && afterLayout[ 0 ].isText ) ) UT.syncUITextContent( first, null );
	await new Promise( ( r ) => setTimeout( r, 500 ) );
	const afterManual = first ? first.children.map( ( c ) => ( { n: c.name, isText: typeof c.text === 'string', val: typeof c.text === 'string' ? String( c.text ).slice( 0, 12 ) : null } ) ) : null;
	window.__dbg = { loop: window.__loop, beforeManual, afterManual, layout: window.__layout };

	const out = [];
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ! ui || ui.type !== 'text' ) return;
		out.push( {
			name: o.name,
			text: ui.text,
			children: o.children.map( ( c ) => c.type + '/' + ( c.name || '' ) ),
			childText: o.children.map( ( c ) => ( c.text !== undefined ? String( c.text ).slice( 0, 20 ) : null ) ),
			childGeom: o.children.map( ( c ) => ( c.geometry ? ( c.geometry.attributes.position ? c.geometry.attributes.position.count : 'no-pos' ) : 'no-geom' ) ),
			childMat: o.children.map( ( c ) => ( c.material ? c.material.type + '|uni:' + ( c.material.uniforms ? Object.keys( c.material.uniforms ).length : 0 ) : null ) ),
			visible: o.visible,
			scale: o.scale.toArray(),
			worldPos: o.getWorldPosition( new ( o.position.constructor )() ).toArray().map( ( n ) => +n.toFixed( 1 ) ),
		} );

	} );
	return { out, dbg: window.__dbg };

}, projectJson );

console.log( 'DBG', JSON.stringify( r.dbg, null, 2 ) );
console.log( JSON.stringify( r.out, null, 2 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
