import { chromium } from 'playwright';

const OUT = 'D:/GrokbotWork/FreeFilmCut/_wipe_test/';
const URL = 'http://localhost:5174/editor/';

const browser = await chromium.launch( {
	args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ],
} );

const logsAll = [];

async function freshPage( id ) {
	const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
	page.on( 'console', ( m ) => {
		if ( m.text().includes( 'wipe' ) || m.type() === 'error' || m.type() === 'warning' ) {
			logsAll.push( `[${id}] ` + m.text().slice( 0, 300 ) );
		}
	} );
	page.on( 'pageerror', ( e ) => logsAll.push( `[${id}] PAGEERROR: ` + e.message.slice( 0, 200 ) ) );
	await page.goto( URL + '?v=' + id, { waitUntil: 'load' } );
	await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
	await page.waitForTimeout( 1200 );
	return page;
}

async function settle( page ) {
	await page.evaluate( () => new Promise( ( r ) => requestAnimationFrame( () => requestAnimationFrame( r ) ) ) );
}

const buildScene = `
window.__buildWipeScene = async function ( opts ) {
	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js?v=fcc-ui-72' );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UIText = await import( './js/ui/UIText.js?v=fcc-ui-91' );

	const olds = [];
	ed.scene.traverse( ( o ) => { if ( o.userData && o.userData.fccUI ) olds.push( o ); } );
	olds.forEach( ( o ) => o.parent && o.parent.remove( o ) );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) {
		canvas = UIF.createUICanvas();
		ed.execute( new AddObjectCommand( ed, canvas ) );
	}

	function makeText( name, txt, posX, posY ) {
		const t = UIF.createUIText( name );
		ed.execute( new AddObjectCommand( ed, t ) );
		ed.execute( new MoveObjectCommand( ed, t, canvas ) );
		const ui = t.userData.fccUI;
		ui.text = txt;
		ui.fontSize = 110;
		ui.sizeDelta = [ 1000, 220 ];
		ui.anchoredPosition = [ posX, posY ];
		UIText.syncUITextContent( t, { x: 0, y: 0, w: 1000, h: 220 } );
		ui.textAnim = {
			format: 'freecapcut.textanim/1', enabled: true, previewPhase: 'in',
			in: {
				duration: 1.0, stagger: { overlap: 0.65, order: 'ltr', seed: 1 }, ease: 'cubicOut',
				channels: {
					opacity: { from: 1, to: 1 }, offsetX: { from: 0, to: 0 }, offsetY: { from: 0, to: 0 },
					scale: { from: 1, to: 1 }, rotateX: { from: 0, to: 0 }, rotateY: { from: 0, to: 0 }, rotateZ: { from: 0, to: 0 },
				},
				modulators: {
					wave: { enabled: false, amp: 12, freq: 1.25, phase: 0 },
					bend: { enabled: false, amount: 0.15 },
					wipeReveal: { enabled: true, direction: opts.direction || 'ltr', soft: 0.04, edgeIntensity: 2.5, edgeWidth: 0.03 },
				},
			}, out: null, loop: null,
		};
		return t;
	}

	const main = makeText( 'WipeMain', '扫光AB', 0, 0 );
	if ( opts.rotateZ ) {
		main.userData.fccUI.localEulerAngles = [ 0, 0, opts.rotateZ ];
		UIText.syncUITextContent( main, { x: 0, y: 0, w: 1000, h: 220 } );
	}
	if ( opts.secondText ) makeText( 'WipeOther', '其他XYZ', -1500, 300 );
	if ( opts.image ) {
		const img = UIF.createUIImage( 'BgImage' );
		ed.execute( new AddObjectCommand( ed, img ) );
		ed.execute( new MoveObjectCommand( ed, img, canvas ) );
		img.userData.fccUI.sizeDelta = [ 900, 600 ];
		img.userData.fccUI.anchoredPosition = [ -700, 0 ];
	}

	ed.textAnimTime = opts.progress;
	ed.textAnimWipeDebug = false;
	ed._fccWipeDbgLogged = false;
	ed.select( main );
	window.__probe = main;
	return { ok: true };
};

window.__waitTextReady = function () {
	return new Promise( ( resolve ) => {
		let n = 0;
		( function tick() {
			const t = window.__probe;
			const root = t && t.getObjectByName( '__fccTextAnimRoot' );
			if ( root && root.userData.__fccReady ) return resolve( true );
			if ( ++n > 240 ) return resolve( false );
			setTimeout( tick, 100 );
		} )();
	} );
};

window.__probeInfo = async function () {
	const t = window.__probe;
	const THREE = await import( 'three' );
	const box = new THREE.Box3().setFromObject( t );
	const v = ( x ) => Number.isFinite( x ) ? +x.toFixed( 1 ) : null;
	return {
		inkMin: [ v( box.min.x ), v( box.min.y ) ],
		inkMax: [ v( box.max.x ), v( box.max.y ) ],
		rect: t.userData.fccUI._layoutRect || null,
		rot: t.userData.fccUI.localEulerAngles || null,
	};
};
`;

const scenarios = [
	{ id: 'F_baseline', opts: { progress: 0.5 } },
	{ id: 'G_bgimage_offscreen_left', opts: { progress: 0.5, image: true } },
	{ id: 'H_second_text', opts: { progress: 0.5, secondText: true } },
	{ id: 'I_rotated15', opts: { progress: 0.5, rotateZ: 15 } },
];

for ( const sc of scenarios ) {
	const page = await freshPage( sc.id );
	await page.evaluate( buildScene );
	await page.evaluate( async ( o ) => { await window.__buildWipeScene( o ); }, sc.opts );
	const ready = await page.evaluate( () => window.__waitTextReady() );
	await page.waitForTimeout( 700 );
	const info = await page.evaluate( () => window.__probeInfo() );
	await settle( page );
	await page.screenshot( { path: OUT + 't3_' + sc.id + '.png' } );
	console.log( sc.id, 'ready=' + ready, JSON.stringify( info ) );
	await page.close();
}

console.log( '--- wipe logs ---' );
console.log( logsAll.filter( ( l ) => l.includes( 'wipe' ) ).slice( 0, 20 ).join( '\n' ) );

await browser.close();
console.log( 'DONE' );
