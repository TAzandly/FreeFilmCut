import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const errs = [];
page.on( 'pageerror', ( e ) => errs.push( e.stack || e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
	.setInputFiles( path.resolve( '_tanim_check/cases', process.argv[ 2 ] || 'overlay.json' ) );
await page.waitForTimeout( 4000 );
if ( process.argv[ 3 ] === 'charIn' ) {

	await page.evaluate( async () => {

		const ed = window.editor;
		let text = null;
		ed.scene.traverse( ( o ) => { if ( o.userData && o.userData.fccUI && o.userData.fccUI.type === 'text' && ! o.userData.__fccTextAnimChar ) text = o; } );
		ed.select( text );
		await new Promise( ( r ) => setTimeout( r, 200 ) );
		const sel = [ ...document.querySelectorAll( 'select' ) ].find( ( s ) => [ ...s.options ].some( ( o ) => o.value === 'charIn' ) );
		sel.value = 'charIn';
		sel.dispatchEvent( new Event( 'change' ) );

	} );
	await page.waitForTimeout( 5000 );
	console.log( await page.evaluate( () => {

		const json = window.editor.toJSON();
		const hits = [];
		const seen = new Set();
		( function walk( v, p ) {

			if ( ! v || typeof v !== 'object' || seen.has( v ) || hits.length > 4 ) return;
			seen.add( v );
			if ( typeof HTMLImageElement !== 'undefined' && v instanceof HTMLImageElement ) { hits.push( p ); return; }
			for ( const k of Object.keys( v ) ) walk( v[ k ], p + '.' + k );

		} )( json, '$' );
		return hits;

	} ) );

}
console.log( errs.slice( 0, 2 ).join( '\n----\n' ) || 'no errors' );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
