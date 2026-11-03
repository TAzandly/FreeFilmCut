// node _tanim_check/browser.mjs
import { chromium } from 'playwright';

const OUT = 'D:/GrokbotWork/FreeFilmCut/_tanim_check/';
const URL = 'http://localhost:5174/editor/';

const browser = await chromium.launch( {
	args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ],
} );
const page = await browser.newPage( { viewport: { width: 1500, height: 950 } } );

const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message + '\n' + ( e.stack || '' ) ) );

const step = ( s ) => console.log( '[step]', s );

await page.goto( URL, { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 2500 );
step( 'editor loaded' );

const v1 = {
	format: 'freecapcut.textanim/1',
	enabled: true,
	previewPhase: 'in',
	in: {
		duration: 1.0,
		stagger: { overlap: 0.65, order: 'ltr', seed: 1 },
		ease: 'cubicOut',
		channels: {
			opacity: { from: 1, to: 1 },
			offsetX: { from: 0, to: 0 },
			offsetY: { from: 0, to: 0 },
			scale: { from: 1, to: 1 },
			rotateX: { from: 0, to: 0 },
			rotateY: { from: 0, to: 0 },
			rotateZ: { from: 0, to: 0 },
		},
		modulators: {
			wave: { enabled: false, amp: 12, freq: 1.25, phase: 0 },
			bend: { enabled: false, amount: 0.15 },
			wipeReveal: { enabled: true, direction: 'ltr', soft: 0.08, edgeIntensity: 2.5, edgeWidth: 0.03 },
		},
	},
	out: {
		duration: 1.0,
		stagger: { overlap: 0.65, order: 'ltr', seed: 1 },
		ease: 'cubicOut',
		channels: {
			opacity: { from: 1, to: 0 }, offsetX: { from: 0, to: 0 }, offsetY: { from: 36, to: 0 },
			scale: { from: 1, to: 0.55 }, rotateX: { from: 0, to: 0 }, rotateY: { from: 0, to: 0 },
			rotateZ: { from: 0.35, to: 0 },
		},
		modulators: {
			wave: { enabled: false, amp: 12, freq: 1.25, phase: 0 },
			bend: { enabled: false, amount: 0.15 },
			wipeReveal: { enabled: false, direction: 'ltr', soft: 0.12, edgeIntensity: 2.5, edgeWidth: 0.04 },
		},
	},
	loop: null,
};

const build = await page.evaluate( async ( v1doc ) => {
	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js?v=fcc-ui-72' );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js?v=fcc-ui-97' );
	const TA = await import( './js/ui/TextAnim.js?v=fcc-ui-8' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) {
		canvas = UIF.createUICanvas();
		ed.execute( new AddObjectCommand( ed, canvas ) );
	}
	const t = UIF.createUIText( 'AnimProbe' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );

	const ui = t.userData.fccUI;
	ui.text = '扫光ABCD';
	ui.fontSize = 120;
	ui.sizeDelta = [ 1100, 240 ];
	ui.anchoredPosition = [ 0, 0 ];

	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 1100, h: 240 } );

	ui.textAnim = v1doc;

	const anim = TA.ensureTextAnimOnUI( ui );
	return {
		format: anim.format,
		types: anim.components.map( ( c ) => c.type ),
		legacy: !! anim.legacy,
		uuid: t.uuid,
		wipeAtHalf: TA.sampleWipeRevealProgress( 0.5, anim ).progress,
		wipeEnabled: TA.sampleWipeRevealProgress( 0.5, anim ).enabled,
		needsSplit: TA.textAnimNeedsCharSplit( anim ),
	};
} , v1 );

console.log( 'build:', JSON.stringify( build ) );

// ---- A. v1 migrated + wipe at 50% ----
await page.evaluate( () => {
	window.editor.textAnimTime = 0.5;
	window.editor.signals.sceneGraphChanged.dispatch();
} );
await page.waitForTimeout( 900 );
await page.screenshot( { path: OUT + 'a_wipe50.png' } );
step( 'shot a_wipe50' );

