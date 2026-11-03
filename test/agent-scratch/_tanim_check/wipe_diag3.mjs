// Which configuration loses the wipe? Reports the alpha-AABB per config.
// node _tanim_check/wipe_diag3.mjs
import { chromium } from 'playwright';

const V = '?v=fcc-ui-100';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 1500 );

await page.evaluate( async ( { V } ) => {

	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js' + V );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );
	const THREE = await import( './js/../build/three.module.js' + V ).catch( () => null );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }

	window.__mk = function ( name, comps, opts = {} ) {

		const t = UIF.createUIText( name );
		ed.execute( new AddObjectCommand( ed, t ) );
		ed.execute( new MoveObjectCommand( ed, t, canvas ) );
		const ui = t.userData.fccUI;
		ui.text = opts.text || '扫光ABCD';
		ui.fontSize = 120;
		UITextMod.syncUITextContent( t, { x: opts.x || 0, y: opts.y || 0, w: 900, h: 240 } );
		const anim = TT.createDefaultTextAnim();
		anim.enabled = true;
		anim.components = comps.map( ( type ) => {

			const c = TT.createDefaultComponent( anim, type );
			if ( type === 'charIn' ) { c.time.start = 0; c.time.duration = 0.01; }
			return c;

		} );
		ui.textAnim = anim;
		return t;

	};

}, { V } );

async function run( label, setup, time ) {

	logs.length = 0;
	await page.evaluate( async ( { setup, time } ) => {

		const ed = window.editor;
		// clear texts
		for ( const c of [ ...ed.scene.children ] ) {

			if ( c.userData && c.userData.fccUI && c.userData.fccUI.text != null ) ed.scene.remove( c );

		}
		const t = window.__mk( 'T_' + setup, setup.comps, setup.opts || {} );
		ed.select( null );
		ed.select( t );
		await new Promise( ( r ) => setTimeout( r, 1000 ) );
		ed.textAnimTime = time;
		ed.textAnimWipeDebug = true;
		ed._fccWipeDbgLogged = false;
		ed.signals.sceneGraphChanged.dispatch();
		await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( () => requestAnimationFrame( r ) ) ) );

	}, { setup, time }, );

	const aabb = logs.filter( ( l ) => /alpha-AABB/.test( l ) );
	const errs = logs.filter( ( l ) => /PAGEERROR|TypeError|not a function/.test( l ) );
	const progressLine = aabb.find( ( l ) => /progress/.test( l ) );
	console.log( `${label.padEnd( 26 )} aabbLines=${aabb.length}  ${( progressLine || aabb[ 0 ] || '(none)' ).slice( 0, 140 )}  err=${errs[ 0 ] ? errs[ 0 ].slice( 0, 80 ) : '-'}` );

}

await run( 'A wipe only', { comps: [ 'wipeReveal' ] }, 0.5 );
await run( 'B charIn + wipe', { comps: [ 'charIn', 'wipeReveal' ] }, 0.5 );
await run( 'C wipe @t=0', { comps: [ 'wipeReveal' ] }, 0 );
await run( 'D wipe @t=1', { comps: [ 'wipeReveal' ] }, 1 );
await run( 'E wipe + wave', { comps: [ 'wave', 'wipeReveal' ] }, 0.5 );

await browser.close();
