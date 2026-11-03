import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 500 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
	.setInputFiles( path.resolve( '_tanim_check/cases/overlay.json' ) );
await page.waitForTimeout( 3000 );

const st = await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-103' );
	const ed = window.editor;
	let objs = 0;
	const texts = [];
	const canvasModes = [];
	ed.scene.traverse( ( o ) => {

		objs ++;
		const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null;
		if ( ui && ui.type === 'text' ) texts.push( { t: ui.text, glyph: o.children.some( ( c ) => typeof c.text === 'string' ), kids: o.children.length } );
		if ( ui && ui.type === 'canvas' ) canvasModes.push( ui.renderMode );

	} );
	return {
		title: ed.config.getKey( 'project/title' ),
		objs,
		texts,
		canvasModes,
		time: ed.textAnimTime,
		loading: ed.isLoadingState,
		res: ed.config.getKey( 'project/resolution' ) || null,
	};

} );

console.log( JSON.stringify( st, null, 2 ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|TypeError|SyntaxError/i.test( l ) ).slice( 0, 5 ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