// ---- B. sidebar renders ----
await page.evaluate( async ( uuid ) => {
	const ed = window.editor;
	const t = ed.scene.getObjectByProperty( 'uuid', uuid );
	ed.select( t );
} , build.uuid );
await page.waitForTimeout( 1200 );
await page.screenshot( { path: OUT + 'b_sidebar.png' } );

const panelInfo = await page.evaluate( () => {
	const txt = document.body.innerText || '';
	return {
		hasTitle: txt.includes( '文字动画' ) || txt.includes( 'Text animation' ),
		hasAdd: txt.includes( '添加动画' ) || txt.includes( 'Add animation' ),
		hasWipe: txt.includes( '扫光' ) || txt.includes( 'Wipe reveal' ),
		hasCharIn: txt.includes( '逐字入场' ) || txt.includes( 'Char In' ),
		snippet: txt.slice( 0, 0 ),
	};
} );
console.log( 'panel:', JSON.stringify( panelInfo ) );

// ---- C. add charIn, scrub 0.35 ----
const cInfo = await page.evaluate( async () => {
	const ed = window.editor;
	const TA = await import( './js/ui/TextAnim.js?v=fcc-ui-8' );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );
	const t = ed.selected;
	const ui = t.userData.fccUI;
	const anim = TA.ensureTextAnimOnUI( ui );
	const c = TT.createDefaultComponent( anim, 'charIn' );
	c.time.start = 0;
	c.time.duration = 1;
	c.params.offsetY = [ -60, 0 ];
	anim.components.push( c );
	t.userData.__fccTextAnimBuiltSig = null;
	ed.textAnimTime = 0.35;
	ed.signals.sceneGraphChanged.dispatch();
	return { total: anim.components.length, id: c.id };
} );
console.log( 'charIn added:', JSON.stringify( cInfo ) );
await page.waitForTimeout( 2000 );
await page.screenshot( { path: OUT + 'c_charIn_mid.png' } );
step( 'shot c_charIn_mid' );

const splitInfo = await page.evaluate( () => {
	const root = window.editor.selected.getObjectByName( '__fccTextAnimRoot' );
	return { ready: root ? !! root.userData.__fccReady : false, chars: root ? root.userData.__fccCharCount : 0 };
} );
console.log( 'split:', JSON.stringify( splitInfo ) );

// ---- D. past the end ----
await page.evaluate( () => {
	window.editor.textAnimTime = 1.6;
	window.editor.signals.sceneGraphChanged.dispatch();
} );
await page.waitForTimeout( 900 );
await page.screenshot( { path: OUT + 'd_end.png' } );
step( 'shot d_end' );

// ---- E. dynamic add through the dropdown (real UI path) ----
const uiPath = await page.evaluate( () => {
	const sels = Array.from( document.querySelectorAll( 'select' ) );
	const add = sels.find( ( s ) => Array.from( s.options ).some( ( o ) => /添加动画|Add animation/.test( o.textContent ) ) );
	if ( ! add ) return { found: false };
	const opt = Array.from( add.options ).find( ( o ) => /波浪|Wave/.test( o.textContent ) );
	add.value = opt.value;
	add.dispatchEvent( new Event( 'change', { bubbles: true } ) );
	return { found: true, picked: opt.textContent };
} );
console.log( 'dropdown:', JSON.stringify( uiPath ) );
await page.waitForTimeout( 900 );
await page.screenshot( { path: OUT + 'e_after_dropdown.png' } );

const after = await page.evaluate( async () => {
	const TA = await import( './js/ui/TextAnim.js?v=fcc-ui-8' );
	const ui = window.editor.selected.userData.fccUI;
	const anim = TA.ensureTextAnimOnUI( ui );
	return { types: anim.components.map( ( c ) => c.type + '/' + ( c.enabled ? 'on' : 'off' ) ) };
} );
console.log( 'after dropdown:', JSON.stringify( after ) );

// ---- errors ----
const bad = logs.filter( ( l ) => l.startsWith( 'PAGEERROR' ) || /error|Error|not a function|undefined is not/.test( l ) );
console.log( '--- console problems (' + bad.length + ') ---' );
for ( const b of bad.slice( 0, 25 ) ) console.log( b );

await browser.close();
console.log( 'DONE' );
