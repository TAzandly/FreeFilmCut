// node _tanim_check/panel_shot.mjs
import { chromium } from 'playwright';
const V = '?v=fcc-ui-100';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1500, height: 1000 } } );
const logs = [];
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 2000 );

await page.evaluate( async ( { V } ) => {
	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js' + V );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }
	const t = UIF.createUIText( 'PanelProbe' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );
	const ui = t.userData.fccUI;
	ui.text = '游京';
	ui.fontSize = 110;
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 700, h: 200 } );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	const a = TT.createDefaultComponent( anim, 'charIn' );
	anim.components.push( a );
	const b = TT.createDefaultComponent( anim, 'wipeReveal' );
	b.params.soft = 0.08;
	anim.components.push( b );
	const c = TT.createDefaultComponent( anim, 'wave' );
	anim.components.push( c );
	ui.textAnim = anim;

	ed.config.setKey( 'sidebar/text/animCollapsed', false );
	ed.select( null );
	ed.select( t );
	ed.textAnimTime = 0.5;
	ed.signals.sceneGraphChanged.dispatch();
	await new Promise( ( r ) => setTimeout( r, 500 ) );
} , { V } );

await page.waitForTimeout( 1200 );

const box = await page.evaluate( () => {
	const panels = Array.from( document.querySelectorAll( 'div.Panel' ) );
	const p = panels.find( ( el ) => /文字动画|Text animation/.test( el.firstElementChild ? el.firstElementChild.textContent : '' ) );
	if ( ! p ) return null;
	p.scrollIntoView( { block: 'start' } );
	const r = p.getBoundingClientRect();
	return { x: r.x, y: r.y, w: r.width, h: r.height };
} );
console.log( 'panel box:', JSON.stringify( box ) );
if ( box ) {
	await page.waitForTimeout( 400 );
	const box2 = await page.evaluate( () => {
		const panels = Array.from( document.querySelectorAll( 'div.Panel' ) );
		const p = panels.find( ( el ) => /文字动画|Text animation/.test( el.firstElementChild ? el.firstElementChild.textContent : '' ) );
		const r = p.getBoundingClientRect();
		return { x: Math.max( 0, r.x - 4 ), y: Math.max( 0, r.y - 4 ), width: Math.min( 400, r.width + 8 ), height: Math.min( 900, r.height + 8 ) };
	} );
	await page.screenshot( { path: 'D:/GrokbotWork/FreeFilmCut/_tanim_check/panel_crop.png', clip: box2 } );
	console.log( 'cropped', JSON.stringify( box2 ) );
}
console.log( 'errors:', logs.slice( 0, 5 ) );
await browser.close();
