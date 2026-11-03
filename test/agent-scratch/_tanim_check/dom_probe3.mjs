// Numeric engine check: stacked components must actually change char pose.
// No screenshots. node _tanim_check/dom_probe3.mjs
import { chromium } from 'playwright';

const V = '?v=fcc-ui-100';
const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 1200 );

const out = await page.evaluate( async ( { V } ) => {

	const TA = await import( './js/ui/TextAnim.js' + V );          // shim
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;

	const measure = ( time ) => {
		const r = TA.sampleTextAnim( anim, time, 4 );
		return {
			needsCharSplit: r.needsCharSplit,
			poses: r.charPoses ? r.charPoses.map( ( c ) => ( {
				y: +c.offsetY.toFixed( 3 ),
				s: +c.scaleY.toFixed( 3 ),
				o: +c.opacity.toFixed( 3 ),
			} ) ) : null,
			passOps: r.passOps.map( ( p ) => p.kind + ( p.progress != null ? ':' + p.progress.toFixed( 3 ) : '' ) ),
		};
	};

	// 1) charIn alone at 0.35 (mid entrance)
	const cIn = TT.createDefaultComponent( anim, 'charIn' );
	anim.components = [ cIn ];
	const onlyIn = measure( 0.35 );

	// 2) charIn finished + wave
	cIn.time.start = 0;
	cIn.time.duration = 0.01;
	const w = TT.createDefaultComponent( anim, 'wave' );
	anim.components = [ cIn, w ];
	const inPlusWave = measure( 0.6 );

	// 3) disable wave
	w.enabled = false;
	const waveOff = measure( 0.6 );

	// 4) re-enable + bigger amplitude (param key is 'amp')
	w.enabled = true;
	w.params.amp = 60;
	const waveBig = measure( 0.6 );

	// 5) text-scope wipe alone
	const wipe = TT.createDefaultComponent( anim, 'wipeReveal' );
	wipe.time.start = 0;
	wipe.time.duration = 1;
	anim.components = [ wipe ];
	const withWipe = measure( 0.25 );

	return { onlyIn, inPlusWave, waveOff, waveBig, withWipe };

}, { V } );

console.log( JSON.stringify( out, null, 2 ) );

const eq = ( a, b ) => JSON.stringify( a ) === JSON.stringify( b );
const maxAbsY = ( m ) => Math.max( ...m.poses.map( ( c ) => Math.abs( c.y ) ) );
const A = [];
A.push( [ 'charIn 产出逐字 pose（4 字）', out.onlyIn.needsCharSplit && out.onlyIn.poses.length === 4 ] );
A.push( [ 'charIn 入场中：opacity 未满或已位移', out.onlyIn.poses.some( ( c ) => c.o < 0.999 || Math.abs( c.y ) > 0.01 ) ] );
A.push( [ '叠加 wave 后 pose 与 wave 关闭时不同', ! eq( out.inPlusWave.poses, out.waveOff.poses ) ] );
A.push( [ 'wave 关闭时回到静止基态（y≈0, opacity=1）', maxAbsY( out.waveOff ) < 1e-6 && out.waveOff.poses.every( ( c ) => Math.abs( c.o - 1 ) < 1e-6 ) ] );
A.push( [ '振幅放大后 y 偏移显著增大', maxAbsY( out.waveBig ) > Math.abs( maxAbsY( out.inPlusWave ) ) ] );
A.push( [ '整文组件产出 passOp 且不需要拆字', out.withWipe.passOps.length > 0 && out.withWipe.needsCharSplit === false ] );
A.push( [ '扫光 passOp 进度落在 0~1', out.withWipe.passOps.every( ( s ) => { const v = parseFloat( s.split( ':' )[ 1 ] ); return ! Number.isFinite( v ) || ( v >= 0 && v <= 1 ); } ) ] );

let fails = 0;
for ( const [ name, ok ] of A ) { if ( ! ok ) fails ++; console.log( ( ok ? 'PASS  ' : 'FAIL  ' ) + name ); }
const bad = logs.filter( ( l ) => l.startsWith( 'PAGEERROR' ) || /TypeError|is not a function|DataCloneError/.test( l ) );
console.log( 'problems:', bad.slice( 0, 8 ) );
console.log( fails === 0 ? 'ALL PASS' : fails + ' FAILED' );
await browser.close();
