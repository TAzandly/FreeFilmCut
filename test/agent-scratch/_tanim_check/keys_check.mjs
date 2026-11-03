// Text-anim keyframes: v2 migration, panel/timeline driven wipe, charIn keys.
import { chromium } from 'playwright';
import path from 'node:path';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 400 );
await page.locator( 'form input[type=file][accept=".json"]' ).first()
	.setInputFiles( path.resolve( '_tanim_check/cases', 'overlay.json' ) );
await page.waitForTimeout( 2800 );

const migrated = await page.evaluate( () => {

	const ed = window.editor;
	let text = null;
	ed.scene.traverse( ( o ) => { if ( o.userData && o.userData.fccUI && o.userData.fccUI.type === 'text' && ! o.userData.__fccTextAnimChar ) text = o; } );
	window.__text = text;
	const ta = text.userData.fccUI.textAnim;
	const clips = ( ed.freecapcutAnims || [] ).map( ( c ) => ( {
		name: c.name, duration: c.duration,
		tracks: c.targets.flatMap( ( t ) => t.tracks.map( ( tr ) => ( { uuidOk: t.objectUuid === text.uuid, path: tr.path, keys: tr.keys } ) ) ),
	} ) );
	return { format: ta.format, compTime: ta.components[ 0 ].time, legacyTimes: ta.legacyTimes, clips };

} );
console.log( 'MIGRATION', JSON.stringify( migrated ) );

await page.evaluate( () => {

	const ed = window.editor;
	const gl = ed.renderer.getContext();
	window.__grabNext = false;
	ed.signals.sceneRendered.add( () => {

		if ( ! window.__grabNext ) return;
		window.__grabNext = false;
		const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
		const buf = new Uint8Array( w * h * 4 );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );
		let lit = 0, minX = 1e9, maxX = - 1;
		for ( let i = 0; i < buf.length; i += 4 ) {

			if ( buf[ i ] < 200 || buf[ i + 1 ] < 200 || buf[ i + 2 ] < 200 ) continue;
			lit ++;
			const x = ( i / 4 ) % w;
			if ( x < minX ) minX = x;
			if ( x > maxX ) maxX = x;

		}
		window.__grab = { lit, minX, maxX };

	} );

} );

async function grab( fnBody, arg ) {

	await page.evaluate( async ( [ body, a ] ) => {

		const ed = window.editor;
		const fn = new Function( 'ed', 'a', 'return (async () => {' + body + '})()' );
		await fn( ed, a );
		window.__grab = null;
		window.__grabNext = true;
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 600 ) );

	}, [ fnBody, arg ] );
	return page.evaluate( () => window.__grab );

}

const PANEL = `
	const core = await import( '/editor/js/anim/FreeCapCutAnimCore.js?v=fcc-anim-15' );
	core.applyAllEditorAnims( ed, ed.scene, a );
`;
const panel = {};
for ( const t of [ 0, 0.8, 1.6 ] ) panel[ 't=' + t ] = await grab( PANEL, t );
console.log( 'PANEL wipe', JSON.stringify( panel ) );

// Timeline: animation clip placed at 1s; local time = t - 1.
const TIMELINE = `
	const tl = await import( '/editor/js/timeline/FccTimelineCore.js?v=fcc-ui-107' );
	const clip = ed.freecapcutAnims.find( ( c ) => c.targets.some( ( t ) => t.objectUuid === window.__text.uuid ) );
	const asset = { format: 'freecapcut-timeline/1', fps: 30, duration: 4, loop: 'clamp', tracks: [
		{ type: 'animation', bindingUuid: window.__text.uuid, clips: [ { start: 1, duration: 3, animId: clip.name } ] } ] };
	tl.sampleTimeline( { scene: ed.scene, asset, t: a, animByName: new Map( [ [ clip.name, clip ] ] ) } );
`;
const timeline = {};
for ( const t of [ 1.0, 1.8, 2.6 ] ) timeline[ 't=' + t ] = await grab( TIMELINE, t );
console.log( 'TIMELINE wipe', JSON.stringify( timeline ) );

