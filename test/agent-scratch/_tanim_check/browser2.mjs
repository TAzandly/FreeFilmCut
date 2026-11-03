// node _tanim_check/browser2.mjs
import { chromium } from 'playwright';

const OUT = 'D:/GrokbotWork/FreeFilmCut/_tanim_check/';
const URL = 'http://localhost:5174/editor/';
const V = '?v=fcc-ui-100';

const browser = await chromium.launch( {
	args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ],
} );
const page = await browser.newPage( { viewport: { width: 1500, height: 950 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );

await page.goto( URL, { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 2500 );

// ---------------------------------------------------------------- build
const built = await page.evaluate( async ( { V } ) => {
	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js' + V );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js' + V );
	const TA = await import( './js/ui/TextAnim.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) {
		canvas = UIF.createUICanvas();
		ed.execute( new AddObjectCommand( ed, canvas ) );
	}
	const t = UIF.createUIText( 'AnimProbe2' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );

	const ui = t.userData.fccUI;
	ui.text = '文字动画测试';
	ui.fontSize = 110;
	ui.sizeDelta = [ 1000, 220 ];
	ui.anchoredPosition = [ 0, 0 ];
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 1000, h: 220 } );

	// v2 doc straight away
	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	anim.components = [];

	const cIn = TT.createDefaultComponent( anim, 'charIn' );
	cIn.time.start = 0;
	cIn.time.duration = 1;
	anim.components.push( cIn );

	const cWipe = TT.createDefaultComponent( anim, 'wipeReveal' );
	cWipe.time.start = 0;
	cWipe.time.duration = 1.2;
	anim.components.push( cWipe );

	ui.textAnim = anim;

	ed.config.setKey( 'sidebar/text/animCollapsed', false );
	ed.select( null );
	ed.select( t );
	ed.textAnimTime = 0.4;
	ed.signals.sceneGraphChanged.dispatch();

	return { uuid: t.uuid, components: anim.components.map( ( c ) => c.type + ':' + c.id ) };
} , { V } );
console.log( 'built:', JSON.stringify( built ) );
await page.waitForTimeout( 2200 );
await page.screenshot( { path: OUT + 'g_panel.png' } );

// ---------------------------------------------------------------- sidebar DOM
const panel = await page.evaluate( () => {
	const txt = document.body.innerText || '';
	const has = ( s ) => txt.includes( s );
	return {
		title: has( '文字动画' ),
		cardCharIn: has( '逐字入场' ),
		cardWipe: has( '扫光' ),
		rangeLabel: has( '范围 / 错开' ),
		channels: has( '通道' ),
		timeWin: has( '时间窗' ),
		enable: has( '启用' ),
		add: has( '添加动画' ),
		buttons: Array.from( document.querySelectorAll( 'button' ) ).map( ( b ) => b.textContent ).filter( ( s ) => /👁|✕|播放|添加/.test( s ) ),
		selects: Array.from( document.querySelectorAll( 'select' ) ).length,
		numbers: Array.from( document.querySelectorAll( 'input[type=number]' ) ).length,
	};
} );
console.log( 'panel:', JSON.stringify( panel, null, 0 ) );

// ---------------------------------------------------------------- runtime pose check
const poseCheck = await page.evaluate( async ( { V } ) => {
	const ed = window.editor;
	const TA = await import( './js/ui/TextAnim.js' + V );
	const t = ed.selected;
	const ui = t.userData.fccUI;
	const anim = TA.ensureTextAnimOnUI( ui );
	const root = t.getObjectByName( '__fccTextAnimRoot' );
	if ( ! root || ! root.userData.__fccReady ) return { error: 'no char root' };

	const n = root.userData.__fccCharCount;
	const sample = TA.sampleTextAnim( anim, ed.textAnimTime, n );
	const rows = [];
	for ( let i = 0; i < n; i ++ ) {
		const g = root.getObjectByName( '__fccChar_' + i );
		const b = g.userData.__fccCharBase;
		const p = sample.charPoses[ i ];
		rows.push( {
			i,
			dx: +( g.position.x - b.x ).toFixed( 3 ),
			pdx: +p.offsetX.toFixed( 3 ),
			dy: +( g.position.y - b.y ).toFixed( 3 ),
			pdy: +p.offsetY.toFixed( 3 ),
			sx: +g.scale.x.toFixed( 3 ),
			psx: +p.scaleX.toFixed( 3 ),
			rz: +g.rotation.z.toFixed( 3 ),
			prz: +p.rotateZ.toFixed( 3 ),
			vis: g.visible,
		} );
	}
	return { n, rows, passOps: sample.passOps.map( ( o ) => ( { kind: o.kind, progress: +o.progress.toFixed( 3 ) } ) ) };
} , { V } );
console.log( 'pose:', JSON.stringify( poseCheck ) );

let mismatches = 0;
if ( poseCheck.rows ) {
	for ( const r of poseCheck.rows ) {
		if ( Math.abs( r.dx - r.pdx ) > 1e-3 ) mismatches++;
		if ( Math.abs( r.dy - r.pdy ) > 1e-3 ) mismatches++;
		if ( Math.abs( r.sx - r.psx ) > 1e-3 ) mismatches++;
		if ( Math.abs( r.rz - r.prz ) > 1e-3 ) mismatches++;
	}
}
console.log( 'pose mismatches:', mismatches );

// ---------------------------------------------------------------- delete via UI (✕)
const del = await page.evaluate( async ( { V } ) => {
	const ed = window.editor;
	const TA = await import( './js/ui/TextAnim.js' + V );
	const btns = Array.from( document.querySelectorAll( 'button' ) );
	const x = btns.find( ( b ) => b.textContent.trim() === '✕' );
	if ( ! x ) return { clicked: false };
	const before = TA.ensureTextAnimOnUI( ed.selected.userData.fccUI ).components.length;
	x.click();
	await new Promise( ( r ) => setTimeout( r, 200 ) );
	const after = TA.ensureTextAnimOnUI( ed.selected.userData.fccUI ).components.length;
	return { clicked: true, before, after };
} , { V } );
console.log( 'delete:', JSON.stringify( del ) );

await page.waitForTimeout( 700 );
await page.screenshot( { path: OUT + 'h_after_delete.png' } );

// ---------------------------------------------------------------- autosave check
await page.waitForTimeout( 6000 );
const saved = logs.filter( ( l ) => /Saved state to IndexedDB|DataCloneError|IndexedDB put failed/.test( l ) );
console.log( 'autosave:', JSON.stringify( saved.slice( 0, 5 ) ) );

const bad = logs.filter( ( l ) => l.startsWith( 'PAGEERROR' ) || /is not a function|TypeError|ReferenceError/.test( l ) );
console.log( '--- problems (' + bad.length + ') ---' );
for ( const b of bad.slice( 0, 20 ) ) console.log( b );

await browser.close();
console.log( 'DONE' );
