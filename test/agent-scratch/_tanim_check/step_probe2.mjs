import { chromium } from 'playwright';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
page.on( 'console', ( m ) => { const t = m.text(); if ( /wipe|error|Text|font/i.test( t ) ) console.log( '[page]', m.type(), t.slice( 0, 160 ) ); } );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', e.message ) );
page.on( 'dialog', ( d ) => { console.log( '[dialog]', d.type(), d.message().slice( 0, 80 ) ); d.dismiss(); } );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );

const race = ( p, ms, label ) => Promise.race( [ p, new Promise( ( r ) => setTimeout( () => r( 'TIMEOUT:' + label ), ms ) ) ] );
const step = async ( label, fn, ms = 25000 ) => {

	const t0 = Date.now();
	const r = await race( page.evaluate( fn ), ms, label );
	console.log( label, ( Date.now() - t0 ) + 'ms', '->', JSON.stringify( r ) );
	return r;

};

await step( 'build', async () => {

	const THREE = await import( 'three' );
	const UF = await import( './js/ui/UIFactory.js?v=fcc-ui-101' );
	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-101' );
	const ed = window.editor;
	ed.clear();
	ed.scene.background = new THREE.Color( 0x0b0e14 );
	const c = UF.createUICanvas(); ed.scene.add( c );
	const t = UF.createUIText( 'T' );
	c.add( t );
	window.__ui = t.userData[ UC.FCC_UI_KEY ];
	window.__t = t; window.__c = c;
	return { keys: Object.keys( window.__ui ).length };

} );

await step( 'mutate-ui', () => {

	const ui = window.__ui;
	ui.text = '扫光 SWEEP';
	ui.fontSize = 120;
	ui.sizeDelta = [ 1200, 240 ];
	ui.anchoredPosition = [ 0, 40 ];
	return { text: ui.text };

} );

await step( 'sync', async () => {

	const UT = await import( './js/ui/UIText.js?v=fcc-ui-101' );
	UT.syncUITextContent( window.__t, { x: 0, y: 0, w: 1200, h: 240 } );
	return { children: window.__t.children.length };

} );

await step( 'anim', async () => {

	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-4' );
	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	const w = TT.createDefaultComponent( anim, 'wipeReveal' );
	anim.components = [ w ];
	window.__ui.textAnim = anim;
	return { type: w.type, suppress: w.suppressCharPose, params: w.params };

} );

await step( 'title', () => { window.editor.config.setKey( 'project/title', '扫光-正确场景' ); return window.editor.config.getKey( 'project/title' ); } );
await step( 'time', () => { window.editor.textAnimTime = 0.9; return window.editor.textAnimTime; } );
await step( 'tojson', () => { const j = window.editor.toJSON(); window.__j = JSON.stringify( j ); return { len: window.__j.length }; }, 60000 );

await browser.close();
