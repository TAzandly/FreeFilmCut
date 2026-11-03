// End-to-end: open a v1 doc with a wipe, check panel + gating + time jump.
// node _tanim_check/wipe_e2e.mjs
import { chromium } from 'playwright';

const V = '?v=fcc-ui-101';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1500, height: 950 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.text() ) );
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

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }
	const t = UIF.createUIText( 'E2E' );
	ed.execute( new AddObjectCommand( ed, t ) );
	ed.execute( new MoveObjectCommand( ed, t, canvas ) );
	const ui = t.userData.fccUI;
	ui.text = '扫光ABCD';
	ui.fontSize = 120;
	UITextMod.syncUITextContent( t, { x: 0, y: 0, w: 900, h: 240 } );

	// a REAL v1 document, exactly as an old project would have saved it
	ui.textAnim = {
		format: 'freecapcut.textanim/1',
		enabled: true,
		in: {
			duration: 1,
			ease: 'cubicOut',
			stagger: { overlap: 0.65, order: 'ltr', seed: 1 },
			channels: {
				opacity: { from: 0, to: 1 },
				offsetY: { from: - 36, to: 0 },
				scale: { from: 0.55, to: 1 },
				rotateZ: { from: - 0.35, to: 0 },
			},
			modulators: { wipeReveal: { enabled: true, direction: 'ltr', soft: 0.08, edgeIntensity: 3, edgeWidth: 0.03 } },
		},
		out: null,
	};

	ed.config.setKey( 'sidebar/text/animCollapsed', false );
	ed.select( null );
	ed.select( t );
	await new Promise( ( r ) => setTimeout( r, 1200 ) );

	const anim = ui.textAnim;
	const panelLines = ( () => {

		for ( const p of document.querySelectorAll( 'div.Panel' ) ) {

			const hdr = p.firstElementChild;
			const txt = hdr ? hdr.textContent : '';
			if ( /文字动画|Text animation/.test( txt ) && ! /关键帧|Keyframe/.test( txt ) ) {

				return p.innerText.split( '\n' ).map( ( s ) => s.trim() ).filter( Boolean );

			}

		}
		return null;

	} )();

	// gating at a few times
	const gate = {};
	for ( const tt of [ 0, 0.5, 1 ] ) {

		const w = TA.sampleWipeRevealProgress( tt, anim );
		gate[ tt ] = { on: w.enabled, p: +w.progress.toFixed( 2 ) };

	}

	const before = ed.textAnimTime;

	// now add another wipe through the real select and see if time jumps
	let timeAfterAdd = null;
	for ( const p of document.querySelectorAll( 'div.Panel' ) ) {

		const hdr = p.firstElementChild;
		const txt = hdr ? hdr.textContent : '';
		if ( ! ( /文字动画|Text animation/.test( txt ) && ! /关键帧|Keyframe/.test( txt ) ) ) continue;
		const sel = p.querySelector( 'select' );
		if ( ! sel ) continue;
		sel.value = 'wipeReveal';
		sel.dispatchEvent( new Event( 'change', { bubbles: true } ) );
		break;

	}
	await new Promise( ( r ) => setTimeout( r, 400 ) );
	timeAfterAdd = ed.textAnimTime;

	return {
		format: anim.format,
		components: anim.components.map( ( c ) => ( { type: c.type, scope: c.scope, solo: c.suppressCharPose === true } ) ),
		hasWipe: anim.components.some( ( c ) => c.type === 'wipeReveal' ),
		needsCharSplit: TA.textAnimNeedsCharSplit( anim ),
		gate,
		timeBeforeAdd: before,
		timeAfterAdd,
		panelHasSolo: panelLines ? panelLines.some( ( l ) => /独占显隐|Solo/.test( l ) ) : null,
		panelHasWipeCard: panelLines ? panelLines.some( ( l ) => /^扫光$/.test( l ) ) : null,
		panelTail: panelLines ? panelLines.slice( - 14 ) : null,
	};

}, { V } );

console.log( JSON.stringify( out, null, 2 ) );

const A = [];
A.push( [ 'v1 存档已迁移为 v2', out.format === 'freecapcut.textanim/2' ] );
A.push( [ '扫光组件被恢复', out.hasWipe ] );
A.push( [ '扫光标记为独占显隐', out.components.some( ( c ) => c.type === 'wipeReveal' && c.solo ) ] );
A.push( [ '预览不拆字（走 rest pose）', out.needsCharSplit === false ] );
A.push( [ '扫光在 0/0.5/1 全程 enabled', out.gate[ 0 ].on && out.gate[ '0.5' ].on && out.gate[ 1 ].on ] );
A.push( [ '进度随时间为 0/0.5/1', out.gate[ 0 ].p === 0 && Math.abs( out.gate[ '0.5' ].p - 0.5 ) < 0.01 && out.gate[ 1 ].p === 1 ] );
A.push( [ '卡片有「独占显隐」开关', out.panelHasSolo === true ] );
A.push( [ '添加扫光后预览时间跳到窗口中段', out.timeAfterAdd != null && out.timeAfterAdd > 0 && out.timeAfterAdd < 2 ] );

let fails = 0;
for ( const [ n, c ] of A ) { if ( ! c ) fails ++; console.log( ( c ? 'PASS  ' : 'FAIL  ' ) + n ); }
const errs = logs.filter( ( l ) => /PAGEERROR|TypeError/.test( l ) );
console.log( 'errors:', errs.slice( 0, 5 ) );
console.log( fails === 0 && errs.length === 0 ? 'ALL PASS' : fails + ' FAILED' );
await browser.close();
