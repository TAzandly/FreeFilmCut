import { chromium } from 'playwright';

const OUT = 'D:/GrokbotWork/FreeFilmCut/_wipe_test/';
const URL = 'http://localhost:5174/editor/';

const browser = await chromium.launch( {
	args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--ignore-gpu-blocklist' ],
} );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );

const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );

await page.goto( URL, { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 2500 );

// Build: UI Canvas + one text with wipeReveal enabled.
const build = await page.evaluate( async () => {
	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js?v=fcc-ui-72' );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UIText = await import( './js/ui/UIText.js?v=fcc-ui-91' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) {
		canvas = UIF.createUICanvas();
		ed.execute( new AddObjectCommand( ed, canvas ) );
	}
	const t = UIF.createUIText( 'WipeProbe' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );

	const ui = t.userData.fccUI;
	ui.text = '扫光AB';
	ui.fontSize = 120;
	ui.sizeDelta = [ 900, 220 ];
	ui.anchoredPosition = [ 0, 0 ];

	UIText.syncUITextContent( t, { x: 0, y: 0, w: 900, h: 220 } );

	ui.textAnim = {
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
				wipeReveal: { enabled: true, direction: 'ltr', soft: 0.05, edgeIntensity: 2.5, edgeWidth: 0.03 },
			},
		},
		out: null,
		loop: null,
	};
	ed.textAnimTime = 0.5;
	ed.select( t );
	window.__probe = t;
	window.__probeCanvas = canvas;

	return {
		canvasRect: ( () => {
			const u = canvas.userData.fccUI;
			return { sizeDelta: u.sizeDelta, anchor: u.anchorMin };
		} )(),
		ok: true,
	};
} );

await page.waitForTimeout( 1500 );

// Inspect geometry: where is the text actually, and what does the RT alpha AABB say?
const geo = await page.evaluate( async () => {
	const ed = window.editor;
	const t = window.__probe;
	const THREE = await import( 'three' );
	const box = new THREE.Box3().setFromObject( t );
	const root = t.getObjectByName( '__fccTextAnimRoot' );
	const chars = [];
	if ( root ) {
		root.children.forEach( ( c ) => {
			if ( c.name && c.name.startsWith( '__fccChar_' ) ) {
				const b = c.userData.__fccCharBase;
				chars.push( { name: c.name, base: b, pos: c.position.toArray() } );
			}
		} );
	}
	const uiText = t.getObjectByName( '__fccText' );
	return {
		textAnimTime: ed.textAnimTime,
		projectRes: ed.getProjectRes ? null : null,
		boxMin: box.min.toArray().map( ( v ) => + v.toFixed( 1 ) ),
		boxMax: box.max.toArray().map( ( v ) => + v.toFixed( 1 ) ),
		rootReady: ! ! ( root && root.userData.__fccReady ),
		charCount: root ? root.userData.__fccCharCount : 0,
		chars,
		uiRect: t.userData.fccUI._layoutRect || null,
		camLeftRight: null,
		viewportCamType: ed.viewportCamera ? ed.viewportCamera.type : null,
	};
} );

console.log( 'BUILD', JSON.stringify( build ) );
console.log( 'GEO', JSON.stringify( geo, null, 2 ) );
console.log( '--- console logs ---' );
console.log( logs.slice( - 40 ).join( '\n' ) );

await page.screenshot( { path: OUT + 'shot_progress50.png' } );

// Debug mask view
await page.evaluate( () => { window.editor.textAnimWipeDebug = true; window.editor._fccWipeDbgLogged = false; } );
await page.waitForTimeout( 800 );
await page.screenshot( { path: OUT + 'shot_debugmask.png' } );

console.log( '--- logs after debug ---' );
console.log( logs.slice( - 25 ).join( '\n' ) );

await browser.close();
