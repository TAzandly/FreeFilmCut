import { UIRow, UIButton, UIInteger, UINumber, UIText, UICheckbox } from '../libs/ui.js';
import { encodeGif } from './GifEncoder.js?v=fcc-ui-106';
import {
	capturePreviewFrame,
	clampPreviewSize,
	frameToPngBytes,
	bytesToDataUrl,
	disposePreviewCaptureSession,
} from './PreviewCapture.js?v=fcc-ui-232';
import { normalizeStickerMotion } from '../sticker-motion/StickerMotion.js?v=fcc-ui-106';
import { applyAllEditorAnims } from '../anim/FreeCapCutAnimCore.js?v=fcc-anim-20';
import { applyTextAnimsInScene } from '../ui/TextAnimRuntime.js?v=fcc-ui-212';
import { applyTextStickersInScene } from '../ui/TextStickers.js?v=fcc-ui-211';
import { applyTextGeomFxInScene } from '../ui/TextGeomFx.js?v=fcc-ui-146';

const MAX_GIF_FRAMES = 80;

function numKey( config, key, fallback ) {

	const value = Number( config.getKey( key ) );
	return Number.isFinite( value ) && value > 0 ? value : fallback;

}

function packType( editor ) {

	return editor.config && editor.config.getKey( 'project/vfxpack/type' );

}

function isStickerAnim( editor ) {

	return packType( editor ) === 'sticker-anim';

}

function isTextAnim( editor ) {

	return packType( editor ) === 'text-anim';

}

function stickerMotionState( editor ) {

	const motion = normalizeStickerMotion( editor.stickerMotion );
	const duration = Math.max( 0.1, Number( motion.duration ) || 0.5 );
	const time = Math.max( 0, Math.min( duration, Number( editor.stickerMotionTime ) || 0 ) );
	return { motion, duration, time };

}

/** Playhead + duration for text-anim packs (FreeFilmCut .anim / Text keys). */
function textAnimPreviewState( editor ) {

	const clip = editor.activeFreecapcutAnim;
	const duration = Math.max( 0.1, Number( clip && clip.duration ) || 0.5 );
	const raw = typeof editor.getAnimPreviewTime === 'function'
		? Number( editor.getAnimPreviewTime() )
		: 0;
	const time = Math.max( 0, Math.min( duration, Number.isFinite( raw ) ? raw : 0 ) );
	return { clip, duration, time };

}

function timelineState( editor ) {

	const api = editor.fccTimelineEditor;
	if ( ! api || typeof api.getExportState !== 'function' ) return null;
	return api.getExportState();

}

function remember( config, width, height, fps, maxKB, pingpong, speed ) {

	config.setKey(
		'project/previewExport/width', width,
		'project/previewExport/height', height,
		'project/previewExport/fps', fps,
		'project/previewExport/maxKB', maxKB,
		'project/previewExport/pingpong', !! pingpong,
		'project/previewExport/speed', speed
	);

}

function pingpongFrames( frames ) {

	if ( ! frames || frames.length < 3 ) return frames;
	const back = [];
	for ( let i = frames.length - 2; i >= 1; i -- ) back.push( frames[ i ] );
	return frames.concat( back );

}

function downloadBlob( blob, filename ) {

	const link = document.createElement( 'a' );
	link.href = URL.createObjectURL( blob );
	link.download = filename;
	link.click();
	setTimeout( () => URL.revokeObjectURL( link.href ), 2000 );

}

function yieldFrame() {

	return new Promise( ( resolve ) => setTimeout( resolve, 0 ) );

}

