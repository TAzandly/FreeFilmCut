// Focused: capture the built-in wipe debug log (alpha-AABB + progress).
// node _tanim_check/wipe_diag2.mjs
import { chromium } from 'playwright';

const V = '?v=fcc-ui-101';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message + '\n' + ( e.stack || '' ) ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 1500 );

const info = await page.evaluate( async ( { V } ) => {

	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js' + V );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }
	const t = UIF.createUIText( 'WipeDiag2' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );
	const ui = t.userData.fccUI;
	ui.text = '扫光ABCD';
	ui.fontSize = 120;
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 900, h: 240 } );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	anim.components = [ TT.createDefaultComponent( anim, 'wipeReveal' ) ];
	ui.textAnim = anim;

	ed.select( null );
	ed.select( t );
	await new Promise( ( r ) => setTimeout( r, 1200 ) );

	ed.textAnimTime = 0.5;
	ed.textAnimWipeDebug = true;
	ed._fccWipeDbgLogged = false;
	ed.signals.sceneGraphChanged.dispatch();
	await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( () => requestAnimationFrame( r ) ) ) );

	// renderer type
	let rendererInfo = 'unknown';
	try {

		const vp = ed.viewport || ( ed.viewports && ed.viewports[ 0 ] );
		rendererInfo = vp ? 'viewport-ok' : 'no-viewport';

	} catch ( e ) { rendererInfo = 'err ' + e.message; }

	// find the WebGL canvas and its size
	const canvases = Array.from( document.querySelectorAll( 'canvas' ) ).map( ( c ) => ( {
		id: c.id || '(no id)',
		cls: c.className || '',
		w: c.width,
		h: c.height,
		parent: c.parentElement ? ( c.parentElement.id || c.parentElement.className ) : '',
	} ) );

	return { rendererInfo, canvases };

}, { V } );

console.log( JSON.stringify( info, null, 2 ) );
console.log( '--- wipe debug logs ---' );
const w = logs.filter( ( l ) => /\[FreeFilmCut wipe\]/.test( l ) );
console.log( w.join( '\n' ) || '(no wipe debug log — the wipe branch never ran)' );
console.log( '--- errors ---' );
console.log( logs.filter( ( l ) => /PAGEERROR|TypeError|not a function/.test( l ) ).slice( 0, 6 ).join( '\n' ) || '(none)' );
await browser.close();
