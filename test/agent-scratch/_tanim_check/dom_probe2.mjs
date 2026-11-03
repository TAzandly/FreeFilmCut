// Reorder + disable verification (DOM only, no screenshots)
// node _tanim_check/dom_probe2.mjs
import { chromium } from 'playwright';

const V = '?v=fcc-ui-100';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1500, height: 950 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 1500 );

const out = await page.evaluate( async ( { V } ) => {

	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js' + V );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }
	const t = UIF.createUIText( 'Reorder' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );
	const ui = t.userData.fccUI;
	ui.text = '甲乙丙';
	ui.fontSize = 100;
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 800, h: 200 } );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	anim.components.push( TT.createDefaultComponent( anim, 'charIn' ) );
	ui.textAnim = anim;

	ed.config.setKey( 'sidebar/text/animCollapsed', false );
	ed.select( null );
	ed.select( t );
	await new Promise( ( r ) => setTimeout( r, 300 ) );

	const findPanel = () => {
		for ( const p of document.querySelectorAll( 'div.Panel' ) ) {
			const hdr = p.firstElementChild;
			const txt = hdr ? hdr.textContent : '';
			if ( /文字动画|Text animation/.test( txt ) && ! /关键帧|Keyframe/.test( txt ) ) return p;
		}
		return null;
	};

	// add wave through the real select
	const p0 = findPanel();
	const addSel = p0.querySelector( 'select' );
	addSel.value = 'wave';
	addSel.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	await new Promise( ( r ) => setTimeout( r, 250 ) );

	const beforeOrder = anim.components.map( ( c ) => c.type + ':' + c.enabled );

	// ---- disable the 2nd card via 👁 ----
	const p1 = findPanel();
	const cards = () => Array.from( p1.querySelectorAll( 'div[style*="border-radius: 3px"]' ) );
	let eyeResult = 'not found';
	const c2 = cards()[ 1 ];
	if ( c2 ) {
		const eyes = Array.from( c2.querySelectorAll( 'button' ) ).filter( ( b ) => [ '👁', '–' ].includes( b.textContent ) );
		if ( eyes[ 0 ] ) { eyes[ 0 ].click(); eyeResult = 'clicked'; }
	}
	await new Promise( ( r ) => setTimeout( r, 250 ) );
	const afterDisable = anim.components.map( ( c ) => c.type + ':' + c.enabled );

	// ---- reorder: drag card0 handle onto card1 ----
	const p2 = findPanel();
	const cs = Array.from( p2.querySelectorAll( 'div[style*="border-radius: 3px"]' ) );
	let dragResult = 'not enough cards';
	if ( cs.length >= 2 ) {
		const handle = cs[ 0 ].querySelector( '[draggable="true"]' );
		const dt = new DataTransfer();
		if ( handle ) {
			handle.dispatchEvent( new DragEvent( 'dragstart', { bubbles: true, dataTransfer: dt } ) );
			cs[ 1 ].dispatchEvent( new DragEvent( 'drop', { bubbles: true, cancelable: true, dataTransfer: dt } ) );
			dragResult = 'dragged 0 -> 1';
		} else dragResult = 'no handle';
	}
	await new Promise( ( r ) => setTimeout( r, 250 ) );
	const afterOrder = anim.components.map( ( c ) => c.type + ':' + c.enabled );

	return {
		beforeOrder,
		eyeResult,
		afterDisable,
		dragResult,
		afterOrder,
		cardCount: cards().length,
	};

}, { V } );

console.log( JSON.stringify( out, null, 2 ) );
const bad = logs.filter( ( l ) => l.startsWith( 'PAGEERROR' ) || /TypeError|is not a function|DataCloneError/.test( l ) );
console.log( 'problems:', bad.slice( 0, 8 ) );
await browser.close();
