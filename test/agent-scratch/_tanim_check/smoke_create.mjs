// Regression smoke: fresh scene → create text → add wipeReveal → must produce AABB.
import { chromium } from 'playwright';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 500 );

await page.evaluate( async () => {

	const THREE = await import( 'three' );
	const UF = await import( './js/ui/UIFactory.js?v=fcc-ui-102' );
	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	const UT = await import( './js/ui/UIText.js?v=fcc-ui-102' );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-4' );
	const ed = window.editor;

	ed.clear();
	ed.scene.background = new THREE.Color( 0x101014 );
	const c = UF.createUICanvas(); ed.scene.add( c );
	const t = UF.createUIText( 'Smoke' );
	const ui = t.userData[ UC.FCC_UI_KEY ];
	ui.text = '冒烟 SMOKE';
	ui.fontSize = 110;
	ui.sizeDelta = [ 1000, 200 ];
	UT.syncUITextContent( t, { x: 0, y: 0, w: 1000, h: 200 } );
	c.add( t );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	const w = TT.createDefaultComponent( anim, 'wipeReveal' );
	w.time.duration = 1.4;
	anim.components = [ w ];
	ui.textAnim = anim;

	ed.textAnimTime = 0.7;
	ed._fccWipeDbgLogged = false;
	ed.textAnimWipeDebug = true;
	ed.signals.windowResize.dispatch();

} );

await page.waitForTimeout( 2500 );

const live = await page.evaluate( async () => {

	const UC = await import( './js/ui/UIConstants.js?v=fcc-ui-102' );
	let t = null;
	window.editor.scene.traverse( ( o ) => { const ui = o.userData ? o.userData[ UC.FCC_UI_KEY ] : null; if ( ui && ui.type === 'text' ) t = o; } );
	return { glyphLive: t ? t.children.some( ( c ) => typeof c.text === 'string' ) : false };

} );

console.log( 'glyphLive:', live.glyphLive );
console.log( 'aabb:', logs.filter( ( l ) => l.includes( 'alpha-AABB' ) ).slice( - 2 ) );
console.log( 'errors:', logs.filter( ( l ) => /PAGEERROR|error:/i.test( l ) && ! /GPU stall/i.test( l ) ) );

await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
