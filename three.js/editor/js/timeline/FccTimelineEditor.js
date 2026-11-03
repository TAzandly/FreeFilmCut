/**
 * FreeFilmCut Timeline editor — floating window with clip lanes (drag move / edge resize).
 * Play / pause / stop / scrub; calls sampleTimeline from FccTimelineCore.
 */
import { UIPanel, UINumber } from '../libs/ui.js';
import { sampleTimeline, TL_KEY, isFccTimeline, snapTimeToFrame } from './FccTimelineCore.js?v=fcc-ui-107';
import { loadTimelineAsset, saveTimelineAsset } from './FccTimelineIO.js?v=fcc-ui-138';
import { resumeAndRouteVideos } from '../media/FccAudio.js?v=fcc-ui-106';
import { seekVideoPlayer, getMediaDurationSec } from '../media/FccVideo.js?v=fcc-ui-207';

/** Scrub / hard sync: ~1 frame. Free-run play: only correct large drift (avoids choppy seeks). */
/** Drive MediaFramePlayer — see FccVideo.seekVideoPlayer. */

function buildAnimByName( editor ) {

	const map = new Map();
	for ( const a of editor.freecapcutAnims || [] ) {

		if ( a && a.name ) map.set( a.name, a );

	}
	if ( editor.activeFreecapcutAnim && editor.activeFreecapcutAnim.name ) {

		map.set( editor.activeFreecapcutAnim.name, editor.activeFreecapcutAnim );

	}
	return map;

}

