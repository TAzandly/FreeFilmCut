// Pixel-level truth: sample the drawing buffer right after the editor renders.
// Numeric only — no image files.
// node _tanim_check/wipe_pix.mjs
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

const setup = await page.evaluate( async ( { V } ) => {

	const ed = window.editor;
	const UIF = await import( './js/ui/UIFactory.js' + V );
	const { AddObjectCommand } = await import( './js/commands/AddObjectCommand.js' );
	const { MoveObjectCommand } = await import( './js/commands/MoveObjectCommand.js' );
	const UITextMod = await import( './js/ui/UIText.js' + V );
	const TT = await import( './js/textanim/TextAnimTypes.js?v=fcc-tanim-1' );

	let canvas = UIF.findCanvasParent( ed );
	if ( ! canvas ) { canvas = UIF.createUICanvas(); ed.execute( new AddObjectCommand( ed, canvas ) ); }
	const t = UIF.createUIText( 'PixProbe' );
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
	await new Promise( ( r ) => setTimeout( r, 1200 ) );

	window.__wipe = w;
	window.__anim = anim;

	// locate the renderer canvas + its gl context
	const cands = Array.from( document.querySelectorAll( 'canvas' ) );
	let glc = null;
	for ( const c of cands ) {

		const gl = c.getContext ? ( c.getContext( 'webgl2' ) || c.getContext( 'webgl' ) ) : null;
		if ( gl && c.width >= 640 ) { glc = { canvas: c, gl }; break; }

	}
	if ( ! glc ) return { error: 'no webgl canvas', sizes: cands.map( ( c ) => c.width + 'x' + c.height ) };
	window.__gl = glc.gl;
	window.__glc = glc.canvas;
	return { canvas: glc.canvas.width + 'x' + glc.canvas.height, attr: glc.gl.getContextAttributes() };

}, { V } );

console.log( 'canvas:', JSON.stringify( setup ) );

async function sample( label, time, enabled ) {

	const r = await page.evaluate( async ( { time, enabled } ) => {

		const ed = window.editor;
		window.__wipe.enabled = enabled;
		ed.textAnimTime = time;
		ed.signals.sceneGraphChanged.dispatch();
		await new Promise( ( res ) => requestAnimationFrame( () => requestAnimationFrame( () => requestAnimationFrame( res ) ) ) );

		const gl = window.__gl;
		const w = gl.drawingBufferWidth;
		const h = gl.drawingBufferHeight;
		const buf = new Uint8Array( w * h * 4 );
		gl.readPixels( 0, 0, w, h, gl.RGBA, gl.UNSIGNED_BYTE, buf );

		// brightness histogram + horizontal extent of bright pixels
		let total = 0;
		let bright = 0;
		let minX = w, maxX = - 1, minY = h, maxY = - 1;
		const cols = new Array( 16 ).fill( 0 );
		for ( let y = 0; y < h; y += 2 ) {

			for ( let x = 0; x < w; x += 2 ) {

				const i = ( y * w + x ) * 4;
				const lum = buf[ i ] + buf[ i + 1 ] + buf[ i + 2 ];
				total ++;
				if ( lum < 180 ) continue;          // background is dark grey
				bright ++;
				if ( x < minX ) minX = x;
				if ( x > maxX ) maxX = x;
				if ( y < minY ) minY = y;
				if ( y > maxY ) maxY = y;
				cols[ Math.min( 15, Math.floor( x / w * 16 ) ) ] ++;

			}

		}
		return {
			w, h,
			brightPx: bright,
			brightFrac: +( bright / Math.max( 1, total ) ).toFixed( 4 ),
			xSpan: maxX >= minX ? [ minX, maxX ] : null,
			ySpan: maxY >= minY ? [ minY, maxY ] : null,
			cols16: cols,
		};

	}, { time, enabled } );

	console.log( label.padEnd( 22 ), JSON.stringify( r ) );
	return r;

}

const off = await sample( 'wipe OFF  t=0.5', 0.5, false );
const t0 = await sample( 'wipe ON   t=0', 0, true );
const t25 = await sample( 'wipe ON   t=0.25', 0.25, true );
const t50 = await sample( 'wipe ON   t=0.5', 0.5, true );
const t75 = await sample( 'wipe ON   t=0.75', 0.75, true );
const t1 = await sample( 'wipe ON   t=1', 1, true );

console.log( '\n--- verdict ---' );
const changed = ( a, b ) => Math.abs( a.brightPx - b.brightPx ) > 50 || JSON.stringify( a.cols16 ) !== JSON.stringify( b.cols16 );
console.log( 'wipe 是否改变画面 (t0 vs off):', changed( off, t0 ) );
console.log( 'wipe 是否改变画面 (t1 vs off):', changed( off, t1 ) );
console.log( 't0 应近乎全隐:', t0.brightPx < off.brightPx * 0.15 );
console.log( '亮度随 progress 单调上升:', t0.brightPx <= t25.brightPx && t25.brightPx <= t50.brightPx && t50.brightPx <= t75.brightPx && t75.brightPx <= t1.brightPx );
console.log( 't1 与 off 接近:', Math.abs( t1.brightPx - off.brightPx ) < Math.max( 200, off.brightPx * 0.1 ) );
console.log( 'problems:', logs.filter( ( l ) => /PAGEERROR|TypeError/.test( l ) ).slice( 0, 5 ) );
await browser.close();