export function showPreviewExportDialog( editor ) {

	const strings = editor.strings;
	const config = editor.config;
	const t = ( key, fallback ) => ( strings && strings.getKey( key ) ) || fallback;

	const dom = document.createElement( 'div' );
	dom.className = 'Dialog';
	dom.style.zIndex = '10060';

	const background = document.createElement( 'div' );
	background.className = 'Dialog-background';
	dom.appendChild( background );

	const content = document.createElement( 'div' );
	content.className = 'Dialog-content';
	content.style.minWidth = '520px';
	dom.appendChild( content );

	const titleBar = document.createElement( 'div' );
	titleBar.className = 'Dialog-title';
	titleBar.textContent = t( 'preview/export/title', 'Export preview' );
	content.appendChild( titleBar );

	const body = document.createElement( 'div' );
	body.className = 'Dialog-body';
	content.appendChild( body );

	const sizeRow = new UIRow();
	body.appendChild( sizeRow.dom );
	sizeRow.add( new UIText( t( 'preview/export/size', 'Width × height' ) ).setClass( 'Label' ) );
	const widthInput = new UIInteger( numKey( config, 'project/previewExport/width', 256 ) ).setWidth( '56px' ).setRange( 16, 1280 );
	const heightInput = new UIInteger( numKey( config, 'project/previewExport/height', 256 ) ).setWidth( '56px' ).setRange( 16, 1280 );
	sizeRow.add( widthInput );
	sizeRow.add( new UIText( '×' ).setWidth( '16px' ).setTextAlign( 'center' ) );
	sizeRow.add( heightInput );

	const projectSize = new UIButton( t( 'preview/export/projectSize', 'Project aspect' ) );
	projectSize.onClick( () => {

		const resW = parseInt( config.getKey( 'project/resolution/width' ), 10 ) || 1920;
		const resH = parseInt( config.getKey( 'project/resolution/height' ), 10 ) || 1080;
		const scale = Math.min( 1, 512 / Math.max( resW, resH ) );
		widthInput.setValue( clampPreviewSize( Math.round( resW * scale ) ) );
		heightInput.setValue( clampPreviewSize( Math.round( resH * scale ) ) );

	} );
	sizeRow.add( projectSize );

	const fpsRow = new UIRow();
	body.appendChild( fpsRow.dom );
	fpsRow.add( new UIText( t( 'preview/export/fps', 'FPS' ) ).setClass( 'Label' ) );
	const fpsInput = new UIInteger( numKey( config, 'project/previewExport/fps', 10 ) ).setWidth( '56px' ).setRange( 1, 30 );
	fpsRow.add( fpsInput );
	fpsRow.add( new UIText( 'fps' ).setMarginLeft( '6px' ) );

	const speedRow = new UIRow();
	body.appendChild( speedRow.dom );
	speedRow.add( new UIText( t( 'preview/export/speed', 'Speed' ) ).setClass( 'Label' ) );
	const speedInput = new UINumber( numKey( config, 'project/previewExport/speed', 1 ) )
		.setWidth( '56px' )
		.setRange( 0.1, 4 )
		.setPrecision( 2 )
		.setStep( 0.1 )
		.setNudge( 0.1 );
	speedRow.add( speedInput );
	speedRow.add( new UIText( '×' ).setMarginLeft( '6px' ) );

	const kbRow = new UIRow();
	body.appendChild( kbRow.dom );
	kbRow.add( new UIText( t( 'preview/export/maxKB', 'File size' ) ).setClass( 'Label' ) );
	const kbInput = new UIInteger( numKey( config, 'project/previewExport/maxKB', 800 ) ).setWidth( '72px' ).setRange( 32, 8192 );
	kbRow.add( kbInput );
	kbRow.add( new UIText( 'KB' ).setMarginLeft( '6px' ) );

	const pingRow = new UIRow();
	body.appendChild( pingRow.dom );
	pingRow.add( new UIText( t( 'preview/export/pingpong', 'Ping-pong loop' ) ).setClass( 'Label' ) );
	const pingInput = new UICheckbox( config.getKey( 'project/previewExport/pingpong' ) === true );
	pingRow.add( pingInput );

	const hint = document.createElement( 'div' );
	hint.style.fontSize = '11px';
	hint.style.color = '#888';
	hint.style.margin = '8px 0';
	body.appendChild( hint );

	const status = document.createElement( 'div' );
	status.style.fontSize = '12px';
	status.style.minHeight = '16px';
	status.style.marginBottom = '8px';
	body.appendChild( status );

	function refreshHint() {

		if ( isStickerAnim( editor ) ) {

			const sticker = stickerMotionState( editor );
			hint.textContent = t( 'stickerMotion/title', 'Sticker animation' ) + ' · ' + sticker.duration.toFixed( 2 ) + 's · ' + t( 'preview/export/playhead', 'playhead' ) + ' ' + sticker.time.toFixed( 2 ) + 's';
			return;

		}

		if ( isTextAnim( editor ) ) {

			const textAnim = textAnimPreviewState( editor );
			hint.textContent = t( 'sidebar/project/vfxpack/type/text-anim', '文字动画' ) + ' · ' + textAnim.duration.toFixed( 2 ) + 's · ' + t( 'preview/export/playhead', 'playhead' ) + ' ' + textAnim.time.toFixed( 2 ) + 's';
			return;

		}

		const state = timelineState( editor );
		if ( ! state ) {

			hint.textContent = t( 'preview/export/needTimeline', 'Open a timeline to export a GIF. PNG saves the current view.' );
			return;

		}

		hint.textContent = ( state.name || 'Timeline' ) + ' · ' + state.duration.toFixed( 2 ) + 's · ' + t( 'preview/export/playhead', 'playhead' ) + ' ' + state.time.toFixed( 2 ) + 's';

	}

	refreshHint();

	const buttonsRow = document.createElement( 'div' );
	buttonsRow.className = 'Dialog-buttons';
	buttonsRow.style.flexWrap = 'wrap';
	buttonsRow.style.justifyContent = 'flex-start';
	buttonsRow.style.gap = '6px';
	body.appendChild( buttonsRow );

	let busy = false;

	function settings() {

		const width = clampPreviewSize( widthInput.getValue() );
		const height = clampPreviewSize( heightInput.getValue() );
		const fps = Math.max( 1, Math.min( 30, Math.round( fpsInput.getValue() || 10 ) ) );
		const maxKB = Math.max( 32, Math.min( 8192, Math.round( kbInput.getValue() || 800 ) ) );
		let speed = Number( speedInput.getValue() );
		if ( ! Number.isFinite( speed ) || speed <= 0 ) speed = 1;
		speed = Math.max( 0.1, Math.min( 4, speed ) );
		const pingpong = pingInput.getValue() === true;
		widthInput.setValue( width );
		heightInput.setValue( height );
		fpsInput.setValue( fps );
		kbInput.setValue( maxKB );
		speedInput.setValue( speed );
		remember( config, width, height, fps, maxKB, pingpong, speed );
		return { width, height, fps, maxKB, pingpong, speed };

	}

	function setBusy( next ) {

		busy = next;
		for ( const button of buttons ) button.setDisabled( next );

	}

	async function syncPlayheadForStill() {

		// PNG / cover must match the timeline playhead (what the viewport shows).
		if ( isStickerAnim( editor ) ) return;
		if ( isTextAnim( editor ) ) {

			poseTextAnimAt( textAnimPreviewState( editor ).time );
			return;

		}

		const api = editor.fccTimelineEditor;
		const state = timelineState( editor );
		if ( ! api || ! state || typeof api.sampleAt !== 'function' ) return;
		await withTimeout( api.sampleAt( state.time, { silent: true } ), 2000 );

	}

	async function captureCurrent() {

		const { width, height } = settings();
		await syncPlayheadForStill();
		await yieldFrame();
		const rgba = await capturePreviewFrame( editor, width, height );
		const blob = await frameToPngBytes( rgba, width, height );
		if ( ! blob ) throw new Error( 'png encode failed' );
		return { rgba, blob, width, height };

	}

	function withTimeout( promise, ms ) {

		return new Promise( ( resolve ) => {

			let done = false;
			const finish = ( value ) => {

				if ( done ) return;
				done = true;
				resolve( value );

			};
			Promise.resolve( promise ).then( finish, () => finish( false ) );
			setTimeout( () => finish( false ), ms );

		} );

	}

	async function syncStickerContent( time, motion ) {

		if ( ! motion || motion.playStickerTimeline === false ) return;
		const api = editor.fccTimelineEditor;
		if ( ! api || typeof api.scrubSceneTimeline !== 'function' ) return;
		try {

			await withTimeout( api.scrubSceneTimeline( time, { playing: false, silent: true, loop: true } ), 2000 );
			if ( typeof api.sampleAt !== 'function' || typeof api.getExportState !== 'function' ) return;
			const state = api.getExportState();
			if ( ! state ) return;
			const dur = Math.max( 0.01, state.duration );
			const wrapped = ( ( time % dur ) + dur ) % dur;
			await withTimeout( api.sampleAt( wrapped, { silent: true } ), 2000 );

		} catch ( error ) {

			console.warn( '[FreeFilmCut] sticker preview timeline', error );

		}

	}

	function poseTextAnimAt( time ) {

		if ( ! editor.scene ) return;
		applyAllEditorAnims( editor, editor.scene, time );
		applyTextAnimsInScene( editor.scene );
		applyTextStickersInScene( editor.scene, editor.materials );
		applyTextGeomFxInScene( editor.scene, {
			enabled: true,
			debug: !! editor.textAnimWipeDebug,
		} );
		if ( editor.signals && editor.signals.animationSampled ) {

			try { editor.signals.animationSampled.dispatch(); } catch ( e ) { /* ignore */ }

		}

	}

	async function captureGif() {

		const sticker = isStickerAnim( editor ) ? stickerMotionState( editor ) : null;
		const textAnim = ( ! sticker && isTextAnim( editor ) ) ? textAnimPreviewState( editor ) : null;
		const state = ( sticker || textAnim ) ? null : timelineState( editor );
		if ( ! sticker && ! textAnim && ( ! state || ! editor.fccTimelineEditor || typeof editor.fccTimelineEditor.sampleAt !== 'function' ) ) {

			throw new Error( t( 'preview/export/needTimeline', 'Open a timeline to export a GIF. PNG saves the current view.' ) );

		}

		const { width, height, fps, maxKB, pingpong, speed } = settings();
		const duration = sticker ? sticker.duration : ( textAnim ? textAnim.duration : state.duration );
		const home = sticker ? sticker.time : ( textAnim ? textAnim.time : state.time );
		const contentHome = sticker ? timelineState( editor ) : null;
		const prevAdvance = editor.advanceStickerMotion;
		if ( sticker ) editor.advanceStickerMotion = null;
		let frameCount = Math.max( 1, Math.round( duration * fps ) );
		if ( frameCount > MAX_GIF_FRAMES ) frameCount = MAX_GIF_FRAMES;
		const step = duration / frameCount;
		const delayCs = Math.max( 2, Math.round( ( step * 100 ) / speed ) );
			const frames = [];
			// Reuse one PP composer across GIF frames so custom/bokeh textures
			// are not stuck on the first-frame passthrough gate every time.
			const captureSession = {
				// CapCut SeekModeScript envelope over the timeline (满→无光斑).
				applyBokehEnvelope: ! sticker && ! textAnim,
			};
			try {

				for ( let i = 0; i < frameCount; i ++ ) {

					status.textContent = t( 'preview/export/working', 'Exporting' ) + ' ' + ( i + 1 ) + ' / ' + frameCount;
					const time = i * step;
					const progress = duration > 1e-6 ? Math.min( 1, time / duration ) : 0;
					captureSession.timelineProgress = progress;
					captureSession.effectTime = time;
					if ( sticker ) {

						await syncStickerContent( time, sticker.motion );
						editor.stickerMotionTime = time;

					} else if ( textAnim ) {

						poseTextAnimAt( time );

					} else {

						// Prefer scrubSceneTimeline — rebinds if the panel lost its object.
						const api = editor.fccTimelineEditor;
						if ( typeof api.scrubSceneTimeline === 'function' ) {

							await withTimeout( api.scrubSceneTimeline( time, { silent: true, playing: false } ), 2000 );

						} else {

							await api.sampleAt( time, { silent: true } );

						}

					}
					await yieldFrame();
					frames.push( new Uint8ClampedArray( await capturePreviewFrame( editor, width, height, captureSession ) ) );

				}

			} finally {

				disposePreviewCaptureSession( captureSession );

				if ( sticker ) {

				editor.stickerMotionTime = home;
				editor.advanceStickerMotion = prevAdvance;
				const api = editor.fccTimelineEditor;
				if ( sticker.motion.playStickerTimeline !== false && api ) {

					if ( contentHome && typeof api.sampleAt === 'function' ) await api.sampleAt( contentHome.time );
					else if ( typeof api.scrubSceneTimeline === 'function' ) {

						const pending = api.scrubSceneTimeline( home, { playing: false, silent: true, loop: true } );
						if ( pending && typeof pending.then === 'function' ) await pending;

					}

				}

			} else if ( textAnim ) {

				poseTextAnimAt( home );
				if ( typeof editor.refreshAnimPanel === 'function' ) {

					try { editor.refreshAnimPanel(); } catch ( e ) { /* ignore */ }

				}

			} else {

				await editor.fccTimelineEditor.sampleAt( home );

			}

		}

		status.textContent = t( 'preview/export/compress', 'Compressing' );
		await yieldFrame();
		const maxBytes = maxKB * 1024;
		const encoded = fitGif( {
			frames: pingpong ? pingpongFrames( frames ) : frames,
			width,
			height,
			delayCs,
			maxBytes,
		} );
		return { ...encoded, width, height, maxKB };

	}

	const pngButton = new UIButton( t( 'preview/export/png', 'Export PNG' ) );
	pngButton.onClick( async () => {

		if ( busy ) return;
		setBusy( true );
		status.textContent = t( 'preview/export/working', 'Exporting' );
		try {

			const shot = await captureCurrent();
			downloadBlob( shot.blob, 'preview-frame.png' );
			status.textContent = t( 'preview/export/saved', 'Saved' ) + ' preview-frame.png · ' + shot.width + '×' + shot.height;

		} catch ( error ) {

			console.warn( '[FreeFilmCut] png export', error );
			status.textContent = error && error.message ? error.message : String( error );

		}

		setBusy( false );
		refreshHint();

	} );

	const gifButton = new UIButton( t( 'preview/export/gif', 'Export GIF' ) );
	gifButton.onClick( async () => {

		if ( busy ) return;
		setBusy( true );
		try {

			const result = await captureGif();
			downloadBlob( new Blob( [ result.bytes ], { type: 'image/gif' } ), 'preview-hover.gif' );
			status.textContent = formatGifStatus( t, result );

		} catch ( error ) {

			console.warn( '[FreeFilmCut] gif export', error );
			const message = error && error.message ? error.message : String( error );
			status.textContent = message;
			alert( message );

		}

		setBusy( false );
		refreshHint();

	} );

	const posterButton = new UIButton( t( 'preview/export/asPoster', 'Use as poster' ) );
	posterButton.onClick( async () => {

		if ( busy ) return;
		setBusy( true );
		status.textContent = t( 'preview/export/working', 'Exporting' );
		try {

			const shot = await captureCurrent();
			const bytes = new Uint8Array( await shot.blob.arrayBuffer() );
			storePreview( editor, {
				configKey: 'project/vfxpack/previewPoster',
				nameKey: 'project/vfxpack/previewPosterName',
				bytes,
				mime: 'image/png',
				fileName: 'preview-frame.png',
			} );
			status.textContent = t( 'preview/export/asPoster', 'Use as poster' ) + ' · ' + Math.ceil( bytes.length / 1024 ) + ' KB';

		} catch ( error ) {

			console.warn( '[FreeFilmCut] poster export', error );
			status.textContent = error && error.message ? error.message : String( error );

		}

		setBusy( false );

	} );

	const hoverButton = new UIButton( t( 'preview/export/asHover', 'Use as hover GIF' ) );
	hoverButton.onClick( async () => {

		if ( busy ) return;
		setBusy( true );
		status.textContent = t( 'preview/export/working', 'Exporting' );
		try {

			const result = await captureGif();
			storePreview( editor, {
				configKey: 'project/vfxpack/previewHover',
				nameKey: 'project/vfxpack/previewHoverName',
				bytes: result.bytes,
				mime: 'image/gif',
				fileName: 'preview-hover.gif',
			} );
			status.textContent = t( 'preview/export/asHover', 'Use as hover GIF' ) + ' · ' + formatGifStatus( t, result );

		} catch ( error ) {

			console.warn( '[FreeFilmCut] hover export', error );
			const message = error && error.message ? error.message : String( error );
			status.textContent = message;
			alert( message );

		}

		setBusy( false );
		refreshHint();

	} );

	const cancelButton = new UIButton( t( 'menubar/render/cancel', 'Cancel' ) );
	cancelButton.onClick( () => {

		if ( busy ) return;
		dom.remove();

	} );

	const buttons = [ pngButton, gifButton, posterButton, hoverButton, cancelButton ];
	for ( const button of buttons ) buttonsRow.appendChild( button.dom );

	background.addEventListener( 'click', () => {

		if ( ! busy ) dom.remove();

	} );

	document.body.appendChild( dom );

}