// Ease on the first key: easeIn at local 0.8 reveals less than linear.
const EASED = `
	const clip = ed.freecapcutAnims.find( ( c ) => c.targets.some( ( t ) => t.objectUuid === window.__text.uuid ) );
	const tr = clip.targets[ 0 ].tracks[ 0 ];
	tr.keys[ 0 ].ease = a;
	const core = await import( '/editor/js/anim/FreeCapCutAnimCore.js?v=fcc-anim-15' );
	core.applyAllEditorAnims( ed, ed.scene, 0.8 );
`;
console.log( 'EASE easeIn@0.8', JSON.stringify( await grab( EASED, 'easeIn' ) ) );
console.log( 'EASE easeOut@0.8', JSON.stringify( await grab( EASED, 'easeOut' ) ) );

// Add a charIn through the sidebar path and key its offsetY "from".
const charIn = await page.evaluate( async () => {

	const ed = window.editor;
	const text = window.__text;
	ed.select( text );
	await new Promise( ( r ) => setTimeout( r, 200 ) );
	const sel = [ ...document.querySelectorAll( 'select' ) ].find( ( s ) => [ ...s.options ].some( ( o ) => o.value === 'charIn' ) );
	sel.value = 'charIn';
	sel.dispatchEvent( new Event( 'change' ) );
	await new Promise( ( r ) => setTimeout( r, 1500 ) );
	const comp = text.userData.fccUI.textAnim.components.find( ( c ) => c.type === 'charIn' );
	const core = await import( '/editor/js/anim/FreeCapCutAnimCore.js?v=fcc-anim-15' );
	const clip = ed.freecapcutAnims.find( ( c ) => c.targets.some( ( t ) => t.objectUuid === text.uuid ) );
	const target = clip.targets.find( ( t ) => t.objectUuid === text.uuid );
	const prog = target.tracks.find( ( tr ) => tr.path === 'textAnim.' + comp.id + '.progress' );
	core.upsertKey( core.ensureTrack( target, 'textAnim.' + comp.id + '.offsetY.0' ), 0, - 120 );
	const poses = {};
	for ( const t of [ 0, 0.4, 2 ] ) {

		core.applyAllEditorAnims( ed, ed.scene, t );
		ed.signals.windowResize.dispatch();
		await new Promise( ( r ) => setTimeout( r, 500 ) );
		const root = text.getObjectByName( '__fccTextAnimRoot' );
		const c0 = root && root.getObjectByName( '__fccChar_0' );
		const base = c0 && c0.userData.__fccCharBase;
		poses[ 't=' + t ] = c0 ? { dy: +( c0.position.y - base.y ).toFixed( 2 ), sx: +c0.scale.x.toFixed( 3 ) } : 'no split';

	}
	const sidebarKeyed = [ ...document.querySelectorAll( '[title]' ) ].filter( ( e ) => /已 K 帧/.test( e.title ) ).length;
	return { id: comp.id, hasTime: 'time' in comp, progKeys: prog && prog.keys, poses, sidebarKeyed };

} );
console.log( 'CHARIN', JSON.stringify( charIn ) );

await page.evaluate( () => { window.editor.openAnimationPanel(); } );
await page.waitForTimeout( 600 );
await page.locator( '#animation' ).screenshot( { path: '_tanim_check/keys_panel.png' } );
await page.evaluate( () => {

	const k = document.querySelectorAll( '#animation .anim-key' )[ 1 ];
	k.dispatchEvent( new MouseEvent( 'mousedown', { bubbles: true } ) );
	document.dispatchEvent( new MouseEvent( 'mouseup', { bubbles: true } ) );

} );
await page.waitForTimeout( 400 );
const opts = await page.evaluate( () => [ ...document.querySelectorAll( '#animation select' ) ]
	.map( ( s ) => [ ...s.options ].map( ( o ) => o.text ) ).find( ( a ) => a.some( ( x ) => x.includes( '文字动画' ) ) ) );
console.log( 'TEXT KEY OPTIONS', JSON.stringify( opts ) );
await page.locator( '#animation' ).screenshot( { path: '_tanim_check/keys_inspector.png' } );

console.log( 'ERRORS', JSON.stringify( logs.filter( ( l ) => /PAGEERROR|error:|TypeError/i.test( l ) ).slice( 0, 8 ) ) );
console.log( 'TEXTANIM LOGS', JSON.stringify( logs.filter( ( l ) => /textanim/i.test( l ) ).slice( 0, 5 ) ) );
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
