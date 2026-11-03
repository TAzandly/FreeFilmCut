// Load projects/sweep-demo/project.json back into a fresh editor and verify the
// sweep actually runs. Node only — no screenshots.
import { chromium } from 'playwright';
import fs from 'node:fs';

const projectJson = JSON.parse( fs.readFileSync( 'projects/sweep-demo/project.json', 'utf8' ) );

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 800 );

const loaded = await page.evaluate( async ( json ) => {

	const ed = window.editor;

	ed.clear();
	await new Promise( ( r ) => setTimeout( r, 300 ) );
	await ed.fromJSON( json );

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-4' );

	let sweep = null, ref = null;
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ! ui || ui.type !== 'text' ) return;
		if ( ui.textAnim ) sweep = o; else ref = o;

	} );

	const anim = sweep && sweep.userData[ UC.FCC_UI_KEY ].textAnim;

	return {
		previewTime: ed.textAnimTime,
		hasSweep: !! sweep,
		hasRef: !! ref,
		sweepText: sweep && sweep.userData[ UC.FCC_UI_KEY ].text,
		refText: ref && ref.userData[ UC.FCC_UI_KEY ].text,
		comp: anim && anim.components.map( ( c ) => ( { type: c.type, suppress: c.suppressCharPose === true, time: c.time, params: c.params } ) ),
		straySweepOnRef: ! ! ( ref && ref.userData[ UC.FCC_UI_KEY ].textAnim ),
	};

}, projectJson );

// let the render loop run the wipe pass with debug on
await page.evaluate( () => { window.editor._fccWipeDbgLogged = false; window.editor.textAnimWipeDebug = true; } );
await page.waitForTimeout( 900 );
await page.evaluate( () => { window.editor.textAnimWipeDebug = false; } );

const wipeLog = logs.find( ( l ) => l.includes( 'alpha-AABB' ) );
const errors = logs.filter( ( l ) => /PAGEERROR|error:/i.test( l ) && ! /GPU stall/i.test( l ) );

// engine-level progress sweep, no browser needed beyond the module import
const progressCurve = await page.evaluate( async () => {

	const TA = await import( './js/ui/TextAnim.js?v=fcc-ui-102' );
	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	let sweep = null;
	window.editor.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.textAnim ) sweep = ui;

	} );
	const anim = sweep.textAnim;
	const out = {};
	for ( const t of [ 0, 0.4, 0.8, 1.2, 1.6 ] ) {

		const r = TA.sampleTextAnim( anim, t, 8 );
		const p = r.passOps.find( ( x ) => x.kind === 'wipe' );
		out[ t ] = p ? +p.progress.toFixed( 4 ) : null;

	}
	return out;

} );

console.log( 'loaded', JSON.stringify( loaded, null, 2 ) );
console.log( 'wipeLog:', wipeLog || 'NONE' );
console.log( 'progressCurve:', JSON.stringify( progressCurve ) );
console.log( 'errors:', errors );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