function storePreview( editor, { configKey, nameKey, bytes, mime, fileName } ) {

	const dataUrl = bytesToDataUrl( bytes, mime );
	try {

		editor.config.setKey( configKey, dataUrl, nameKey, fileName );

	} catch ( error ) {

		const message = ( editor.strings && editor.strings.getKey( 'sidebar/project/vfxpack/previewTooLarge' ) )
			|| 'Could not store that preview. Use a smaller file.';
		throw new Error( message );

	}

	if ( editor.signals && editor.signals.vfxpackChanged ) editor.signals.vfxpackChanged.dispatch();

}

function fitGif( { frames, width, height, delayCs, maxBytes } ) {

	const counts = [ 256, 128, 64, 32 ];
	let best = null;
	let source = frames;
	let delay = delayCs;
	for ( let stride = 1; stride <= 4; stride ++ ) {

		if ( stride > 1 ) {

			source = frames.filter( ( _, index ) => index % stride === 0 );
			delay = delayCs * stride;
			if ( source.length < 1 ) break;

		}

		for ( let c = 0; c < counts.length; c ++ ) {

			const bytes = encodeGif( {
				width,
				height,
				frames: source,
				delayCs: delay,
				maxColors: counts[ c ],
			} );
			const info = {
				bytes,
				colors: counts[ c ],
				frameCount: source.length,
				delayCs: delay,
				over: bytes.length > maxBytes,
			};
			if ( ! best || bytes.length < best.bytes.length ) best = info;
			if ( bytes.length <= maxBytes ) return info;

		}

		if ( source.length <= 4 ) break;

	}

	return best;

}

function formatGifStatus( t, result ) {

	const kb = Math.max( 1, Math.ceil( result.bytes.length / 1024 ) );
	const base = kb + ' KB · ' + result.frameCount + 'f · ' + result.colors + ' colors';
	if ( ! result.over ) return t( 'preview/export/saved', 'Saved' ) + ' ' + base;
	return base + ' · ' + t( 'preview/export/oversize', 'still above the size limit' );

}
