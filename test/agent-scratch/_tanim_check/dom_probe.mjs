// DOM-text-only verification (no screenshots)
// node _tanim_check/dom_probe.mjs
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
	const t = UIF.createUIText( 'DomProbe' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );
	const ui = t.userData.fccUI;
	ui.text = '测试AB';
	ui.fontSize = 110;
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 800, h: 200 } );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	anim.components.push( TT.createDefaultComponent( anim, 'charIn' ) );
	ui.textAnim = anim;

	ed.config.setKey( 'sidebar/text/animCollapsed', false );
	ed.select( null );
	ed.select( t );
	ed.signals.sceneGraphChanged.dispatch();
	await new Promise( ( r ) => setTimeout( r, 300 ) );

	function findPanel() {

		const panels = Array.from( document.querySelectorAll( 'div.Panel' ) );
		for ( const p of panels ) {

			const hdr = p.firstElementChild;
			const txt = hdr ? hdr.textContent : '';
			if ( /文字动画|Text animation/.test( txt ) && ! /关键帧|Keyframe/.test( txt ) ) return p;

		}
		return null;

	}

	function snap( tag ) {

		const p = findPanel();
		if ( ! p ) return { tag, panel: 'NOT FOUND' };
		const sel = p.querySelector( 'select' );
		return {
			tag,
			display: getComputedStyle( p ).display,
			cards: p.querySelectorAll( 'div[style*="border-radius: 3px"]' ).length,
			selects: Array.from( p.querySelectorAll( 'select' ) ).map( ( s ) => s.options.length ),
			// all visible option labels of the "add" select
			addOptions: sel ? Array.from( sel.options ).map( ( o ) => o.textContent ) : null,
			lines: p.innerText.split( '\n' ).map( ( s ) => s.trim() ).filter( Boolean ),
		};

	}

	const steps = [];
	steps.push( snap( 'A_initial_with_charIn' ) );

	// ---- add one component through the real select control ----
	const panel = findPanel();
	const addSel = panel ? panel.querySelector( 'select' ) : null;
	let addResult = 'no select';
	if ( addSel ) {

		const wanted = Array.from( addSel.options ).find( ( o ) => o.value === 'wave' );
		if ( wanted ) {

			addSel.value = 'wave';
			addSel.dispatchEvent( new Event( 'change', { bubbles: true } ) );
			addResult = 'dispatched wave';

		} else addResult = 'wave option missing';

	}
	await new Promise( ( r ) => setTimeout( r, 300 ) );
	steps.push( snap( 'B_after_add_wave' ) );

	// ---- state check ----
	const raw = t.userData.fccUI.textAnim;

	// ---- delete the first card via its ✕ button ----
	const panel2 = findPanel();
	let delResult = 'no panel';
	if ( panel2 ) {

		const btns = Array.from( panel2.querySelectorAll( 'button' ) );
		const x = btns.find( ( b ) => b.textContent === '✕' );
		if ( x ) { x.click(); delResult = 'clicked ✕'; } else delResult = 'no ✕ button';

	}
	await new Promise( ( r ) => setTimeout( r, 300 ) );
	steps.push( snap( 'C_after_delete' ) );

	return {
		addResult,
		delResult,
		compTypes: raw.components.map( ( c ) => c.type ),
		compCount: raw.components.length,
		steps,
	};

}, { V } );

console.log( JSON.stringify( out, null, 2 ) );
const bad = logs.filter( ( l ) => l.startsWith( 'PAGEERROR' ) || /TypeError|is not a function|DataCloneError/.test( l ) );
console.log( 'problems:', bad.slice( 0, 8 ) );
await browser.close();
