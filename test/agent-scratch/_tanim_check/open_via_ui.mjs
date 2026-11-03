// Open the generated project through the real File > Open input, like a user would.
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

await page.waitForTimeout( 3000 );

// force one more paint now that glyphs are live, and re-log the wipe AABB
logs.length = 0;
await page.evaluate( () => { window.editor._fccWipeDbgLogged = false; window.editor.signals.windowResize.dispatch(); } );
await page.waitForTimeout( 700 );

const state = await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	const TA = await import( './js/ui/TextAnim.js?v=fcc-ui-102' );
	const ed = window.editor;
	const texts = [];
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ! ui || ui.type !== 'text' ) return;
		texts.push( {
			text: ui.text,
			glyphLive: o.children.some( ( c ) => typeof c.text === 'string' ),
			hasAnim: !! ui.textAnim,
		} );

	} );
	let sweepUI = null;
	ed.scene.traverse( ( o ) => {

		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.textAnim ) sweepUI = ui;

	} );
	const op = sweepUI ? TA.sampleTextAnim( sweepUI.textAnim, ed.textAnimTime || 0, 8 ).passOps[ 0 ] : null;
	return {
		title: ed.config.getKey( 'project/title' ),
		textAnimTime: ed.textAnimTime,
		texts,
		wipeProgressAtPreviewTime: op ? +op.progress.toFixed( 4 ) : null,
		loading: ed.isLoadingState,
	};

} );

console.log( JSON.stringify( state, null, 2 ) );
console.log( 'wipeLog:', logs.filter( ( l ) => l.includes( 'alpha-AABB' ) ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|error:/i.test( l ) && ! /GPU stall/i.test( l ) ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
