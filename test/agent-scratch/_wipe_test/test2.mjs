import { chromium } from 'playwright';

const OUT = 'D:/GrokbotWork/FreeFilmCut/_wipe_test/';
const URL = 'http://localhost:5174/editor/';

const browser = await chromium.launch( {
	args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ],
} );

async function freshPage() {
	const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
	await page.goto( URL, { waitUntil: 'load' } );
	await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
	await page.waitForTimeout( 1500 );
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
	const THREE = await import( 'three' );

	// wipe All existing UI from previous runs
	const olds = [];
	ed.scene.traverse( ( o ) => { if ( o.userData && o.userData.fccUI ) olds.push( o ); } );
	olds.forEach( ( o ) => o.parent && o.parent.remove( o ) );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) {
		canvas = UIF.createUICanvas();
		ed.execute( new AddObjectCommand( ed, canvas ) );
	}

	function makeText( name, txt, posX ) {
		const t = UIF.createUIText( name );
		ed.execute( new AddObjectCommand( ed, t ) );
		ed.execute( new MoveObjectCommand( ed, t, canvas ) );
		const ui = t.userData.fccUI;
		ui.text = txt;
		ui.fontSize = 110;
		ui.sizeDelta = [ 900, 200 ];
		ui.anchoredPosition = [ posX, 0 ];
		UIText.syncUITextContent( t, { x: 0, y: 0, w: 900, h: 200 } );
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
					wipeReveal: { enabled: true, direction: opts.direction || 'ltr', soft: 0.05, edgeIntensity: 2.5, edgeWidth: 0.03 },
				},
			}, out: null, loop: null,
		};
		return t;
	}

	const main = makeText( 'WipeMain', '扫光AB', 0 );
	if ( opts.rotateZ ) {
		main.userData.fccUI.localEulerAngles = [ 0, 0, opts.rotateZ ];
		UIText.syncUITextContent( main, { x: 0, y: 0, w: 900, h: 200 } );
	}

	let others = [];
	if ( opts.secondText ) others.push( makeText( 'WipeOther', '其他文字XYZ', -1400, ) );
	if ( opts.image ) {
		const img = UIF.createUIImage( 'BgImage' );
		ed.execute( new AddObjectCommand( ed, img ) );
		ed.execute( new MoveObjectCommand( ed, img, canvas ) );
		const iui = img.userData.fccUI;
		iui.sizeDelta = [ 1400, 800 ];
		iui.anchoredPosition = [ 0, 0 ];
	}

	ed.textAnimTime = opts.progress;
	ed.select( main );
	window.__probe = main;
	return { ok: true, others: others.length };
};
`;

const scenarios = [
	{ id: 'A_baseline', opts: { progress: 0.5 } },
	{ id: 'B_with_bgimage', opts: { progress: 0.5, image: true } },
	{ id: 'C_second_text', opts: { progress: 0.5, secondText: true } },
	{ id: 'D_rotated15', opts: { progress: 0.5, rotateZ: 15 } },
	{ id: 'E_ttb', opts: { progress: 0.5, direction: 'ttb' } },
];

for ( const sc of scenarios ) {
	const page = await freshPage();
	await page.evaluate( buildScene );
	const r = await page.evaluate( async ( o ) => {
		await window.__buildWipeScene( o );
		const t = window.__probe;
		const THREE = await import( 'three' );
		const box = new THREE.Box3().setFromObject( t );
		return {
			ink: { min: box.min.toArray().map( ( v ) => +v.toFixed( 1 ) ), max: box.max.toArray().map( ( v ) => +v.toFixed( 1 ) ) },
			rect: t.userData.fccUI._layoutRect || null,
			time: window.editor.textAnimTime,
		};
	}, sc.opts );
	await settle( page );
	await page.screenshot( { path: OUT + 't2_' + sc.id + '.png' } );
	console.log( sc.id, JSON.stringify( r ) );
	await page.close();
}

await browser.close();
console.log( 'DONE' );
