import { chromium } from 'playwright';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1200, height: 800 } } );
page.on( 'console', ( m ) => console.log( '[page]', m.type(), m.text().slice( 0, 200 ) ) );
page.on( 'pageerror', ( e ) => console.log( '[pageerror]', e.message ) );
page.on( 'dialog', ( d ) => { console.log( '[dialog]', d.type(), d.message().slice( 0, 80 ) ); d.dismiss(); } );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );

const race = ( p, ms, label ) => Promise.race( [ p, new Promise( ( r ) => setTimeout( () => r( 'TIMEOUT:' + label ), ms ) ) ] );

const step = async ( label, fn, ms = 30000 ) => {

	const r = await race( page.evaluate( fn ), ms, label );
	console.log( label, '->', JSON.stringify( r ) );
	return r;

};

await step( 'who', () => ( { hasEditor: !! window.editor, children: window.editor.scene.children.length } ) );
await step( 'clear', () => { window.editor.clear(); return window.editor.scene.children.length; } );
await step( 'bg', async () => { const T = await import( 'three' ); window.editor.scene.background = new T.Color( 0x0b0e14 ); return 'ok'; } );
await step( 'canvas', async () => { const UF = await import( './js/ui/UIFactory.js?v=fcc-ui-101' ); const c = UF.createUICanvas(); window.__c = c; window.editor.scene.add( c ); return c.children.length; } );
await step( 'text', async () => { const UF = await import( './js/ui/UIFactory.js?v=fcc-ui-101' ); const t = UF.createUIText(); window.__t = t; window.__c.add( t ); return t.children.length; } );
await step( 'tojson', () => { const j = window.editor.toJSON(); return { keys: Object.keys( j ), len: JSON.stringify( j ).length }; }, 60000 );

await browser.close();
