// Diagnose: wipe pass must actually alter the text RT.
// No image files — numeric/programmatic only.
// node _tanim_check/wipe_diag.mjs
import { chromium } from 'playwright';

const V = '?v=fcc-ui-100';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
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
	const TA = await import( './js/ui/TextAnim.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );
	const TLR = await import( './js/ui/TextLayerRT.js' + V );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }
	const t = UIF.createUIText( 'WipeDiag' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );
	const ui = t.userData.fccUI;
	ui.text = '扫光ABCD';
	ui.fontSize = 120;
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 900, h: 240 } );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	const w = TT.createDefaultComponent( anim, 'wipeReveal' );
	anim.components = [ w ];
	ui.textAnim = anim;

	ed.select( null );
	ed.select( t );

	// wait for troika glyph rasterisation
	await new Promise( ( r ) => setTimeout( r, 1200 ) );

	const report = {};

	// ---- what the Viewport gate sees ----
	report.gate = {};
	for ( const tt of [ 0, 0.25, 0.5, 0.75, 1 ] ) {

		const wr = TA.sampleWipeRevealProgress( tt, ui.textAnim );
		report.gate[ tt ] = { enabled: wr.enabled, progress: wr.progress, dir: wr.direction };

	}

	// ---- engine pass ops ----
	report.passOps = {};
	for ( const tt of [ 0, 0.5, 1 ] ) {

		report.passOps[ tt ] = TA.sampleTextPassOps( ui.textAnim, tt )
			.map( ( o ) => o.kind + ':' + o.progress.toFixed( 3 ) );

	}

	report.timelineEnd = TA.textAnimTimelineEnd( ui.textAnim );
	report.comp = { start: w.time.start, duration: w.time.duration, loop: w.time.loop, enabled: w.enabled };
	report.editorTime = ed.textAnimTime;

	// ---- is the RT actually produced for this text only? ----
	// force one render at t=0.5 then read the alpha AABB the wipe uses
	ed.textAnimTime = 0.5;
	ed.textAnimWipeDebug = false;
	ed.signals.sceneGraphChanged.dispatch();
	await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );

	const proj = ed.project ? ed.project : null;
	report.projectRes = proj ? { w: proj.width, h: proj.height } : null;

	// diff check: pixels of the letterbox area with wipe at 0 vs 0.5 vs off
	function grab() {

		const c = document.querySelector( 'canvas' );
		const g = document.createElement( 'canvas' );
		g.width = 160; g.height = 90;
		const ctx = g.getContext( '2d' );
		ctx.drawImage( c, 0, 0, g.width, g.height );
		const d = ctx.getImageData( 0, 0, g.width, g.height ).data;
		let sum = 0, nonBg = 0;
		for ( let i = 0; i < d.length; i += 4 ) {

			sum += d[ i ] + d[ i + 1 ] + d[ i + 2 ];
			if ( d[ i ] + d[ i + 1 ] + d[ i + 2 ] > 210 ) nonBg ++;

		}
		return { sum, nonBg };

	}

	async function at( time, enabled ) {

		w.enabled = enabled;
		ed.textAnimTime = time;
		ed.signals.sceneGraphChanged.dispatch();
		await new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) );
		return grab();

	}

	report.pix = {};
	report.pix.t0_wipeOn = await at( 0, true );
	report.pix.t05_wipeOn = await at( 0.5, true );
	report.pix.t1_wipeOn = await at( 1, true );
	report.pix.t05_wipeOff = await at( 0.5, false );

	w.enabled = true;

	return report;

}, { V } );

console.log( JSON.stringify( out, null, 2 ) );
const wipeLogs = logs.filter( ( l ) => /wipe|Wipe/.test( l ) );
console.log( '--- wipe logs ---' );
console.log( wipeLogs.slice( 0, 10 ).join( '\n' ) || '(none)' );
const bad = logs.filter( ( l ) => l.startsWith( 'PAGEERROR' ) || /TypeError|is not a function/.test( l ) );
console.log( 'problems:', bad.slice( 0, 8 ) );
await browser.close();
