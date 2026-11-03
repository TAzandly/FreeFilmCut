// node _tanim_check/probe.mjs
import { chromium } from 'playwright';
const V = '?v=fcc-ui-100';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1500, height: 950 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 2000 );

const info = await page.evaluate( async ( { V } ) => {
	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js' + V );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }
	const t = UIF.createUIText( 'Probe' );
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
	ed.textAnimTime = 0.4;
	ed.signals.sceneGraphChanged.dispatch();

	await new Promise( ( r ) => setTimeout( r, 400 ) );

	// find our panel: the UIPanel whose header text is 文字动画 / Text animation
	const panels = Array.from( document.querySelectorAll( 'div.Panel' ) );
	const found = [];
	for ( const p of panels ) {
		const hdr = p.firstElementChild;
		const txt = hdr ? hdr.textContent : '';
		if ( /文字动画|Text animation/.test( txt ) && ! /关键帧|Keyframe/.test( txt ) ) {
			found.push( {
				header: txt,
				display: getComputedStyle( p ).display,
				children: p.children.length,
				innerTextLen: p.innerText.length,
				text: p.textContent.slice( 0, 260 ),
				buttons: Array.from( p.querySelectorAll( 'button' ) ).map( ( b ) => b.textContent ),
			} );
		}
	}
	const raw = t.userData.fccUI.textAnim;
	return {
		sameObj: raw === anim,
		rawFormat: raw && raw.format,
		rawLen: raw && raw.components ? raw.components.length : -1,
		rawTypes: raw && raw.components ? raw.components.map( ( c ) => c.type ) : null,
		rawEnabled: raw && raw.enabled,
		uiKeys: Object.keys( t.userData ),
		uiText: t.userData.fccUI.text,
		lang: ed.config.getKey( 'language' ),
		foldKey: ed.config.getKey( 'sidebar/text/animCollapsed' ),
		panelCount: panels.length,
		found,
		selectedType: ed.selected && ed.selected.type,
	};
} , { V } );
console.log( JSON.stringify( info, null, 2 ) );
const bad = logs.filter( ( l ) => l.startsWith( 'PAGEERROR' ) || /TypeError|is not a function/.test( l ) );
console.log( 'problems:', bad.slice( 0, 10 ) );
await browser.close();
