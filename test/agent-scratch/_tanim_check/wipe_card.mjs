// DOM text of the 扫光 card + whether 调试 checkbox exists.
// node _tanim_check/wipe_card.mjs
import { chromium } from 'playwright';

const V = '?v=fcc-ui-100';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1500, height: 950 } } );
const logs = [];
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
	const t = UIF.createUIText( 'CardProbe' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );
	const ui = t.userData.fccUI;
	ui.text = '扫光';
	ui.fontSize = 110;
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 600, h: 200 } );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	anim.components = [ TT.createDefaultComponent( anim, 'wipeReveal' ) ];
	ui.textAnim = anim;

	ed.config.setKey( 'sidebar/text/animCollapsed', false );
	ed.select( null );
	ed.select( t );
	await new Promise( ( r ) => setTimeout( r, 400 ) );

	let panel = null;
	for ( const p of document.querySelectorAll( 'div.Panel' ) ) {

		const hdr = p.firstElementChild;
		const txt = hdr ? hdr.textContent : '';
		if ( /文字动画|Text animation/.test( txt ) && ! /关键帧|Keyframe/.test( txt ) ) panel = p;

	}
	const lines = panel ? panel.innerText.split( '\n' ).map( ( s ) => s.trim() ).filter( Boolean ) : [];
	// start from the card title
	const i = lines.findIndex( ( s ) => /扫光|Wipe/.test( s ) );

	return {
		uiTextFreeze: ed.textAnimTime,
		compTime: anim.components[ 0 ].time,
		compParams: anim.components[ 0 ].params,
		compChannels: anim.components[ 0 ].channels,
		cardLines: i >= 0 ? lines.slice( i, i + 40 ) : lines,
		inputs: panel ? Array.from( panel.querySelectorAll( 'input' ) ).map( ( el ) => el.type + ':' + ( el.value || '' ) ) : [],
	};

}, { V } );

console.log( JSON.stringify( out, null, 2 ) );
console.log( 'problems:', logs.slice( 0, 5 ) );
await browser.close();
