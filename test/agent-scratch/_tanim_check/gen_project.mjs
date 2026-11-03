// Generate a clean "sweep works" editor project via the editor's own APIs.
// No hand-written scene JSON. node _tanim_check/gen_project.mjs
import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';

const UI = '?v=fcc-ui-101';
const TA = '?v=fcc-tanim-4';

const browser = await chromium.launch( { args: [ '--use-angle=swiftshader', '--enable-unsafe-swiftshader' ] } );
const page = await browser.newPage( { viewport: { width: 1400, height: 900 } } );
const logs = [];
page.on( 'console', ( m ) => logs.push( m.type() + ': ' + m.text() ) );
page.on( 'pageerror', ( e ) => logs.push( 'PAGEERROR: ' + e.message ) );
page.on( 'dialog', ( d ) => { console.log( '[dialog]', d.type(), d.message().slice( 0, 80 ) ); d.dismiss(); } );

console.log( 'goto...' );

await page.goto( 'http://localhost:5174/editor/', { waitUntil: 'load' } );
await page.waitForFunction( () => !! window.editor, null, { timeout: 60000 } );
await page.waitForTimeout( 1000 );
console.log( 'editor ready' );

console.log( 'evaluate start' );
const result = await page.evaluate( async ( { UI, TA } ) => {

	const THREE = await import( 'three' );
	const UF = await import( './js/ui/UIFactory.js' + UI );
	const UC = await import( './js/ui/UIConstants.js' + UI );
	const UT = await import( './js/ui/UIText.js' + UI );
	const TT = await import( './js/textanim/TextAnimTypes.js' + TA );

	const ed = window.editor;
	const FCC = UC.FCC_UI_KEY;

	// ---- empty scene, dark bg ----------------------------------------
	ed.clear();
	// Background must go through the editor signal, otherwise the sidebar's
	// default overwrites scene.background before toJSON().
	ed.signals.sceneBackgroundChanged.dispatch( 'Color', 0x0b0e14, null, null, 'srgb', 0, 1, 0 );
	ed.backgroundType = 'Color';

	// ---- canvas ------------------------------------------------------
	const canvas = UF.createUICanvas();
	canvas.name = 'Canvas';
	ed.scene.add( canvas );

	// ---- sweep text --------------------------------------------------
	const text = UF.createUIText( '扫光标题' );
	const ui = text.userData[ FCC ];
	ui.text = '扫光 SWEEP';
	ui.fontSize = 120;
	ui.color = '#ffffff';
	ui.letterSpacing = 0.02;
	ui.sizeDelta = [ 1200, 240 ];
	ui.anchoredPosition = [ 0, 40 ];
	UT.syncUITextContent( text, { x: 0, y: 0, w: 1200, h: 240 } );
	canvas.add( text );

	const anim = TT.createDefaultTextAnim();
	anim.enabled = true;
	const wipe = TT.createDefaultComponent( anim, 'wipeReveal' );
	wipe.time = { start: 0, duration: 1.6, loop: 'clamp', timeScale: 1 };
	wipe.params.direction = 'ltr';
	wipe.params.soft = 0.09;
	wipe.params.edgeIntensity = 3.2;
	wipe.params.edgeWidth = 0.035;
	wipe.params.invert = false;
	anim.components = [ wipe ];
	ui.textAnim = anim;

	// ---- project meta ------------------------------------------------
	ed.config.setKey( 'project/title', '扫光-正确场景' );
	ed.config.setKey( 'project/resolution/width', 1920 );
	ed.config.setKey( 'project/resolution/height', 1080 );
	ed.textAnimTime = 0.9; // mid sweep -> blade visible on open

	const json = ed.toJSON();
	json.project.title = '扫光-正确场景';
	json.project.name = '扫光-正确场景';
	json.metadata.title = '扫光-正确场景';

	return {
		json: JSON.stringify( json ),
		probe: {
			textAnimTime: ed.textAnimTime,
			compTypes: anim.components.map( ( c ) => c.type ),
			suppress: anim.components.map( ( c ) => c.suppressCharPose === true ),
			channels: anim.components.map( ( c ) => c.channels ),
			params: anim.components[ 0 ].params,
			textCount: canvas.children.length,
		// NOTE: one text only — the wipe RT is the whole overlay layer, so a second
		// text on the same canvas would be swept too (known limitation).
		},
	};

}, { UI, TA } );

console.log( 'evaluate done', result.probe ? 'has-probe' : 'no-probe' );
// GPU process can wedge on close after a wipe pass; never let it block the file write.
await Promise.race( [ browser.close().catch( () => {} ), new Promise( ( r ) => setTimeout( r, 4000 ) ) ] );
console.log( 'browser closed' );

const outDir = path.resolve( 'projects/sweep-demo' );
const assetDirs = [ 'shaders', 'textures', 'videos', 'sequences', 'animations', 'timelines', 'meshes', 'fonts', 'audio' ];
fs.mkdirSync( outDir, { recursive: true } );
for ( const d of assetDirs ) fs.mkdirSync( path.join( outDir, 'assets', d ), { recursive: true } );
fs.mkdirSync( path.join( outDir, 'exports' ), { recursive: true } );
fs.mkdirSync( path.join( outDir, 'docs' ), { recursive: true } );

const json = JSON.parse( result.json );
fs.writeFileSync( path.join( outDir, 'project.json' ), JSON.stringify( json, null, '\t' ), 'utf8' );

console.log( 'GENERATED', path.join( outDir, 'project.json' ) );
console.log( 'probe', JSON.stringify( result.probe, null, 2 ) );
console.log( 'bytes', fs.statSync( path.join( outDir, 'project.json' ) ).size );
console.log( 'errors', logs.filter( ( l ) => /PAGEERROR|error:/i.test( l ) ) );