function FccTimelineEditor( editor ) {

	const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
	const isZh = lang === 'zh';
	const T = ( zh, en ) => ( isZh ? zh : en );

		const WIN_W = 720;
		const WIN_H = 400;
		const LABEL_W = 140;
		const RULER_H = 26;
		const LANE_H = 28;
		const CLIP_EDGE = 6;

		let object = null;
		let asset = null;
		let playing = false;
		let playTime = 0;
		let panelVisible = false;
		let isDraggingWin = false;
		let isScrubbing = false;
		let dragOffX = 0;
		let dragOffY = 0;
		let openToken = 0;
		let selectedTrackId = '';
		/** @type {{ mode: string, clip: object, el: HTMLElement, startNum: object, durNum: object, laneEl: HTMLElement, originStart: number, originDur: number, originClientX: number, endFixed: number }|null} */
		let clipDrag = null;
		/** @type {{ laneEl: HTMLElement, blocks: { el: HTMLElement, clip: object, startNum: object, durNum: object }[] }[]} */
		let clipLaneRefs = [];

	// ---- Window ----
	const container = new UIPanel();
	container.setId( 'fcc-timeline' );
	container.setClass( 'animation-window' );
	const root = container.dom;
	root.style.cssText = [
		'display:none',
		'position:fixed',
		'left:120px',
		'top:120px',
		'width:' + WIN_W + 'px',
		'height:' + WIN_H + 'px',
		'z-index:10051',
		'flex-direction:column',
		'background:#1e1e1e',
		'border:1px solid #555',
		'border-radius:6px',
		'box-shadow:0 8px 28px rgba(0,0,0,0.55)',
		'overflow:hidden',
		'color:#ddd',
		'font-size:12px',
	].join( ';' );

	// ---- Title bar ----
	const titleBar = document.createElement( 'div' );
	titleBar.className = 'animation-titlebar';
	titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#2a2a2a;border-bottom:1px solid #444;cursor:move;user-select:none;flex-shrink:0;';
	root.appendChild( titleBar );

	const titleText = document.createElement( 'div' );
	titleText.style.cssText = 'font-weight:600;color:#eee;';
	titleBar.appendChild( titleText );

	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.textContent = '\u00d7';
	closeBtn.title = T( '\u5173\u95ed', 'Close' );
	closeBtn.style.cssText = 'width:24px;height:24px;border:none;background:transparent;color:#ccc;font-size:18px;line-height:1;cursor:pointer;border-radius:4px;';
	closeBtn.addEventListener( 'mouseenter', () => { closeBtn.style.background = '#c44'; closeBtn.style.color = '#fff'; } );
	closeBtn.addEventListener( 'mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#ccc'; } );
	closeBtn.addEventListener( 'click', ( e ) => { e.stopPropagation(); setPanelVisible( false ); } );
	titleBar.appendChild( closeBtn );

	titleBar.addEventListener( 'mousedown', function ( e ) {

		if ( e.button !== 0 || e.target === closeBtn ) return;
		isDraggingWin = true;
		const r = root.getBoundingClientRect();
		dragOffX = e.clientX - r.left;
		dragOffY = e.clientY - r.top;
		e.preventDefault();

	} );

	// ---- Controls ----
	const controls = document.createElement( 'div' );
	controls.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #333;flex-shrink:0;background:#222;';
	root.appendChild( controls );

	function makeBtn( label, title, onClick ) {

		const b = document.createElement( 'button' );
		b.type = 'button';
		b.textContent = label;
		b.title = title || label;
		b.style.cssText = 'padding:3px 10px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:12px;';
		b.addEventListener( 'click', onClick );
		controls.appendChild( b );
		return b;

	}

	const playBtn = makeBtn( T( '\u64ad\u653e', 'Play' ), '', () => play() );
	const pauseBtn = makeBtn( T( '\u6682\u505c', 'Pause' ), '', () => pause() );
	const stopBtn = makeBtn( T( '\u505c\u6b62', 'Stop' ), '', () => stop() );

	const timeText = document.createElement( 'span' );
	timeText.style.cssText = 'color:#ffeb3b;font-weight:600;min-width:150px;font-variant-numeric:tabular-nums;margin-left:8px;';
	controls.appendChild( timeText );

	const endLabel = document.createElement( 'span' );
	endLabel.textContent = T( '\u7ed3\u675f', 'End' );
	endLabel.style.cssText = 'margin-left:10px;color:#aaa;';
	controls.appendChild( endLabel );

	const endNum = new UINumber( 1 ).setWidth( '56px' ).setRange( 0.01, 100000 ).setPrecision( 2 ).setStep( 0.1 );
	controls.appendChild( endNum.dom );

	const fpsLabel = document.createElement( 'span' );
	fpsLabel.textContent = 'FPS';
	fpsLabel.style.cssText = 'margin-left:6px;color:#aaa;';
	controls.appendChild( fpsLabel );

	const fpsSelect = document.createElement( 'select' );
	fpsSelect.style.cssText = 'background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;';
	for ( const f of [ '24', '25', '30' ] ) {

		const o = document.createElement( 'option' );
		o.value = f;
		o.textContent = f;
		fpsSelect.appendChild( o );

	}
	controls.appendChild( fpsSelect );

	function applyDurationFpsFromUI() {

		if ( ! object || ! asset ) return;
		asset.duration = Math.max( 0.01, endNum.getValue() );
		asset.fps = parseInt( fpsSelect.value, 10 ) || 30;
		const ud = object.userData[ TL_KEY ];
		if ( ud ) {

			ud.duration = asset.duration;
			ud.fps = asset.fps;

		}
		const dur = asset.duration;
		if ( playTime > dur ) playTime = dur;
		object.__fccTimelineAsset = asset;
		if ( editor.timelinePreviewOwnsAnim ) applySample();
		updateUI();
		relayoutClipLanes();
		if ( editor.signals && editor.signals.objectChanged ) editor.signals.objectChanged.dispatch( object );

	}

	endNum.onChange( applyDurationFpsFromUI );
	fpsSelect.addEventListener( 'change', applyDurationFpsFromUI );

	const spacer = document.createElement( 'span' );
	spacer.style.flex = '1';
	controls.appendChild( spacer );

	makeBtn( T( '\u6dfb\u52a0\u52a8\u753b\u8f68', 'Add Animation Track' ), '', () => addAnimationTrack() );
	makeBtn( T( '\u6dfb\u52a0\u89c6\u9891\u8f68', 'Add Video Track' ), '', () => addVideoTrack() );
	makeBtn( T( '\u6dfb\u52a0\u6fc0\u6d3b\u8f68', 'Add Activation Track' ), '', () => addActivationTrack() );
	makeBtn( T( '\u6dfb\u52a0\u7247\u6bb5', 'Add Clip' ), T( '\u6dfb\u52a0\u5230\u9009\u4e2d\u7684\u8f68\u9053', 'Add to the selected track' ), () => onAddClip() );

	makeBtn( T( '\u4fdd\u5b58', 'Save' ), '', () => { save(); } );

	// ---- Clip picker (inline, shown by Add Clip) ----
	const picker = document.createElement( 'div' );
	picker.style.cssText = 'display:none;align-items:center;gap:6px;padding:5px 10px;border-bottom:1px solid #333;flex-shrink:0;background:#262626;';
	root.appendChild( picker );

	const pickerLabel = document.createElement( 'span' );
	pickerLabel.textContent = T( '\u9009\u62e9\u52a8\u753b', 'Animation' ) + ':';
	picker.appendChild( pickerLabel );

	const pickerSelect = document.createElement( 'select' );
	pickerSelect.style.cssText = 'flex:1;min-width:0;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;font-size:12px;';
	picker.appendChild( pickerSelect );

	function makePickerBtn( label, onClick ) {

		const b = document.createElement( 'button' );
		b.type = 'button';
		b.textContent = label;
		b.style.cssText = 'padding:3px 10px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;cursor:pointer;font-size:12px;';
		b.addEventListener( 'click', onClick );
		picker.appendChild( b );
		return b;

	}

	makePickerBtn( 'OK', () => confirmClipPicker() );
	makePickerBtn( T( '\u53d6\u6d88', 'Cancel' ), () => { picker.style.display = 'none'; } );

	// ---- Ruler ----
	const rulerRow = document.createElement( 'div' );
	rulerRow.style.cssText = 'display:flex;height:' + RULER_H + 'px;flex-shrink:0;border-bottom:1px solid #333;background:#1f1f1f;';
	root.appendChild( rulerRow );

	const rulerLabel = document.createElement( 'div' );
	rulerLabel.textContent = T( '\u65f6\u95f4', 'Time' );
	rulerLabel.style.cssText = 'width:' + LABEL_W + 'px;flex-shrink:0;padding:0 8px;font-size:10px;color:#888;display:flex;align-items:center;box-sizing:border-box;';
	rulerRow.appendChild( rulerLabel );

	const rulerHost = document.createElement( 'div' );
	rulerHost.style.cssText = 'flex:1;position:relative;height:100%;overflow:hidden;cursor:col-resize;';
	rulerRow.appendChild( rulerHost );

	const rulerCanvas = document.createElement( 'canvas' );
	rulerCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;';
	rulerHost.appendChild( rulerCanvas );

	const playhead = document.createElement( 'div' );
	playhead.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#f44;left:0;pointer-events:none;z-index:2;';
	rulerHost.appendChild( playhead );

	// ---- Track list (empty in Phase A) ----
	const trackList = document.createElement( 'div' );
	trackList.style.cssText = 'flex:1;overflow-y:auto;background:#1a1a1a;min-height:0;';
	root.appendChild( trackList );

	function timeFromEvent( e ) {

		const rect = rulerHost.getBoundingClientRect();
		const w = Math.max( 1, rect.width );
		const dur = asset ? Math.max( 0.01, Number( asset.duration ) || 0.01 ) : 1;
		const x = Math.max( 0, Math.min( w, e.clientX - rect.left ) );
		return ( x / w ) * dur;

	}

	rulerHost.addEventListener( 'mousedown', function ( e ) {

		if ( e.button !== 0 || ! asset ) return;
		isScrubbing = true;
		playing = false;
		scrubTo( timeFromEvent( e ) );
		e.preventDefault();

	} );

		document.addEventListener( 'mousemove', function ( e ) {

			if ( isDraggingWin ) {

				root.style.left = Math.max( 0, Math.min( window.innerWidth - 80, e.clientX - dragOffX ) ) + 'px';
				root.style.top = Math.max( 0, Math.min( window.innerHeight - 40, e.clientY - dragOffY ) ) + 'px';

			} else if ( clipDrag ) {

				applyClipDragMove( e );

			} else if ( isScrubbing ) {

				scrubTo( timeFromEvent( e ) );

			}

		} );

		document.addEventListener( 'mouseup', function () {

			if ( clipDrag ) {

				const el = clipDrag.el;
				el.style.cursor = 'grab';
				clipDrag = null;
				commitAssetEdit( true );
				relayoutClipLanes();

			}
			isDraggingWin = false;
			isScrubbing = false;

		} );

	// ---- State helpers ----
	function syncFromUD() {

		if ( ! object || ! asset ) return;
		const ud = object.userData[ TL_KEY ];
		if ( ! ud ) return;
		if ( ! asset.tracks || asset.tracks.length === 0 ) {

			if ( Number( ud.duration ) > 0 ) asset.duration = Number( ud.duration );
			if ( Number( ud.fps ) > 0 ) asset.fps = Number( ud.fps );
			if ( ud.loop === 'loop' || ud.loop === 'clamp' ) asset.loop = ud.loop;

		}

	}

	function ensureSnapshot() {

		if ( editor._fccTimelineVisibilitySnap ) return;
		const snap = new Map();
		editor.scene.traverse( ( o ) => { snap.set( o.uuid, o.visible ); } );
		editor._fccTimelineVisibilitySnap = snap;
		editor._fccTimelineActivationBound = new Set();

	}

	function restoreVisibility() {

		const snap = editor._fccTimelineVisibilitySnap;
		if ( snap ) {

			editor.scene.traverse( ( o ) => {

				if ( snap.has( o.uuid ) ) o.visible = snap.get( o.uuid );

			} );

		}
		editor._fccTimelineVisibilitySnap = null;
		editor._fccTimelineActivationBound = null;

	}

	function pauseAllTimelineVideos() {

		if ( ! asset || ! editor.scene ) return;
		for ( const track of asset.tracks || [] ) {

			if ( track.type !== 'video' ) continue;
			const uuid = track.bindingUuid || track.videoPlayerUuid;
			if ( ! uuid ) continue;
			const obj = editor.scene.getObjectByProperty( 'uuid', uuid );
			seekVideoPlayer( obj, null, { playing: false } );

		}

	}

	function applySample( opts ) {

		opts = opts || {};
		if ( ! object || ! asset || ! object.parent ) return;
		syncFromUD();
		ensureSnapshot();
		editor.timelinePreviewOwnsAnim = true;
		sampleTimeline( {
			scene: editor.scene,
			asset,
			t: playTime,
			animByName: buildAnimByName( editor ),
			seekVideoPlayer,
			activationBoundUuids: editor._fccTimelineActivationBound || null,
			timelinePlaying: opts.playing === true || playing,
		} );
		// Avoid per-frame sceneGraphChanged / audio re-route while playing (causes hitch + audio glitches).
		if ( ! opts.silent && ! playing && editor.signals && editor.signals.sceneGraphChanged ) {

			editor.signals.sceneGraphChanged.dispatch();

		}

	}

	function scrubTo( t, opts ) {

		opts = opts || {};
		if ( ! asset ) return;
		const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
		playTime = Math.max( 0, Math.min( dur, snapTimeToFrame( t, asset.fps ) ) );
		applySample( opts );
		if ( panelVisible || ! opts.silent ) updateUI();

	}

	let timelineLoad = null;
	let pendingSceneScrub = null;

	function findTimelineObject() {

		const active = editor.activeFccTimeline;
		if ( active && active.parent && isFccTimeline( active ) ) return active;
		let first = null;
		let marked = null;
		if ( ! editor.scene ) return null;
		editor.scene.traverse( ( o ) => {

			if ( ! isFccTimeline( o ) ) return;
			if ( ! first ) first = o;
			if ( o.userData[ TL_KEY ] && o.userData[ TL_KEY ].active ) marked = o;

		} );
		return marked || first;

	}

	function bindTimelineObject( obj, loaded ) {

		object = obj;
		asset = loaded;
		obj.__fccTimelineAsset = asset;
		editor.activeFccTimeline = obj;

	}

	function applyPendingSceneScrub() {

		if ( ! pendingSceneScrub || ! asset ) return;
		const opts = pendingSceneScrub.opts || {};
		let t = Number( pendingSceneScrub.t ) || 0;
		if ( opts.loop ) {

			const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
			t = ( ( t % dur ) + dur ) % dur;

		}
		scrubTo( t, opts );

	}

	/** Sample the sticker project's timeline without opening this window. */
	function scrubSceneTimeline( t, opts ) {

		pendingSceneScrub = { t, opts: opts || {} };
		if ( object && asset && object.parent ) {

			applyPendingSceneScrub();
			return Promise.resolve( true );

		}
		const obj = findTimelineObject();
		if ( ! obj ) return Promise.resolve( false );
		if ( obj.__fccTimelineAsset ) {

			bindTimelineObject( obj, obj.__fccTimelineAsset );
			applyPendingSceneScrub();
			return Promise.resolve( true );

		}
		if ( ! timelineLoad ) {

			const target = obj;
			timelineLoad = loadTimelineAsset( editor, target ).then( ( loaded ) => {

				timelineLoad = null;
				if ( ! target.parent ) return false;
				bindTimelineObject( target, loaded );
				applyPendingSceneScrub();
				return true;

			} ).catch( () => {

				timelineLoad = null;
				return false;

			} );

		}
		return timelineLoad;

	}

	function play() {

		if ( ! object || ! asset ) return;
		syncFromUD();
		ensureSnapshot();
		editor.timelinePreviewOwnsAnim = true;
		const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
		if ( playTime >= dur && asset.loop !== 'loop' ) playTime = 0;
		playing = true;
		// Hard-sync videos once, then free-run; route audio once for this play session.
		for ( const track of asset.tracks || [] ) {

			if ( track.type !== 'video' ) continue;
			const uuid = track.bindingUuid || track.videoPlayerUuid;
			if ( ! uuid ) continue;
			const vpObj = editor.scene.getObjectByProperty( 'uuid', uuid );
			if ( vpObj ) vpObj.__fccTlVideoClipKey = '';

		}
		resumeAndRouteVideos( editor );
		applySample();
		updateUI();

	}

	function pause() {

		playing = false;
		pauseAllTimelineVideos();
		updateUI();

	}

	function stop() {

		playing = false;
		pauseAllTimelineVideos();
		playTime = 0;
		editor.timelinePreviewOwnsAnim = false;
		restoreVisibility(); // no re-sample: restored visibility must stick
		if ( editor.signals && editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();
		updateUI();

	}

	async function save() {

		if ( ! object || ! asset ) return;
		applyDurationFpsFromUI();
		const pf = editor.projectFolder;
		if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) {

			console.warn( '[FreeFilmCut] Timeline save skipped: no project folder bound' );
			return;

		}
		try {

			await saveTimelineAsset( editor, object, asset );

		} catch ( e ) {

			console.warn( '[FreeFilmCut] Timeline save failed', e );

		}

	}

	function sampleIfPlaying( delta ) {

		if ( ! playing || ! asset || ! object ) return;
		const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
		playTime += Number( delta ) || 0;
		if ( asset.loop === 'loop' ) {

			playTime = ( ( playTime % dur ) + dur ) % dur;

		} else if ( playTime >= dur ) {

			playTime = dur;
			playing = false;

		}
		applySample();
		updateUI();

	}

	// ---- UI refresh ----
	function drawRuler() {

		const rect = rulerHost.getBoundingClientRect();
		const w = Math.max( 1, Math.floor( rect.width ) );
		const h = RULER_H;
		if ( rulerCanvas.width !== w ) rulerCanvas.width = w;
		if ( rulerCanvas.height !== h ) rulerCanvas.height = h;
		const ctx = rulerCanvas.getContext( '2d' );
		ctx.clearRect( 0, 0, w, h );
		const dur = asset ? Math.max( 0.01, Number( asset.duration ) || 0.01 ) : 1;
		ctx.fillStyle = '#888';
		ctx.strokeStyle = '#555';
		ctx.font = '10px sans-serif';
		const steps = 10;
		for ( let i = 0; i <= steps; i ++ ) {

			const x = Math.min( w - 1, Math.round( ( i / steps ) * w ) ) + 0.5;
			ctx.beginPath();
			ctx.moveTo( x, h - ( i % 5 === 0 ? 12 : 6 ) );
			ctx.lineTo( x, h );
			ctx.stroke();
			if ( i % 2 === 0 ) ctx.fillText( ( ( i / steps ) * dur ).toFixed( 2 ), Math.min( w - 30, x + 2 ), 10 );

		}

	}

		function getAssetDur() {

			return asset ? Math.max( 0.01, Number( asset.duration ) || 0.01 ) : 1;

		}

		function minClipDur() {

			return 1 / Math.max( 1, ( asset && asset.fps ) || 30 );

		}

		function timeToX( t, w ) {

			return ( ( Number( t ) || 0 ) / getAssetDur() ) * Math.max( 1, w );

		}

		function deltaTimeFromDx( dx, w ) {

			return ( dx / Math.max( 1, w ) ) * getAssetDur();

		}

		function clipBlockColor( trackType ) {

			if ( trackType === 'video' ) return { bg: '#5a3a18', border: '#c88a3a' };
			if ( trackType === 'activation' ) return { bg: '#1a4a2a', border: '#4caf70' };
			return { bg: '#1e3a5a', border: '#4a90d9' };

		}

		function clipBlockLabel( track, clip ) {

			if ( track.type === 'video' ) return T( '\u89c6\u9891', 'Video' );
			if ( track.type === 'activation' ) return T( '\u53ef\u89c1', 'Active' );
			return clip.animId || '?';

		}

		function layoutClipBlock( el, clip, laneW ) {

			const w = laneW || ( el.parentElement ? el.parentElement.getBoundingClientRect().width : 1 );
			el.style.left = Math.max( 0, timeToX( clip.start, w ) ) + 'px';
			el.style.width = Math.max( 4, timeToX( Math.max( minClipDur(), Number( clip.duration ) || minClipDur() ), w ) ) + 'px';

		}

		function relayoutClipLanes() {

			for ( const ref of clipLaneRefs ) {

				const w = ref.laneEl.getBoundingClientRect().width;
				for ( const b of ref.blocks ) {

					layoutClipBlock( b.el, b.clip, w );
					if ( b.startNum ) b.startNum.setValue( Number( b.clip.start ) || 0 );
					if ( b.durNum ) b.durNum.setValue( Number( b.clip.duration ) || minClipDur() );

				}

			}

		}

		function applyClipDragMove( e ) {

			if ( ! clipDrag || ! asset ) return;
			const fps = asset.fps || 30;
			const laneW = clipDrag.laneEl.getBoundingClientRect().width;
			const dt = deltaTimeFromDx( e.clientX - clipDrag.originClientX, laneW );
			const minD = minClipDur();

			if ( clipDrag.mode === 'move' ) {

				clipDrag.clip.start = snapTimeToFrame( Math.max( 0, clipDrag.originStart + dt ), fps );

			} else if ( clipDrag.mode === 'right' ) {

				const end = snapTimeToFrame( clipDrag.originStart + clipDrag.originDur + dt, fps );
				clipDrag.clip.duration = Math.max( minD, end - clipDrag.originStart );

			} else if ( clipDrag.mode === 'left' ) {

				const end = clipDrag.endFixed;
				let newStart = snapTimeToFrame( Math.max( 0, clipDrag.originStart + dt ), fps );
				if ( end - newStart < minD ) newStart = snapTimeToFrame( Math.max( 0, end - minD ), fps );
				clipDrag.clip.start = newStart;
				clipDrag.clip.duration = Math.max( minD, end - newStart );

			}

			layoutClipBlock( clipDrag.el, clipDrag.clip, laneW );
			if ( clipDrag.startNum ) clipDrag.startNum.setValue( clipDrag.clip.start );
			if ( clipDrag.durNum ) clipDrag.durNum.setValue( clipDrag.clip.duration );

		}

		function bindClipBlockDrag( el, clip, startNum, durNum, laneEl ) {

			el.addEventListener( 'mousedown', function ( e ) {

				if ( e.button !== 0 || ! asset ) return;
				e.preventDefault();
				e.stopPropagation();
				playing = false;
				isScrubbing = false;
				const rect = el.getBoundingClientRect();
				const localX = e.clientX - rect.left;
				let mode = 'move';
				if ( localX <= CLIP_EDGE ) mode = 'left';
				else if ( localX >= rect.width - CLIP_EDGE ) mode = 'right';
				clipDrag = {
					mode,
					clip,
					el,
					startNum,
					durNum,
					laneEl,
					originStart: Number( clip.start ) || 0,
					originDur: Number( clip.duration ) || minClipDur(),
					originClientX: e.clientX,
					endFixed: ( Number( clip.start ) || 0 ) + ( Number( clip.duration ) || minClipDur() ),
				};
				el.style.cursor = mode === 'move' ? 'grabbing' : 'ew-resize';

			} );

			el.addEventListener( 'mousemove', function ( e ) {

				if ( clipDrag ) return;
				const rect = el.getBoundingClientRect();
				const localX = e.clientX - rect.left;
				if ( localX <= CLIP_EDGE || localX >= rect.width - CLIP_EDGE ) el.style.cursor = 'ew-resize';
				else el.style.cursor = 'grab';

			} );

		}

		function updateUI() {

			titleText.textContent = T( '\u65f6\u95f4\u8f74', 'Timeline' ) + ( object ? ' \u2014 ' + object.name : '' );
			const dur = asset ? Number( asset.duration ) || 0 : 0;
			const fps = asset ? Number( asset.fps ) || 30 : 30;
			timeText.textContent = playTime.toFixed( 2 ) + ' / ' + dur.toFixed( 2 ) + ' s  (f' + Math.round( playTime * fps ) + ')';
			playBtn.style.background = playing ? '#2a5a2a' : '#333';
			pauseBtn.style.background = ( ! playing && playTime > 0 ) ? '#5a4a1a' : '#333';
			if ( asset && panelVisible ) {

				if ( document.activeElement !== endNum.dom ) {

					endNum.setValue( Number( asset.duration ) || 1 );

				}
				const f = String( asset.fps != null ? asset.fps : 30 );
				if ( f !== '24' && f !== '25' && f !== '30' ) {

					let hasOpt = false;
					for ( let i = 0; i < fpsSelect.options.length; i ++ ) {

						if ( fpsSelect.options[ i ].value === f ) {

							hasOpt = true;
							break;

						}

					}
					if ( ! hasOpt ) {

						const o = document.createElement( 'option' );
						o.value = f;
						o.textContent = f;
						fpsSelect.appendChild( o );

					}

				}
				if ( fpsSelect.value !== f ) fpsSelect.value = f;

			}
			if ( panelVisible ) {

				drawRuler();
				const w = rulerHost.getBoundingClientRect().width;
				const x = dur > 0 ? ( playTime / dur ) * w : 0;
				playhead.style.left = Math.max( 0, Math.min( w - 2, x ) ) + 'px';
				if ( ! clipDrag ) relayoutClipLanes();

			}

		}

	// ---- Tracks ----
	function newId( prefix ) {

		return ( typeof crypto !== 'undefined' && crypto.randomUUID ) ? crypto.randomUUID() : ( prefix + Math.random().toString( 36 ).slice( 2, 10 ) );

	}

	function commitAssetEdit( resample ) {

		if ( ! object || ! asset ) return;
		asset.duration = Math.max( 0.01, Number( asset.duration ) || 0.01 );
		if ( object.userData[ TL_KEY ] ) {

			object.userData[ TL_KEY ].duration = asset.duration;
			object.userData[ TL_KEY ].fps = asset.fps;
			object.userData[ TL_KEY ].loop = asset.loop;

		}
		object.__fccTimelineAsset = asset;
		if ( resample && editor.timelinePreviewOwnsAnim ) applySample();
		updateUI();

	}

	function addAnimationTrack() {

		if ( ! object || ! asset ) return;
		if ( ! asset.tracks ) asset.tracks = [];
		const sel = editor.selected;
		const tr = {
			id: newId( 'tr_' ),
			type: 'animation',
			name: 'Animation',
			muted: false,
			bindingUuid: ( sel && sel !== editor.scene ) ? sel.uuid : '',
			clips: [],
		};
		asset.tracks.push( tr );
		selectedTrackId = tr.id;
		object.__fccTimelineAsset = asset;
		rebuildTracksUI();
		commitAssetEdit( true );

	}

	function getSelectedAnimTrack() {

		if ( ! asset ) return null;
		const list = ( asset.tracks || [] ).filter( ( t ) => t.type === 'animation' );
		return list.find( ( t ) => t.id === selectedTrackId ) || list[ list.length - 1 ] || null;

	}

	function findVideoPlayerUuid() {

		const sel = editor.selected;
		if ( sel && sel !== editor.scene && sel.userData && sel.userData.fccVideoPlayer ) return sel.uuid;
		let found = '';
		editor.scene.traverse( ( o ) => {

			if ( ! found && o.userData && o.userData.fccVideoPlayer ) found = o.uuid;

		} );
		return found;

	}

	function getSelectedVideoTrack() {

		if ( ! asset ) return null;
		return ( asset.tracks || [] ).find( ( t ) => t.id === selectedTrackId && t.type === 'video' ) || null;

	}

	function addVideoTrack() {

		if ( ! object || ! asset ) return;
		if ( ! asset.tracks ) asset.tracks = [];
		const videoPlayerUuid = findVideoPlayerUuid();
		const tr = {
			id: newId( 'tr_' ),
			type: 'video',
			name: 'Video',
			muted: false,
			bindingUuid: videoPlayerUuid,
			videoPlayerUuid: videoPlayerUuid,
			clips: [],
		};
		asset.tracks.push( tr );
		selectedTrackId = tr.id;
		object.__fccTimelineAsset = asset;
		rebuildTracksUI();
		commitAssetEdit( true );

	}

	function addActivationTrack() {

		if ( ! object || ! asset ) return;
		if ( ! asset.tracks ) asset.tracks = [];
		const sel = editor.selected;
		const hasSel = !!( sel && sel !== editor.scene );
		const tr = {
			id: newId( 'tr_' ),
			type: 'activation',
			name: hasSel ? ( sel.name || 'Activation' ) : 'Activation',
			muted: false,
			bindingUuid: hasSel ? sel.uuid : '',
			clips: [],
		};
		asset.tracks.push( tr );
		selectedTrackId = tr.id;
		object.__fccTimelineAsset = asset;
		rebuildTracksUI();
		commitAssetEdit( true );

	}

	function resolveTrackBinding( tr ) {

		const uuid = tr.bindingUuid || tr.videoPlayerUuid || '';
		if ( ! uuid ) {

			return { uuid: '', target: null, label: T( '\u672a\u7ed1\u5b9a\u7269\u4f53', 'Unbound' ) };

		}
		const target = editor.scene.getObjectByProperty( 'uuid', uuid );
		if ( target ) {

			return {
				uuid,
				target,
				label: target.name || T( '\u672a\u547d\u540d', '(unnamed)' ),
			};

		}
		return {
			uuid,
			target: null,
			label: T( '\u4e22\u5931\u7269\u4f53', 'Missing' ) + ' ' + uuid.slice( 0, 8 ),
		};

	}

	function rebindTrackToSelection( tr ) {

		const sel = editor.selected;
		if ( ! sel || sel === editor.scene ) {

			console.warn( '[FreeFilmCut] Select a scene object first, then Bind' );
			return;

		}
		if ( tr.type === 'video' && !( sel.userData && sel.userData.fccVideoPlayer ) ) {

			console.warn( '[FreeFilmCut] Video track should bind to a VideoPlayer' );
			return;

		}
		tr.bindingUuid = sel.uuid;
		if ( tr.type === 'video' ) tr.videoPlayerUuid = sel.uuid;
		if ( tr.type === 'activation' || tr.type === 'animation' ) {

			tr.name = sel.name || tr.name;

		}
		rebuildTracksUI();
		commitAssetEdit( true );

	}

	function getSelectedActivationTrack() {

		if ( ! asset ) return null;
		return ( asset.tracks || [] ).find( ( t ) => t.id === selectedTrackId && t.type === 'activation' ) || null;

	}

	function addActivationClip( track ) {

		if ( ! object || ! asset ) return;
		if ( ! track.clips ) track.clips = [];
		track.clips.push( {
			id: newId( 'clip_' ),
			start: snapTimeToFrame( playTime, asset.fps ),
			duration: 1,
		} );
		selectedTrackId = track.id;
		rebuildTracksUI();
		commitAssetEdit( true );

	}

	function onAddClip() {

		const at = getSelectedActivationTrack();
		if ( at ) {

			addActivationClip( at );
			return;

		}
		const vt = getSelectedVideoTrack();
		if ( vt ) addVideoClip( vt ); else openClipPicker();

	}

	function addVideoClip( track ) {

		if ( ! object || ! asset ) return;
		if ( ! track.clips ) track.clips = [];
		const uuid = track.bindingUuid || track.videoPlayerUuid;
		const vp = uuid ? editor.scene.getObjectByProperty( 'uuid', uuid ) : null;
		const vd = vp ? getMediaDurationSec( vp ) : NaN;
		track.clips.push( {
			id: newId( 'clip_' ),
			start: snapTimeToFrame( playTime, asset.fps ),
			duration: ( Number.isFinite( vd ) && vd > 0 ) ? vd : 1,
			mediaOffset: 0,
			loop: false,
		} );
		selectedTrackId = track.id;
		rebuildTracksUI();
		commitAssetEdit( true );

	}

	function collectAnims() {

		const list = [];
		const seen = new Set();
		const push = ( a ) => {

			if ( ! a || ! a.name || seen.has( a.name ) ) return;
			seen.add( a.name );
			list.push( a );

		};
		for ( const a of editor.freecapcutAnims || [] ) push( a );
		push( editor.activeFreecapcutAnim );
		return list;

	}

	let pickerAnims = [];

	function openClipPicker() {

		if ( ! object || ! asset ) return;
		if ( ! getSelectedAnimTrack() ) {

			console.warn( '[FreeFilmCut] Timeline: add an animation track first' );
			return;

		}
		pickerAnims = collectAnims();
		pickerSelect.textContent = '';
		if ( pickerAnims.length === 0 ) {

			const o = document.createElement( 'option' );
			o.textContent = T( '\u65e0\u53ef\u7528\u52a8\u753b', '(no animations available)' );
			o.value = '';
			pickerSelect.appendChild( o );

		}
		pickerAnims.forEach( ( a, i ) => {

			const o = document.createElement( 'option' );
			o.value = String( i );
			o.textContent = a.name + ' (' + ( Number( a.duration ) || 1 ).toFixed( 2 ) + 's)';
			pickerSelect.appendChild( o );

		} );
		picker.style.display = 'flex';

	}

	function confirmClipPicker() {

		picker.style.display = 'none';
		const track = getSelectedAnimTrack();
		const chosen = pickerAnims[ Number( pickerSelect.value ) ];
		if ( ! track || ! chosen || ! asset ) return;
		if ( ! track.clips ) track.clips = [];
		track.clips.push( {
			id: newId( 'clip_' ),
			start: snapTimeToFrame( playTime, asset.fps ),
			duration: Math.max( 0.1, Number( chosen.duration ) || 1 ),
			animId: chosen.name,
			animPath: chosen._projectPath || '',
			clipLocalOffset: 0,
			loop: false,
		} );
		selectedTrackId = track.id;
		rebuildTracksUI();
		commitAssetEdit( true );

	}

	function makeIconBtn( text, title, onClick ) {

		const b = document.createElement( 'button' );
		b.type = 'button';
		b.textContent = text;
		b.title = title;
		b.style.cssText = 'background:transparent;color:#c88;border:none;cursor:pointer;font-size:14px;';
		b.addEventListener( 'click', onClick );
		return b;

	}

	function rebuildTracksUI() {

		trackList.textContent = '';
		clipLaneRefs = [];
		if ( ! asset ) return;
		const tracks = asset.tracks || [];
		if ( tracks.length === 0 ) {

			const empty = document.createElement( 'div' );
			empty.textContent = T( '\u6682\u65e0\u8f68\u9053', 'No tracks yet' );
			empty.style.cssText = 'padding:8px 10px;font-size:11px;color:#777;';
			trackList.appendChild( empty );
			return;

		}

		const activeTrack = tracks.find( ( t ) => t.id === selectedTrackId && ( t.type === 'animation' || t.type === 'video' || t.type === 'activation' ) ) || getSelectedAnimTrack();
		for ( const tr of tracks ) {

			const block = document.createElement( 'div' );
			const isSel = !! activeTrack && tr.id === activeTrack.id;
			block.style.cssText = 'border-bottom:1px solid #2a2a2a;padding:3px 0;color:#aaa;' + ( isSel ? 'background:#232a33;' : '' );
			trackList.appendChild( block );

			const head = document.createElement( 'div' );
			head.style.cssText = 'display:flex;align-items:center;gap:8px;height:22px;cursor:pointer;padding:0 8px;';
			head.addEventListener( 'click', () => {

				if ( ( tr.type !== 'animation' && tr.type !== 'video' && tr.type !== 'activation' ) || selectedTrackId === tr.id ) return;
				selectedTrackId = tr.id;
				rebuildTracksUI();

			} );
			block.appendChild( head );

			if ( tr.type !== 'animation' && tr.type !== 'video' && tr.type !== 'activation' ) {

				const nameEl = document.createElement( 'span' );
				nameEl.textContent = ( tr.type || 'track' ) + ( tr.name ? ' \u00b7 ' + tr.name : '' );
				nameEl.style.cssText = 'flex:1;color:' + ( isSel ? '#fff' : '#aaa' ) + ';';
				head.appendChild( nameEl );
				continue;

			}
			const isVideo = tr.type === 'video';
			const isActivation = tr.type === 'activation';
			const binding = resolveTrackBinding( tr );

			const nameEl = document.createElement( 'span' );
			const typeLabel = isActivation
				? T( '\u6fc0\u6d3b', 'Activation' )
				: isVideo
					? T( '\u89c6\u9891', 'Video' )
					: T( '\u52a8\u753b', 'Animation' );
			nameEl.textContent = typeLabel;
			nameEl.style.cssText = 'flex-shrink:0;color:' + ( isSel ? '#fff' : '#aaa' ) + ';min-width:52px;';
			head.appendChild( nameEl );

			const bind = document.createElement( 'span' );
			bind.textContent = ( isActivation ? T( '\u63a7\u5236: ', 'Ctrl: ' ) : '@ ' ) + binding.label;
			bind.title = binding.uuid
				? ( binding.label + '\n' + binding.uuid + '\n' + T( '\u70b9\u51fb\u5728\u573a\u666f\u4e2d\u9009\u4e2d', 'Click to select in scene' ) )
				: T( '\u5148\u5728\u573a\u666f\u4e2d\u9009\u4e2d\u7269\u4f53\uff0c\u518d\u70b9\u300c\u7ed1\u5b9a\u9009\u4e2d\u300d', 'Select an object in the scene, then Bind' );
			bind.style.cssText = 'flex:1;min-width:0;font-size:11px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;cursor:pointer;color:'
				+ ( binding.target ? '#8fd48f' : ( binding.uuid ? '#e0a060' : '#c66' ) ) + ';';
			bind.addEventListener( 'click', ( e ) => {

				e.stopPropagation();
				if ( binding.target && editor.select ) editor.select( binding.target );

			} );
			head.appendChild( bind );

			head.appendChild( makeIconBtn(
				T( '\u7ed1', 'Bind' ),
				T( '\u7ed1\u5b9a\u5230\u5f53\u524d\u9009\u4e2d\u7684\u573a\u666f\u7269\u4f53', 'Bind to currently selected scene object' ),
				( e ) => {

					e.stopPropagation();
					rebindTrackToSelection( tr );

				}
			) );

			const muteLabel = document.createElement( 'label' );
			muteLabel.style.cssText = 'display:flex;align-items:center;gap:3px;font-size:11px;cursor:pointer;';
			const muteCb = document.createElement( 'input' );
			muteCb.type = 'checkbox';
			muteCb.checked = !! tr.muted;
			muteCb.addEventListener( 'change', () => { tr.muted = muteCb.checked; if ( editor.timelinePreviewOwnsAnim ) applySample(); } );
			muteLabel.appendChild( muteCb );
			muteLabel.appendChild( document.createTextNode( T( '\u9759\u97f3', 'Mute' ) ) );
			muteLabel.addEventListener( 'click', ( e ) => e.stopPropagation() );
			head.appendChild( muteLabel );

			head.appendChild( makeIconBtn( '\u00d7', T( '\u5220\u9664\u8f68\u9053', 'Delete track' ), ( e ) => {

				e.stopPropagation();
				asset.tracks = asset.tracks.filter( ( t ) => t !== tr );
				if ( selectedTrackId === tr.id ) selectedTrackId = '';
				rebuildTracksUI();
				commitAssetEdit( true );

			} ) );

			// Clip lane aligned with ruler
			const laneRow = document.createElement( 'div' );
			laneRow.style.cssText = 'display:flex;height:' + LANE_H + 'px;align-items:stretch;';
			block.appendChild( laneRow );

			const laneGutter = document.createElement( 'div' );
			laneGutter.style.cssText = 'width:' + LABEL_W + 'px;flex-shrink:0;box-sizing:border-box;';
			laneRow.appendChild( laneGutter );

			const laneEl = document.createElement( 'div' );
			laneEl.style.cssText = 'flex:1;position:relative;height:' + LANE_H + 'px;background:#141414;border-top:1px solid #2a2a2a;border-bottom:1px solid #2a2a2a;overflow:hidden;';
			laneRow.appendChild( laneEl );

			const laneRef = { laneEl, blocks: [] };
			clipLaneRefs.push( laneRef );
			const colors = clipBlockColor( tr.type );
			const laneW0 = Math.max( 1, rulerHost.getBoundingClientRect().width );

			for ( const clip of tr.clips || [] ) {

				const crow = document.createElement( 'div' );
				crow.style.cssText = 'display:flex;align-items:center;gap:6px;min-height:24px;padding:2px 8px 2px 14px;font-size:11px;' + ( isVideo ? 'flex-wrap:wrap;' : '' );
				block.appendChild( crow );

				const cname = document.createElement( 'span' );
				cname.textContent = isVideo ? T( '\u89c6\u9891', 'Video' ) : isActivation ? T( '\u53ef\u89c1', 'Visible' ) : ( clip.animId || '?' );
				cname.title = ( isVideo || isActivation ) ? '' : ( clip.animPath || '' );
				cname.style.cssText = 'flex:1;color:#cde;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
				crow.appendChild( cname );

				const sl = document.createElement( 'span' );
				sl.textContent = T( '\u8d77\u59cb', 'Start' );
				crow.appendChild( sl );
				const startNum = new UINumber( Number( clip.start ) || 0 ).setWidth( '56px' ).setRange( 0, 100000 ).setPrecision( 2 ).setStep( 0.1 );
				crow.appendChild( startNum.dom );

				const dl = document.createElement( 'span' );
				dl.textContent = T( '\u65f6\u957f', 'Dur' );
				crow.appendChild( dl );
				const durNum = new UINumber( Number( clip.duration ) || minClipDur() ).setWidth( '56px' ).setRange( 0.01, 100000 ).setPrecision( 2 ).setStep( 0.1 );
				crow.appendChild( durNum.dom );

				const blockEl = document.createElement( 'div' );
				blockEl.textContent = clipBlockLabel( tr, clip );
				blockEl.title = blockEl.textContent;
				blockEl.style.cssText = [
					'position:absolute',
					'top:3px',
					'height:' + ( LANE_H - 6 ) + 'px',
					'box-sizing:border-box',
					'background:' + colors.bg,
					'border:1px solid ' + colors.border,
					'border-radius:3px',
					'color:#eee',
					'font-size:10px',
					'line-height:' + ( LANE_H - 8 ) + 'px',
					'padding:0 6px',
					'overflow:hidden',
					'text-overflow:ellipsis',
					'white-space:nowrap',
					'cursor:grab',
					'user-select:none',
					'z-index:1',
				].join( ';' );
				laneEl.appendChild( blockEl );
				layoutClipBlock( blockEl, clip, laneW0 );
				bindClipBlockDrag( blockEl, clip, startNum, durNum, laneEl );
				laneRef.blocks.push( { el: blockEl, clip, startNum, durNum } );

				startNum.onChange( () => {

					clip.start = snapTimeToFrame( Math.max( 0, startNum.getValue() ), asset.fps );
					startNum.setValue( clip.start );
					layoutClipBlock( blockEl, clip, laneEl.getBoundingClientRect().width );
					commitAssetEdit( true );
					relayoutClipLanes();

				} );

				durNum.onChange( () => {

					clip.duration = Math.max( minClipDur(), durNum.getValue() );
					durNum.setValue( clip.duration );
					layoutClipBlock( blockEl, clip, laneEl.getBoundingClientRect().width );
					commitAssetEdit( true );
					relayoutClipLanes();

				} );

				if ( isVideo ) {

					const ml = document.createElement( 'span' );
					ml.textContent = T( '\u5a92\u4f53\u504f\u79fb', 'Offset' );
					crow.appendChild( ml );
					const offNum = new UINumber( Number( clip.mediaOffset ) || 0 ).setWidth( '56px' ).setRange( 0, 100000 ).setPrecision( 2 ).setStep( 0.1 );
					offNum.onChange( () => {

						clip.mediaOffset = Math.max( 0, offNum.getValue() );
						offNum.setValue( clip.mediaOffset );
						commitAssetEdit( true );

					} );
					crow.appendChild( offNum.dom );

					const loopLabel = document.createElement( 'label' );
					loopLabel.style.cssText = 'display:flex;align-items:center;gap:3px;cursor:pointer;';
					const loopCb = document.createElement( 'input' );
					loopCb.type = 'checkbox';
					loopCb.checked = !! clip.loop;
					loopCb.addEventListener( 'change', () => { clip.loop = loopCb.checked; commitAssetEdit( true ); } );
					loopLabel.appendChild( loopCb );
					loopLabel.appendChild( document.createTextNode( T( '\u5faa\u73af', 'Loop' ) ) );
					crow.appendChild( loopLabel );

				}

				crow.appendChild( makeIconBtn( '\u00d7', T( '\u5220\u9664\u7247\u6bb5', 'Delete clip' ), () => {

					tr.clips = tr.clips.filter( ( c ) => c !== clip );
					rebuildTracksUI();
					commitAssetEdit( true );

				} ) );

			}

		}

		requestAnimationFrame( () => relayoutClipLanes() );

	}

	function setPanelVisible( v ) {

		panelVisible = v;
		root.style.display = v ? 'flex' : 'none';
		if ( v ) {

			updateUI();

		} else {

			stop();

		}

	}

	async function openFor( obj ) {

		if ( ! isFccTimeline( obj ) ) return;

		if ( object && object !== obj ) stop();

		const ud = obj.userData[ TL_KEY ];
		editor.scene.traverse( ( o ) => {

			if ( o !== obj && isFccTimeline( o ) ) o.userData[ TL_KEY ].active = false;

		} );
		ud.active = true;
		editor.activeFccTimeline = obj;

		const token = ++ openToken;
		const loaded = await loadTimelineAsset( editor, obj );
		if ( token !== openToken ) return; // superseded by a newer openFor

		object = obj;
		asset = loaded;
		obj.__fccTimelineAsset = asset;
		syncFromUD();
		playing = false;
		playTime = 0;
		selectedTrackId = '';
		picker.style.display = 'none';
		rebuildTracksUI();

		setPanelVisible( true );
		updateUI();

	}

	function waitVideoFrame( video ) {

		return new Promise( ( resolve ) => {

			if ( ! video || ( video.readyState >= 2 && video.seeking !== true ) ) {

				resolve();
				return;

			}

			let done = false;
			const finish = () => {

				if ( done ) return;
				done = true;
				video.removeEventListener( 'seeked', finish );
				resolve();

			};
			video.addEventListener( 'seeked', finish );
			setTimeout( finish, 500 );

		} );

	}

	function getExportState() {

		if ( ! object || ! asset ) return null;
		const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
		return {
			duration: dur,
			fps: Math.max( 1, Number( asset.fps ) || 30 ),
			time: playTime,
			name: asset.name || object.name || 'Timeline',
		};

	}

	async function sampleAt( t, opts ) {

		opts = opts || {};
		if ( ! object || ! asset || ! object.parent ) return null;
		playing = false;
		pauseAllTimelineVideos();
		const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
		playTime = Math.max( 0, Math.min( dur, Number( t ) || 0 ) );
		applySample( opts.silent ? { silent: true, playing: false } : undefined );
		if ( ! opts.silent ) updateUI();
		const waits = [];
		for ( const track of asset.tracks || [] ) {

			if ( track.muted || track.type !== 'video' ) continue;
			const uuid = track.bindingUuid || track.videoPlayerUuid;
			const obj = uuid && editor.scene.getObjectByProperty( 'uuid', uuid );
			const video = obj && obj.__fccVideo;
			if ( video ) waits.push( waitVideoFrame( video ) );

		}
		if ( waits.length ) await Promise.all( waits );
		await new Promise( ( resolve ) => requestAnimationFrame( resolve ) );
		return getExportState();

	}

	function syncSettingsFromObject( obj ) {
		if ( ! obj || obj !== object || ! asset ) return;
		const ud = obj.userData[ TL_KEY ];
		if ( ! ud ) return;
		if ( Number( ud.duration ) > 0 ) asset.duration = Number( ud.duration );
		if ( Number( ud.fps ) > 0 ) asset.fps = Number( ud.fps );
		if ( ud.loop === 'loop' || ud.loop === 'clamp' ) asset.loop = ud.loop;
		if ( playTime > asset.duration ) playTime = asset.duration;
		updateUI();
		relayoutClipLanes();
	}

	editor.fccTimelineEditor = {
		openFor,
		sampleIfPlaying,
		isPlaying: () => playing,
		syncSettingsFromObject,
		getExportState,
		sampleAt,
		scrubTo,
		scrubSceneTimeline,
		getDuration: () => ( object && asset ) ? ( Number( asset.duration ) || 0 ) : 0,
	};

	// Redraw ruler on window resize
	window.addEventListener( 'resize', () => { if ( panelVisible ) updateUI(); } );

	return container;

}

export { FccTimelineEditor };
