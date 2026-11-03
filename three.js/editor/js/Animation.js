/**
 * FreeFilmCut animation editor — floating draggable window.
 * Backend: FreeCapCutAnimCore.js (.anim transform / material / PP).
 */
import { UIPanel, UIText, UIButton, UISelect, UIInput, UINumber } from './libs/ui.js';
import {
	createEmptyAnim,
	normalizeAnim,
	applyAnimToRoot,
	applyAllEditorAnims,
	mapAnimTime,
	ensureTarget,
	ensureTrack,
	upsertKey,
	recomputeDuration,
	listDefaultTransformKeys,
	isUIAnimTarget,
	listMaterialKeyPaths,
	attachAnimController,
	ensureObjectAnimClip,
	switchActiveAnimToObject,
	uniqueAnimName,
	isTextAnimPath,
} from './anim/FreeCapCutAnimCore.js?v=fcc-anim-22';
import { ANIM_EASES, ANIM_EASE_LABELS_ZH } from './anim/AnimEase.js';
import {
	listTextAnimKeyPaths,
	textAnimTrackInfo,
	migratePendingTextAnimTimes,
} from './ui/TextAnimKeys.js?v=fcc-ui-146';
import {
	findThreeClipsNear,
	playThreeClip,
	stopThreeClipPreview,
	scrubThreeClip,
	isThreeClipPreviewHeld,
	convertThreeClipToFreecapcut,
} from './anim/ThreeClipBridge.js?v=fcc-ui-107';

const UI_TRACK_LABELS = {
	'ui.anchoredPosition.x': '位置.X',
	'ui.anchoredPosition.y': '位置.Y',
	'ui.localEulerAngles.x': '旋转.X',
	'ui.localEulerAngles.y': '旋转.Y',
	'ui.localEulerAngles.z': '旋转.Z',
	'ui.localScale.x': '缩放.X',
	'ui.localScale.y': '缩放.Y',
	'ui.localScale.z': '缩放.Z',
};

function uiTrackLabel( path ) {

	return UI_TRACK_LABELS[ path ] || path;

}

function Animation( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;

	if ( ! editor.freecapcutAnims ) editor.freecapcutAnims = [];
	if ( ! editor.activeFreecapcutAnim ) {

		editor.activeFreecapcutAnim = createEmptyAnim(
			strings.getKey( 'animation/defaultName' ) || 'Animation',
			30
		);

	}

	const WIN_W = 720;
	const WIN_H = 320;
	const LABEL_W = 160;
	const MIN_W = 480;
	const MIN_H = 220;

	let playing = false;
	let playTime = 0;
	let lastTs = 0;
	let panelVisible = false;
	let frameStart = 0; // inclusive, UI range
	let isDraggingWin = false;
	let isResizing = false;
	let isScrubbing = false;
	let isDraggingKey = false;
	let isMarquee = false;
	let marqueeStartX = 0;
	let marqueeStartY = 0;
	let marqueeAdditive = false;
	/** @type {{ targetUuid: string, path: string, keyIndex: number }[]} */
	let marqueeBaseSelection = [];
	let dragOffX = 0;
	let dragOffY = 0;
	let resizeStartX = 0;
	let resizeStartY = 0;
	let resizeStartW = 0;
	let resizeStartH = 0;
	/** @type {{ targetUuid: string, path: string, keyIndex: number }[]} */
	let selectedKeys = [];
	let dragKeyRef = null; // { targetUuid, path, keyIndex, originT, el, group }

	const container = new UIPanel();
	container.setId( 'animation' );
	container.setClass( 'animation-window' );
	const root = container.dom;
	root.style.cssText = [
		'display:none',
		'position:fixed',
		'left:80px',
		'top:80px',
		'width:' + WIN_W + 'px',
		'height:' + WIN_H + 'px',
		'z-index:10050',
		'flex-direction:column',
		'background:#1e1e1e',
		'border:1px solid #555',
		'border-radius:6px',
		'box-shadow:0 8px 28px rgba(0,0,0,0.55)',
		'overflow:hidden',
		'color:#ddd',
		'font-size:12px',
	].join( ';' );

	restorePos();

	// ---- Title bar (drag) ----
	const titleBar = document.createElement( 'div' );
	titleBar.className = 'animation-titlebar';
	titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#2a2a2a;border-bottom:1px solid #444;cursor:move;user-select:none;flex-shrink:0;';
	root.appendChild( titleBar );

	const titleText = document.createElement( 'div' );
	titleText.textContent = strings.getKey( 'animation/title' ) || '\u52a8\u753b';
	titleText.style.cssText = 'font-weight:600;color:#eee;';
	titleBar.appendChild( titleText );

	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.textContent = '\u00d7';
	closeBtn.title = strings.getKey( 'animation/close' ) || '\u5173\u95ed';
	closeBtn.style.cssText = 'width:24px;height:24px;border:none;background:transparent;color:#ccc;font-size:18px;line-height:1;cursor:pointer;border-radius:4px;';
	closeBtn.addEventListener( 'mouseenter', () => { closeBtn.style.background = '#c44'; closeBtn.style.color = '#fff'; } );
	closeBtn.addEventListener( 'mouseleave', () => { closeBtn.style.background = 'transparent'; closeBtn.style.color = '#ccc'; } );
	closeBtn.addEventListener( 'click', ( e ) => { e.stopPropagation(); setPanelVisible( false ); } );
	titleBar.appendChild( closeBtn );

	titleBar.addEventListener( 'mousedown', function ( e ) {

		if ( e.button !== 0 || e.target === closeBtn ) return;
		isDraggingWin = true;
		dragOffX = e.clientX - root.getBoundingClientRect().left;
		dragOffY = e.clientY - root.getBoundingClientRect().top;
		e.preventDefault();

	} );

	// ---- Controls ----
	const controls = document.createElement( 'div' );
	controls.style.cssText = 'display:flex;flex-wrap:wrap;align-items:center;gap:6px;padding:6px 10px;border-bottom:1px solid #333;flex-shrink:0;background:#222;';
	root.appendChild( controls );

	function addLabel( text ) {

		const s = document.createElement( 'span' );
		s.textContent = text;
		s.style.color = '#888';
		controls.appendChild( s );
		return s;

	}

	const nameInput = new UIInput( editor.activeFreecapcutAnim.name ).setWidth( '100px' );
	nameInput.onChange( function () {

		const clip = editor.activeFreecapcutAnim;
		const next = nameInput.getValue() || 'Animation';
		clip.name = next;
		titleText.textContent = ( strings.getKey( 'animation/title' ) || '动画' ) + ' · ' + next;
		markClipForExport( clip );
		const obj = editor.selected;
		if ( obj && obj.userData && obj.userData.freecapcutAnimController ) {

			obj.userData.freecapcutAnimController.clipId = next;

		}

	} );
	controls.appendChild( nameInput.dom );

	addLabel( 'FPS' );
	const fpsSelect = new UISelect().setOptions( { '24': '24', '25': '25', '30': '30' } )
		.setValue( String( editor.activeFreecapcutAnim.fps || 30 ) ).setWidth( '52px' );
	fpsSelect.onChange( function () {

		editor.activeFreecapcutAnim.fps = parseInt( fpsSelect.getValue(), 10 ) || 30;
		syncFrameInputsFromClip();
		rebuildTracks();
		applyAndRefresh();

	} );
	controls.appendChild( fpsSelect.dom );

	addLabel( strings.getKey( 'animation/playMode' ) || '\u64ad\u653e\u6a21\u5f0f' );
	const loopSelect = new UISelect().setOptions( {
		'clamp': strings.getKey( 'animation/playOnce' ) || '\u64ad\u653e\u4e00\u6b21',
		'loop': strings.getKey( 'animation/playLoop' ) || '\u5faa\u73af',
	} ).setValue( editor.activeFreecapcutAnim.loop === 'loop' ? 'loop' : 'clamp' ).setWidth( '88px' );
	loopSelect.onChange( function () {

		editor.activeFreecapcutAnim.loop = loopSelect.getValue() === 'loop' ? 'loop' : 'clamp';

	} );
	controls.appendChild( loopSelect.dom );

	addLabel( strings.getKey( 'animation/frameRange' ) || '\u5e27\u8303\u56f4' );
	const startFrameInput = new UINumber( 0 ).setWidth( '48px' ).setPrecision( 0 ).setStep( 1 ).setRange( 0, 999999 );
	startFrameInput.onChange( function () {

		frameStart = Math.max( 0, Math.floor( startFrameInput.getValue() ) );
		startFrameInput.setValue( frameStart );
		const end = Math.max( frameStart + 1, Math.floor( endFrameInput.getValue() ) );
		endFrameInput.setValue( end );
		editor.activeFreecapcutAnim.duration = Math.max( 0.01, end / currentFps() );
		applyAndRefresh();
		rebuildTracks();

	} );
	controls.appendChild( startFrameInput.dom );
	addLabel( '–' );
	const endFrameInput = new UINumber( 30 ).setWidth( '48px' ).setPrecision( 0 ).setStep( 1 ).setRange( 1, 999999 );
	endFrameInput.onChange( function () {

		let end = Math.max( frameStart + 1, Math.floor( endFrameInput.getValue() ) );
		endFrameInput.setValue( end );
		editor.activeFreecapcutAnim.duration = Math.max( 0.01, end / currentFps() );
		applyAndRefresh();
		rebuildTracks();

	} );
	controls.appendChild( endFrameInput.dom );

	const playIcon = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M3 1.5v9l7-4.5z" fill="currentColor"/></svg>';
	const pauseIcon = '<svg width="12" height="12" viewBox="0 0 12 12"><path d="M2 1h3v10H2zM7 1h3v10H7z" fill="currentColor"/></svg>';
	const stopIcon = '<svg width="12" height="12" viewBox="0 0 12 12"><rect x="2" y="2" width="8" height="8" fill="currentColor"/></svg>';

	const playButton = new UIButton();
	playButton.dom.innerHTML = playIcon;
	styleIconBtn( playButton );
	playButton.onClick( function () {

		if ( playing ) {

			playing = false;
			playButton.dom.innerHTML = playIcon;

		} else {

			// FreeFilmCut play owns the timeline — stop Blender mixer preview
			stopThreeClipPreview( editor );
			// Play-once at the last frame would stop inside the first tick.
			const clip = editor.activeFreecapcutAnim;
			const t0 = rangeStartTime();
			const t1 = rangeEndTime();
			if ( clip.loop !== 'loop' && playTime >= t1 - 0.5 / currentFps() ) {

				playTime = t0;

			}
			playing = true;
			lastTs = performance.now();
			playButton.dom.innerHTML = pauseIcon;
			tick();

		}

	} );
	controls.appendChild( playButton.dom );

	const stopButton = new UIButton();
	stopButton.dom.innerHTML = stopIcon;
	styleIconBtn( stopButton );
	stopButton.onClick( function () {

		playing = false;
		playButton.dom.innerHTML = playIcon;
		playTime = frameToTime( frameStart );
		applyAndRefresh();

	} );
	controls.appendChild( stopButton.dom );

	const frameLabelPrefix = document.createElement( 'span' );
	frameLabelPrefix.style.color = '#888';
	frameLabelPrefix.textContent = strings.getKey( 'animation/currentFrame' ) || '\u5f53\u524d\u5e27';
	controls.appendChild( frameLabelPrefix );

	const timeText = document.createElement( 'span' );
	timeText.style.cssText = 'color:#ffeb3b;font-weight:600;min-width:110px;font-variant-numeric:tabular-nums;';
	timeText.textContent = '0 / 0';
	timeText.title = strings.getKey( 'animation/currentFrameHint' ) || 'playhead frame';
	controls.appendChild( timeText );

	function addBtn( labelKey, fallback, fn ) {

		const b = new UIButton( strings.getKey( labelKey ) || fallback );
		b.onClick( fn );
		controls.appendChild( b.dom );
		return b;

	}

		addBtn( 'animation/addKey', '\u6dfb\u52a0\u5173\u952e\u5e27', () => addKeysForSelected() );
		addBtn( 'animation/addMatKey', '\u6750\u8d28\u5173\u952e\u5e27', () => addMaterialKeysForSelected() );
		// PP keys: per-param diamond on Sidebar.Object.PostProcess (not bulk).

		// Text animation fields of the selected Text (progress / params / selector).
	const TEXT_KEY_ALL_PROGRESS = '__allProgress';
	const textKeySelect = new UISelect().setWidth( '150px' );
	textKeySelect.dom.title = '在播放头为文字动画参数添加关键帧';
	textKeySelect.onChange( function () {

		const v = textKeySelect.getValue();
		textKeySelect.setValue( '' );
		if ( v ) addTextAnimKeysForSelected( v );

	} );
	controls.appendChild( textKeySelect.dom );

	addBtn( 'animation/deleteKey', '\u5220\u9664\u5173\u952e\u5e27', () => deleteSelectedKeys() );
	addBtn( 'animation/new', '\u65b0\u5efa', () => {

		const object = editor.selected;
		if ( object && object !== editor.scene ) {

			ensureObjectAnimClip( editor, object, { forceNew: true } );

		} else {

			editor.activeFreecapcutAnim = createEmptyAnim( uniqueAnimName( editor, 'Animation' ), currentFps() );

		}
		nameInput.setValue( editor.activeFreecapcutAnim.name );
		loopSelect.setValue( editor.activeFreecapcutAnim.loop === 'loop' ? 'loop' : 'clamp' );
		frameStart = 0;
		playTime = 0;
		playing = false;
		selectedKeys = [];
		syncFrameInputsFromClip();
		rebuildTracks();
		applyAndRefresh();

	} );
	addBtn( 'animation/save', '\u4fdd\u5b58.anim', () => saveAnimToProject() );
	addBtn( 'animation/load', '\u6253\u5f00', () => loadAnimFromFile() );

	// Single selected key: value + ease (ease shapes the segment to the next key).
	const keyInspector = document.createElement( 'span' );
	keyInspector.style.cssText = 'display:none;align-items:center;gap:4px;padding:0 6px;border-left:1px solid #444;';
	const keyInspectorLabel = document.createElement( 'span' );
	keyInspectorLabel.style.cssText = 'color:#888;max-width:140px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
	keyInspector.appendChild( keyInspectorLabel );
	const keyValueInput = new UINumber( 0 ).setWidth( '60px' ).setPrecision( 3 ).setStep( 0.01 );
	keyValueInput.onChange( function () {

		const sel = singleSelectedKey();
		if ( ! sel ) return;
		sel.key.v = keyValueInput.getValue();
		markClipForExport( editor.activeFreecapcutAnim );
		rebuildTracks();
		applyAndRefresh();

	} );
	keyInspector.appendChild( keyValueInput.dom );
	const easeOptions = {};
	for ( const e of ANIM_EASES ) easeOptions[ e ] = ANIM_EASE_LABELS_ZH[ e ] || e;
	const keyEaseSelect = new UISelect().setOptions( easeOptions ).setWidth( '76px' );
	keyEaseSelect.dom.title = '缓动：作用于本帧到下一帧';
	keyEaseSelect.onChange( function () {

		const sel = singleSelectedKey();
		if ( ! sel ) return;
		const e = keyEaseSelect.getValue();
		if ( e && e !== 'linear' ) sel.key.ease = e;
		else delete sel.key.ease;
		markClipForExport( editor.activeFreecapcutAnim );
		rebuildTracks();
		applyAndRefresh();

	} );
	keyInspector.appendChild( keyEaseSelect.dom );
	controls.appendChild( keyInspector );

	const statusText = document.createElement( 'span' );
	statusText.style.color = '#8f8';
	controls.appendChild( statusText );

	// ---- Blender / THREE.AnimationClip (imported GLB/FBX) ----
	const threeRow = document.createElement( 'div' );
	threeRow.style.cssText = 'display:none;flex-wrap:wrap;align-items:center;gap:6px;padding:4px 10px;border-bottom:1px solid #333;flex-shrink:0;background:#1a2a1a;';
	root.appendChild( threeRow );

	const threeLabel = document.createElement( 'span' );
	threeLabel.style.color = '#9c9';
	threeLabel.textContent = '导入动画';
	threeLabel.title = 'Blender / GLB / FBX THREE.AnimationClip (含骨骼)';
	threeRow.appendChild( threeLabel );

	const threeClipSelect = new UISelect().setWidth( '160px' );
	threeRow.appendChild( threeClipSelect.dom );

	let threeClipContext = { root: null, clips: [] };

	function refreshThreeClipUI() {

		const object = editor.selected;
		const found = findThreeClipsNear( object && object !== editor.scene ? object : null );
		// Also surface clips attached directly on the editor scene (Import as Scene)
		if ( ( ! found.clips || found.clips.length === 0 ) && editor.scene && Array.isArray( editor.scene.animations ) && editor.scene.animations.length > 0 ) {

			found.root = editor.scene;
			found.clips = editor.scene.animations.slice();

		}
		threeClipContext = found;
		const opts = {};
		if ( ! found.clips || found.clips.length === 0 ) {

			threeRow.style.display = 'none';
			threeClipSelect.setOptions( { '': '无' } );
			threeClipSelect.setValue( '' );
			return;

		}
		threeRow.style.display = 'flex';
		for ( let i = 0; i < found.clips.length; i ++ ) {

			const c = found.clips[ i ];
			const label = ( c && c.name ) ? c.name : ( 'Clip_' + i );
			opts[ String( i ) ] = label + ' (' + ( c.duration != null ? Number( c.duration ).toFixed( 2 ) : '?' ) + 's)';

		}
		threeClipSelect.setOptions( opts );
		threeClipSelect.setValue( '0' );

	}

	function getSelectedThreeClip() {

		const idx = parseInt( threeClipSelect.getValue(), 10 );
		if ( ! threeClipContext.clips || ! Number.isFinite( idx ) ) return null;
		return threeClipContext.clips[ idx ] || null;

	}

	const threePlayBtn = new UIButton( '预览播放' );
	threePlayBtn.onClick( function () {

		const clip = getSelectedThreeClip();
		const rootObj = threeClipContext.root;
		if ( ! clip || ! rootObj ) {

			flash( '当前选中无导入动画' );
			return;

		}
		playing = false;
		playButton.dom.innerHTML = playIcon;
		const loop = editor.activeFreecapcutAnim && editor.activeFreecapcutAnim.loop === 'loop';
		playThreeClip( editor, rootObj, clip, { loop: loop } );
		flash( '预览中：' + ( clip.name || 'clip' ) + '（骨骼由 Mixer 驱动；暂停 FreeFilmCut 采样）' );
		if ( editor.selected ) signals.objectChanged.dispatch( editor.selected );
		signals.sceneGraphChanged.dispatch();

	} );
	threeRow.appendChild( threePlayBtn.dom );

	const threeStopBtn = new UIButton( '停止预览' );
	threeStopBtn.onClick( function () {

		stopThreeClipPreview( editor );
		flash( '已停止导入动画预览' );
		signals.sceneGraphChanged.dispatch();

	} );
	threeRow.appendChild( threeStopBtn.dom );

	const threeConvertBtn = new UIButton( '转为 FreeFilmCut 动画' );
	threeConvertBtn.onClick( function () {

		const clip = getSelectedThreeClip();
		const rootObj = threeClipContext.root;
		if ( ! clip || ! rootObj ) {

			flash( '当前选中无导入动画' );
			return;

		}
		stopThreeClipPreview( editor );
		const result = convertThreeClipToFreecapcut( editor, rootObj, clip );
		const fcc = result.clip;
		const stats = result.stats;
		if ( ! fcc ) {

			flash( '转换失败' );
			return;

		}
		nameInput.setValue( fcc.name || '' );
		loopSelect.setValue( fcc.loop === 'loop' ? 'loop' : 'clamp' );
		frameStart = 0;
		playTime = 0;
		playing = false;
		playButton.dom.innerHTML = playIcon;
		selectedKeys = [];
		syncFrameInputsFromClip();
		rebuildTracks();
		applyAndRefresh();
		flash( '已转为 FreeFilmCut：' + fcc.name + ' 轨道 ' + stats.tracks + '，骨骼 ' + stats.bones + '，跳过 ' + stats.skipped );

	} );
	threeRow.appendChild( threeConvertBtn.dom );

	const threeHint = document.createElement( 'span' );
	threeHint.style.cssText = 'color:#6a6;font-size:11px;';
	threeHint.textContent = '预览支持骨骼；转换后可编辑并导出 vfxpack';
	threeRow.appendChild( threeHint );

	// ---- Timeline ----
	const timelineArea = document.createElement( 'div' );
	timelineArea.style.cssText = 'flex:1;display:flex;flex-direction:column;overflow:hidden;position:relative;background:#1a1a1a;min-height:0;';
	root.appendChild( timelineArea );

	const RULER_H = 28;
	const rulerRow = document.createElement( 'div' );
	rulerRow.style.cssText = 'display:flex;height:' + RULER_H + 'px;flex-shrink:0;border-bottom:1px solid #333;background:#1f1f1f;position:relative;';
	timelineArea.appendChild( rulerRow );

	const rulerLabel = document.createElement( 'div' );
	rulerLabel.style.cssText = 'width:' + LABEL_W + 'px;flex-shrink:0;padding:0 8px;font-size:10px;color:#888;display:flex;align-items:center;box-sizing:border-box;';
	rulerLabel.textContent = strings.getKey( 'animation/frameTicks' ) || '\u5e27';
	rulerRow.appendChild( rulerLabel );

	const rulerCanvasHost = document.createElement( 'div' );
	rulerCanvasHost.style.cssText = 'flex:1;position:relative;height:100%;overflow:hidden;';
	rulerRow.appendChild( rulerCanvasHost );

	const rulerCanvas = document.createElement( 'canvas' );
	rulerCanvas.style.cssText = 'position:absolute;left:0;top:0;width:100%;height:100%;display:block;';
	rulerCanvasHost.appendChild( rulerCanvas );

	const trackListContainer = document.createElement( 'div' );
	trackListContainer.style.cssText = 'flex:1;overflow-y:auto;position:relative;';
	timelineArea.appendChild( trackListContainer );

	const playhead = document.createElement( 'div' );
	playhead.style.cssText = 'position:absolute;top:0;bottom:0;width:2px;background:#f44;left:' + LABEL_W + 'px;pointer-events:none;z-index:10;';
	timelineArea.appendChild( playhead );

	const playheadBadge = document.createElement( 'div' );
	playheadBadge.style.cssText = 'position:absolute;top:2px;transform:translateX(-50%);background:#f44;color:#fff;font-size:10px;font-weight:600;padding:1px 5px;border-radius:3px;pointer-events:none;z-index:11;font-variant-numeric:tabular-nums;white-space:nowrap;';
	playheadBadge.textContent = '0';
	timelineArea.appendChild( playheadBadge );

	const marqueeEl = document.createElement( 'div' );
	marqueeEl.style.cssText = 'position:absolute;display:none;border:1px solid rgba(100,180,255,0.9);background:rgba(64,160,255,0.18);pointer-events:none;z-index:9;box-sizing:border-box;';
	timelineArea.appendChild( marqueeEl );

	// Resize handle
	const resizeHandle = document.createElement( 'div' );
	resizeHandle.style.cssText = 'position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;z-index:20;background:linear-gradient(135deg,transparent 50%,#666 50%);';
	root.appendChild( resizeHandle );
	resizeHandle.addEventListener( 'mousedown', function ( e ) {

		if ( e.button !== 0 ) return;
		isResizing = true;
		resizeStartX = e.clientX;
		resizeStartY = e.clientY;
		resizeStartW = root.offsetWidth;
		resizeStartH = root.offsetHeight;
		e.preventDefault();
		e.stopPropagation();

	} );

	document.addEventListener( 'mousemove', function ( e ) {

		if ( isDraggingWin ) {

			const x = Math.max( 0, Math.min( window.innerWidth - 80, e.clientX - dragOffX ) );
			const y = Math.max( 0, Math.min( window.innerHeight - 40, e.clientY - dragOffY ) );
			root.style.left = x + 'px';
			root.style.top = y + 'px';
			root.style.right = 'auto';
			root.style.bottom = 'auto';

		} else if ( isResizing ) {

			const w = Math.max( MIN_W, resizeStartW + ( e.clientX - resizeStartX ) );
			const h = Math.max( MIN_H, resizeStartH + ( e.clientY - resizeStartY ) );
			root.style.width = w + 'px';
			root.style.height = h + 'px';
			applyAndRefresh();

		} else if ( isScrubbing ) {

			updateTimeFromPosition( e.clientX );

		} else if ( isDraggingKey && dragKeyRef ) {

			moveDraggedKey( e.clientX );

		} else if ( isMarquee ) {

			updateMarquee( e.clientX, e.clientY );

		}

	} );

	document.addEventListener( 'mouseup', function () {

		if ( isDraggingWin || isResizing ) savePos();
		if ( isDraggingKey ) {

			commitDraggedKeys();
			recomputeDuration( editor.activeFreecapcutAnim );
			syncFrameInputsFromClip();
			rebuildTracks();
			applyAndRefresh(); // playTime unchanged: playhead stays put
			flash( strings.getKey( 'animation/keyMoved' ) || '\u5df2\u79fb\u52a8' );

		}
		if ( isMarquee ) {

			marqueeEl.style.display = 'none';
			refreshKeyInspector();

		}
		isDraggingWin = false;
		isResizing = false;
		isScrubbing = false;
		isDraggingKey = false;
		isMarquee = false;
		dragKeyRef = null;

	} );

	rulerCanvasHost.addEventListener( 'mousedown', function ( event ) {

		if ( event.button !== 0 ) return;
		isScrubbing = true;
		playing = false;
		playButton.dom.innerHTML = playIcon;
		updateTimeFromPosition( event.clientX );
		event.preventDefault();

	} );

	trackListContainer.addEventListener( 'mousedown', function ( event ) {

		if ( event.button !== 0 ) return;
		if ( event.target.closest && event.target.closest( '.anim-key' ) ) return;
		const rect = trackListContainer.getBoundingClientRect();
		// Label column: clear selection on click, no scrub / no marquee.
		if ( event.clientX - rect.left <= LABEL_W ) {

			if ( selectedKeys.length > 0 ) {

				selectedKeys = [];
				paintKeySelection();
				refreshKeyInspector();

			}
			return;

		}
		event.preventDefault();
		playing = false;
		playButton.dom.innerHTML = playIcon;
		isMarquee = true;
		marqueeAdditive = !!( event.shiftKey || event.ctrlKey || event.metaKey );
		marqueeBaseSelection = marqueeAdditive ? selectedKeys.slice() : [];
		if ( ! marqueeAdditive ) selectedKeys = [];
		marqueeStartX = event.clientX;
		marqueeStartY = event.clientY;
		updateMarquee( event.clientX, event.clientY );

	} );

	document.addEventListener( 'keydown', function ( e ) {

		if ( ! panelVisible ) return;
		if ( e.key === 'Delete' || e.key === 'Backspace' ) {

			const tag = ( e.target && e.target.tagName ) || '';
			if ( tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' ) return;
			if ( selectedKeys.length > 0 ) {

				e.preventDefault();
				deleteSelectedKeys();

			}

		}

	} );

	function styleIconBtn( btn ) {

		btn.dom.style.width = '24px';
		btn.dom.style.height = '24px';
		btn.dom.style.padding = '0';
		btn.dom.style.display = 'flex';
		btn.dom.style.alignItems = 'center';
		btn.dom.style.justifyContent = 'center';

	}

	function currentFps() {

		return Math.max( 1, editor.activeFreecapcutAnim.fps || 30 );

	}

	function frameToTime( f ) {

		return f / currentFps();

	}

	function timeToFrame( t ) {

		return t * currentFps();

	}

	function frameBounds() {

		const f0 = Math.round( timeToFrame( rangeStartTime() ) );
		const f1 = Math.max( f0, Math.round( timeToFrame( rangeEndTime() ) ) );
		return { f0, f1 };

	}

	function snapTimeToFrame( t ) {

		const { f0, f1 } = frameBounds();
		let f = Math.round( timeToFrame( t ) );
		if ( f < f0 ) f = f0;
		if ( f > f1 ) f = f1;
		return frameToTime( f );

	}

	function laneXForFrame( frame, metrics ) {

		const f0 = timeToFrame( metrics.t0 );
		const f1 = timeToFrame( metrics.t1 );
		const span = Math.max( 1e-6, f1 - f0 );
		return ( ( frame - f0 ) / span ) * metrics.timelineWidth;

	}

	function rangeStartTime() {

		return frameToTime( frameStart );

	}

	function rangeEndTime() {

		return Math.max( rangeStartTime() + 1 / currentFps(), editor.activeFreecapcutAnim.duration || 1 );

	}

	function clipDuration() {

		return Math.max( 0.01, editor.activeFreecapcutAnim.duration || 1 );

	}

	function syncFrameInputsFromClip() {

		const fps = currentFps();
		const end = Math.max( frameStart + 1, Math.round( clipDuration() * fps ) );
		startFrameInput.setValue( frameStart );
		endFrameInput.setValue( end );
		fpsSelect.setValue( String( fps ) );
		loopSelect.setValue( editor.activeFreecapcutAnim.loop === 'loop' ? 'loop' : 'clamp' );
		nameInput.setValue( editor.activeFreecapcutAnim.name || 'Animation' );
		titleText.textContent = ( strings.getKey( 'animation/title' ) || '\u52a8\u753b' ) + ' — ' + ( editor.activeFreecapcutAnim.name || '' );

	}

	function timelineMetrics() {

		const area = timelineArea.getBoundingClientRect();
		const lane = rulerCanvasHost.getBoundingClientRect();
		const timelineWidth = Math.max( 1, lane.width );
		return {
			rect: area,
			laneLeft: lane.left,
			laneOffset: lane.left - area.left,
			timelineWidth,
			t0: rangeStartTime(),
			t1: rangeEndTime(),
		};

	}

	function updateTimeFromPosition( clientX ) {

		const { laneLeft, timelineWidth, t0, t1 } = timelineMetrics();
		const x = Math.max( 0, Math.min( clientX - laneLeft, timelineWidth ) );
		const span = Math.max( 1e-6, t1 - t0 );
		playTime = snapTimeToFrame( t0 + ( x / timelineWidth ) * span );
		// Timeline drag: pause Blender mixer so scrubThreeClip can pose bones
		if ( isThreeClipPreviewHeld( editor ) && editor._threeClipPreview && editor._threeClipPreview.action ) {

			editor._threeClipPreview.action.paused = true;

		}
		applyAndRefresh();

	}

		function paintKeySelection() {

		trackListContainer.querySelectorAll( '.anim-key' ).forEach( ( el ) => {

			const sel = isKeySelected( el.dataset.targetUuid, el.dataset.path, parseInt( el.dataset.keyIndex, 10 ) );
			el.style.outline = sel ? '2px solid #ffeb3b' : 'none';
			el.style.outlineOffset = sel ? '1px' : '';

		} );

	}

	function updateMarquee( clientX, clientY ) {

		const area = timelineArea.getBoundingClientRect();
		const left = Math.min( marqueeStartX, clientX ) - area.left;
		const top = Math.min( marqueeStartY, clientY ) - area.top;
		const width = Math.abs( clientX - marqueeStartX );
		const height = Math.abs( clientY - marqueeStartY );
		marqueeEl.style.display = 'block';
		marqueeEl.style.left = left + 'px';
		marqueeEl.style.top = top + 'px';
		marqueeEl.style.width = width + 'px';
		marqueeEl.style.height = height + 'px';

		const selRect = {
			left: Math.min( marqueeStartX, clientX ),
			top: Math.min( marqueeStartY, clientY ),
			right: Math.max( marqueeStartX, clientX ),
			bottom: Math.max( marqueeStartY, clientY )
		};
		const hit = [];
		trackListContainer.querySelectorAll( '.anim-key' ).forEach( ( el ) => {

			const r = el.getBoundingClientRect();
			const cx = ( r.left + r.right ) * 0.5;
			const cy = ( r.top + r.bottom ) * 0.5;
			if ( cx >= selRect.left && cx <= selRect.right && cy >= selRect.top && cy <= selRect.bottom ) {

				hit.push( {
					targetUuid: el.dataset.targetUuid,
					path: el.dataset.path,
					keyIndex: parseInt( el.dataset.keyIndex, 10 )
				} );

			}

		} );
		if ( marqueeAdditive ) {

			const map = new Map();
			for ( const s of marqueeBaseSelection ) map.set( s.targetUuid + '\0' + s.path + '\0' + s.keyIndex, s );
			for ( const s of hit ) map.set( s.targetUuid + '\0' + s.path + '\0' + s.keyIndex, s );
			selectedKeys = Array.from( map.values() );

		} else {

			selectedKeys = hit;

		}
		paintKeySelection();

	}

	function snapshotSelectedKeyDragGroup() {

		const clip = editor.activeFreecapcutAnim;
		const group = [];
		const diamonds = Array.from( trackListContainer.querySelectorAll( '.anim-key' ) );
		for ( const s of selectedKeys ) {

			const target = ( clip.targets || [] ).find( ( t ) => t.objectUuid === s.targetUuid );
			if ( ! target ) continue;
			const track = ( target.tracks || [] ).find( ( tr ) => tr.path === s.path );
			if ( ! track || ! track.keys[ s.keyIndex ] ) continue;
			const keyObj = track.keys[ s.keyIndex ];
			const el = diamonds.find( ( d ) =>
				d.dataset.targetUuid === s.targetUuid
				&& d.dataset.path === s.path
				&& d.dataset.keyIndex === String( s.keyIndex )
			) || null;
			group.push( {
				targetUuid: s.targetUuid,
				path: s.path,
				keyIndex: s.keyIndex,
				originT: keyObj.t,
				keyObj,
				track,
				el
			} );

		}
		return group;

	}

	function commitDraggedKeys() {

		if ( ! dragKeyRef || ! Array.isArray( dragKeyRef.group ) ) return;
		const seen = new Set();
		for ( const g of dragKeyRef.group ) {

			if ( ! g.track || seen.has( g.track ) ) continue;
			seen.add( g.track );
			g.track.keys.sort( ( a, b ) => a.t - b.t );

		}
		selectedKeys = dragKeyRef.group.map( ( g ) => ( {
			targetUuid: g.targetUuid,
			path: g.path,
			keyIndex: Math.max( 0, g.track.keys.indexOf( g.keyObj ) )
		} ) );

	}

	function moveDraggedKey( clientX ) {

		if ( ! dragKeyRef || ! Array.isArray( dragKeyRef.group ) || dragKeyRef.group.length === 0 ) return;
		const { laneLeft, timelineWidth, t0, t1 } = timelineMetrics();
		const x = Math.max( 0, Math.min( clientX - laneLeft, timelineWidth ) );
		const span = Math.max( 1e-6, t1 - t0 );
		const t = snapTimeToFrame( t0 + ( x / timelineWidth ) * span );
		const delta = t - dragKeyRef.originT;
		const f0 = timeToFrame( t0 );
		const f1 = timeToFrame( t1 );
		// CapCut-like: move all selected keys by the same delta; do NOT scrub playTime / playhead.
		for ( const g of dragKeyRef.group ) {

			const nt = snapTimeToFrame( Math.max( 0, g.originT + delta ) );
			g.keyObj.t = nt;
			const diamond = g.el;
			if ( diamond && diamond.isConnected ) {

				const frame = Math.round( timeToFrame( nt ) );
				const pct = ( ( frame - f0 ) / Math.max( 1e-6, f1 - f0 ) ) * 100;
				diamond.style.left = pct + '%';
				diamond.title = nt.toFixed( 3 ) + 's (f' + timeToFrame( nt ).toFixed( 1 ) + ') = ' + Number( g.keyObj.v ).toFixed( 3 )
					+ ( g.keyObj.ease ? ' · ' + ( ANIM_EASE_LABELS_ZH[ g.keyObj.ease ] || g.keyObj.ease ) : '' );

			}

		}

	}

	function isKeySelected( targetUuid, path, keyIndex ) {

		return selectedKeys.some( ( s ) => s.targetUuid === targetUuid && s.path === path && s.keyIndex === keyIndex );

	}


	function chooseTickStep( frameSpan, pixelWidth ) {

		const targetPx = 48; // aim ~one major label every 48px
		const rough = Math.max( 1, frameSpan * targetPx / Math.max( 1, pixelWidth ) );
		const nice = [ 1, 2, 5, 10, 15, 20, 30, 60, 90, 120, 150, 300, 600, 900, 1200, 1800, 3600 ];
		for ( let i = 0; i < nice.length; i ++ ) {

			if ( nice[ i ] >= rough ) return nice[ i ];

		}
		return Math.ceil( rough / 100 ) * 100;

	}

	function drawFrameRuler() {

		const { timelineWidth, t0, t1 } = timelineMetrics();
		const dpr = window.devicePixelRatio || 1;
		const cssW = Math.max( 1, Math.floor( timelineWidth ) );
		const cssH = RULER_H;
		if ( rulerCanvas.width !== Math.floor( cssW * dpr ) || rulerCanvas.height !== Math.floor( cssH * dpr ) ) {

			rulerCanvas.width = Math.floor( cssW * dpr );
			rulerCanvas.height = Math.floor( cssH * dpr );

		}
		rulerCanvas.style.width = cssW + 'px';
		rulerCanvas.style.height = cssH + 'px';
		const ctx = rulerCanvas.getContext( '2d' );
		if ( ! ctx ) return;
		ctx.setTransform( dpr, 0, 0, dpr, 0, 0 );
		ctx.clearRect( 0, 0, cssW, cssH );

		const f0 = timeToFrame( t0 );
		const f1 = timeToFrame( t1 );
		const span = Math.max( 1e-6, f1 - f0 );
		const major = chooseTickStep( span, cssW );
		let minor = major / 5;
		if ( minor < 1 ) minor = 1;
		if ( major <= 5 ) minor = 1;
		else if ( major <= 10 ) minor = 2;

		const frameToX = ( f ) => ( ( f - f0 ) / span ) * cssW;

		ctx.strokeStyle = '#555';
		ctx.fillStyle = '#aaa';
		ctx.font = '10px sans-serif';
		ctx.textAlign = 'center';
		ctx.textBaseline = 'top';

		const startMinor = Math.floor( f0 / minor ) * minor;
		for ( let f = startMinor; f <= f1 + 1e-6; f += minor ) {

			if ( f < f0 - 1e-6 ) continue;
			const x = frameToX( f );
			if ( x < -1 || x > cssW + 1 ) continue;
			const isMajor = Math.abs( ( f / major ) - Math.round( f / major ) ) < 1e-6
				|| Math.abs( f - Math.round( f / major ) * major ) < 1e-4;
			const h = isMajor ? 12 : 6;
			ctx.beginPath();
			ctx.moveTo( x + 0.5, cssH - h );
			ctx.lineTo( x + 0.5, cssH );
			ctx.strokeStyle = isMajor ? '#888' : '#444';
			ctx.stroke();
			if ( isMajor ) {

				const label = String( Math.round( f ) );
				// Keep labels inside
				const tw = ctx.measureText( label ).width;
				let lx = x;
				if ( lx < tw / 2 + 1 ) lx = tw / 2 + 1;
				if ( lx > cssW - tw / 2 - 1 ) lx = cssW - tw / 2 - 1;
				ctx.fillStyle = '#ccc';
				ctx.fillText( label, lx, 2 );

			}

		}

	}

	function applyAndRefresh() {

		const clip = editor.activeFreecapcutAnim;
		const t = snapTimeToFrame( mapAnimTime( playTime, clip.duration, clip.loop ) );
		// Avoid fighting: while THREE (Blender) preview is held, skip FreeFilmCut sampling.
		// Only scrub the mixer when it is paused (timeline drag); autonomous play is driven by Viewport.
		if ( isThreeClipPreviewHeld( editor ) ) {

			const st = editor._threeClipPreview;
			if ( st && st.action && st.action.paused ) {

				scrubThreeClip( editor, t );

			}

		} else {

			// Apply every per-object clip so each object plays its own tracks
			applyAllEditorAnims( editor, editor.scene, t );

		}
		const frRound = Math.round( timeToFrame( t ) );
		const endFr = frameBounds().f1;
		const prefix = strings.getKey( 'animation/currentFrame' ) || '\u5f53\u524d\u5e27';
		frameLabelPrefix.textContent = prefix + ':';
		timeText.textContent = frRound + ' / ' + endFr;
		const metrics = timelineMetrics();
		const phLeft = metrics.laneOffset + laneXForFrame( frRound, metrics );
		playhead.style.left = ( phLeft - 1 ) + 'px';
		playheadBadge.textContent = String( frRound );
		playheadBadge.style.left = phLeft + 'px';
		drawFrameRuler();
		// Live scrub / key-drag / play: pose + viewport render only.
		// objectChanged / sceneGraphChanged rebuild sidebars & outliner every tick → lag + Chrome Issues flood.
		const livePreview = isScrubbing || isDraggingKey || playing;
		if ( livePreview ) {

			if ( signals.animationSampled ) signals.animationSampled.dispatch();
			else signals.sceneGraphChanged.dispatch();

		} else {

			if ( editor.selected ) signals.objectChanged.dispatch( editor.selected );
			signals.sceneGraphChanged.dispatch();

		}

	}

	function tick() {

		if ( ! playing ) return;
		const now = performance.now();
		const dt = Math.min( 0.1, ( now - lastTs ) / 1000 );
		lastTs = now;
		playTime += dt;
		const clip = editor.activeFreecapcutAnim;
		const t0 = rangeStartTime();
		const t1 = rangeEndTime();
		if ( clip.loop === 'loop' ) {

			const span = Math.max( 1e-6, t1 - t0 );
			if ( playTime > t1 ) playTime = t0 + ( ( playTime - t0 ) % span );
			if ( playTime < t0 ) playTime = t0;

		} else if ( playTime >= t1 ) {

			playTime = t1;
			playing = false;
			playButton.dom.innerHTML = playIcon;

		}
		applyAndRefresh();
		if ( playing ) requestAnimationFrame( tick );

	}


	function markClipForExport( clip ) {

		if ( ! clip ) return;
		clip._export = true;
		if ( ! editor.freecapcutAnims ) editor.freecapcutAnims = [];
		const idx = editor.freecapcutAnims.findIndex( ( a ) => a === clip || ( a && a.name === clip.name ) );
		if ( idx >= 0 ) editor.freecapcutAnims[ idx ] = clip;
		else editor.freecapcutAnims.push( clip );

	}

	function addKeysForSelected() {

		const object = editor.selected;
		if ( ! object || object === editor.scene ) {

			flash( strings.getKey( 'animation/needSelect' ) || '\u8bf7\u5148\u9009\u4e2d\u7269\u4f53' );
			return;

		}
		const items = listDefaultTransformKeys( object );
		if ( items.length === 0 ) {

			flash( '无可记录的变换' );
			return;

		}
		const clip = ensureObjectAnimClip( editor, object );
		const target = ensureTarget( clip, object.uuid );
		const t = snapTimeToFrame( mapAnimTime( playTime, clip.duration, clip.loop ) );
		for ( const item of items ) {

			if ( item.value === null || ! Number.isFinite( item.value ) ) continue;
			upsertKey( ensureTrack( target, item.path, 'linear' ), t, item.value );

		}
		recomputeDuration( clip );
		markClipForExport( clip );
		nameInput.setValue( clip.name || '' );
		if ( signals.objectChanged ) signals.objectChanged.dispatch( object );
		if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();
		syncFrameInputsFromClip();
		rebuildTracks();
		flash( isUIAnimTarget( object )
			? '已添加 UI 位置 / 旋转 / 缩放关键帧'
			: ( strings.getKey( 'animation/keyAdded' ) || '\u5df2\u6dfb\u52a0\u53d8\u6362\u5173\u952e\u5e27' ) );

	}

	function addMaterialKeysForSelected() {

		const object = editor.selected;
		if ( ! object || object === editor.scene ) {

			flash( strings.getKey( 'animation/needSelect' ) || '\u8bf7\u5148\u9009\u4e2d\u7269\u4f53' );
			return;

		}
		const paths = listMaterialKeyPaths( object );
		if ( paths.length === 0 ) {

			flash( strings.getKey( 'animation/noMatUniforms' ) || '\u65e0\u53ef\u5173\u952e\u6750\u8d28\u53c2\u6570' );
			return;

		}
		const clip = ensureObjectAnimClip( editor, object );
		const target = ensureTarget( clip, object.uuid );
		const t = snapTimeToFrame( mapAnimTime( playTime, clip.duration, clip.loop ) );
		for ( const item of paths ) {

			upsertKey( ensureTrack( target, item.path, item.interp || 'linear' ), t, item.value );

		}
		recomputeDuration( clip );
		markClipForExport( clip );
		nameInput.setValue( clip.name || '' );
		if ( signals.objectChanged ) signals.objectChanged.dispatch( object );
		if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();
		syncFrameInputsFromClip();
		rebuildTracks();
		flash( ( strings.getKey( 'animation/matKeyAdded' ) || '\u5df2\u6dfb\u52a0\u6750\u8d28\u5173\u952e\u5e27' ) + ' x' + paths.length );

	}

	function addTextAnimKeysForSelected( which ) {

		const object = editor.selected;
		const items = listTextAnimKeyPaths( object );
		const picked = which === TEXT_KEY_ALL_PROGRESS
			? items.filter( ( it ) => /\.progress$/.test( it.path ) )
			: items.filter( ( it ) => it.path === which );
		if ( picked.length === 0 ) {

			flash( '选中文字没有可关键帧的文字动画参数' );
			return;

		}
		const clip = ensureObjectAnimClip( editor, object );
		const target = ensureTarget( clip, object.uuid );
		const t = snapTimeToFrame( mapAnimTime( playTime, clip.duration, clip.loop ) );
		for ( const item of picked ) {

			upsertKey( ensureTrack( target, item.path, item.interp || 'linear' ), t, item.value );

		}
		recomputeDuration( clip );
		markClipForExport( clip );
		nameInput.setValue( clip.name || '' );
		syncFrameInputsFromClip();
		rebuildTracks();
		applyAndRefresh();
		flash( '已添加文字动画关键帧 x' + picked.length );

	}

	function refreshTextKeyOptions() {

		const object = editor.selected && editor.selected !== editor.scene ? editor.selected : null;
		const items = object ? listTextAnimKeyPaths( object ) : [];
		const opts = { '': items.length ? '+ 文字动画关键帧' : '文字动画关键帧（选中带动画的文字）' };
		if ( items.length ) opts[ TEXT_KEY_ALL_PROGRESS ] = '全部组件 · 进度';
		for ( const it of items ) opts[ it.path ] = it.label;
		textKeySelect.setOptions( opts );
		textKeySelect.setValue( '' );
		textKeySelect.dom.disabled = items.length === 0;

	}

	/** @returns {{ track: object, key: object, path: string, targetUuid: string }|null} */
	function singleSelectedKey() {

		if ( selectedKeys.length !== 1 ) return null;
		const s = selectedKeys[ 0 ];
		const target = ( editor.activeFreecapcutAnim.targets || [] ).find( ( t ) => t && t.objectUuid === s.targetUuid );
		const track = target && ( target.tracks || [] ).find( ( tr ) => tr.path === s.path );
		const key = track && track.keys[ s.keyIndex ];
		return key ? { track, key, path: s.path, targetUuid: s.targetUuid } : null;

	}

	function refreshKeyInspector() {

		const sel = singleSelectedKey();
		if ( ! sel ) {

			keyInspector.style.display = 'none';
			return;

		}
		keyInspector.style.display = 'inline-flex';
		const obj = editor.scene.getObjectByProperty( 'uuid', sel.targetUuid );
		let label = uiTrackLabel( sel.path );
		let range = [ - 1e6, 1e6 ];
		if ( isTextAnimPath( sel.path ) ) {

			const info = textAnimTrackInfo( obj, sel.path );
			label = info.label;
			if ( info.range ) range = info.range;

		}
		keyInspectorLabel.textContent = label;
		keyInspectorLabel.title = sel.path;
		keyValueInput.setRange( range[ 0 ], range[ 1 ] );
		keyValueInput.setValue( sel.key.v );
		const isStepTrack = sel.track.interp === 'step';
		keyEaseSelect.setValue( isStepTrack ? 'step' : ( sel.key.ease || 'linear' ) );
		keyEaseSelect.dom.disabled = isStepTrack;

	}

	function deleteSelectedKeys() {

		if ( selectedKeys.length === 0 ) return;
		const clip = editor.activeFreecapcutAnim;
		// Delete high indices first per track
		const byTrack = new Map();
		for ( const s of selectedKeys ) {

			const k = s.targetUuid + '\0' + s.path;
			if ( ! byTrack.has( k ) ) byTrack.set( k, [] );
			byTrack.get( k ).push( s );

		}
		for ( const group of byTrack.values() ) {

			group.sort( ( a, b ) => b.keyIndex - a.keyIndex );
			const target = ( clip.targets || [] ).find( ( t ) => t.objectUuid === group[ 0 ].targetUuid );
			if ( ! target ) continue;
			const track = ( target.tracks || [] ).find( ( tr ) => tr.path === group[ 0 ].path );
			if ( ! track ) continue;
			for ( const s of group ) {

				if ( s.keyIndex >= 0 && s.keyIndex < track.keys.length ) track.keys.splice( s.keyIndex, 1 );

			}
			// Drop empty tracks
			if ( track.keys.length === 0 ) {

				target.tracks = target.tracks.filter( ( tr ) => tr !== track );

			}

		}
		clip.targets = ( clip.targets || [] ).filter( ( t ) => t.tracks && t.tracks.length > 0 );
		selectedKeys = [];
		recomputeDuration( clip );
		markClipForExport( clip );
		syncFrameInputsFromClip();
		rebuildTracks();
		flash( strings.getKey( 'animation/keyDeleted' ) || '\u5df2\u5220\u9664' );

	}

	function rebuildTracks() {

		trackListContainer.innerHTML = '';
		const clip = editor.activeFreecapcutAnim;
		const selectedObj = editor.selected && editor.selected !== editor.scene ? editor.selected : null;
		let targets = Array.isArray( clip.targets ) ? clip.targets.slice() : [];
		// Prefer showing only the selected object's tracks (per-object authoring)
		if ( selectedObj ) {

			// Always scope the editor view to the selected object
			targets = targets.filter( ( t ) => t && t.objectUuid === selectedObj.uuid );

		}
		const header = document.createElement( 'div' );
		header.style.cssText = 'padding:4px 10px;font-size:11px;color:#aaa;';
		const selLabel = selectedObj ? ( selectedObj.name || 'Object' ) : '';
		header.textContent = ( clip.name || 'Animation' )
			+ ( selLabel ? ( ' @ ' + selLabel ) : '' )
			+ ' · ' + targets.length + ' targets'
			+ ( ( editor.freecapcutAnims && editor.freecapcutAnims.length > 1 )
				? ( ' · ' + editor.freecapcutAnims.length + ' clips' )
				: '' );
		trackListContainer.appendChild( header );
		drawFrameRuler();
		refreshTextKeyOptions();
		refreshKeyInspector();

		const { t0, t1 } = timelineMetrics();

		for ( const target of targets ) {

			const obj = editor.scene.getObjectByProperty( 'uuid', target.objectUuid );
			const objName = obj ? ( obj.name || 'Object' ) : target.objectUuid.slice( 0, 8 );

			for ( const track of target.tracks || [] ) {

				const row = document.createElement( 'div' );
				row.style.cssText = 'display:flex;align-items:center;height:22px;border-bottom:1px solid #2a2a2a;';

				const label = document.createElement( 'div' );
				label.style.cssText = 'width:' + LABEL_W + 'px;padding:0 8px;box-sizing:border-box;font-size:10px;color:#bbb;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;flex-shrink:0;';
				label.textContent = objName + '.' + uiTrackLabel( track.path );
				label.title = target.objectUuid + ' / ' + track.path;
				if ( isTextAnimPath( track.path ) ) {

					const info = textAnimTrackInfo( obj, track.path );
					label.textContent = objName + ' · ' + info.label;
					if ( info.missing ) {

						label.style.color = '#f66';
						label.title += '（组件或参数已不存在，此轨道被忽略）';

					}

				}
				row.appendChild( label );

				const tl = document.createElement( 'div' );
				tl.style.cssText = 'flex:1;height:100%;position:relative;background:rgba(255,255,255,0.03);';

				( track.keys || [] ).forEach( ( k, keyIndex ) => {

					k.t = snapTimeToFrame( k.t );
					const frame = Math.round( timeToFrame( k.t ) );
					const f0 = timeToFrame( t0 );
					const f1 = timeToFrame( t1 );
					const pct = ( ( frame - f0 ) / Math.max( 1e-6, f1 - f0 ) ) * 100;
					const diamond = document.createElement( 'div' );
					diamond.className = 'anim-key';
					diamond.dataset.targetUuid = target.objectUuid;
					diamond.dataset.path = track.path;
					diamond.dataset.keyIndex = String( keyIndex );
					const selected = isKeySelected( target.objectUuid, track.path, keyIndex );
					const color = ( track.path.startsWith( 'position' ) || track.path.startsWith( 'ui.anchoredPosition' ) ) ? '#4CAF50'
						: ( track.path.startsWith( 'rotation' ) || track.path.startsWith( 'ui.localEulerAngles' ) ) ? '#2196F3'
						: track.path.startsWith( 'material' ) || track.path.startsWith( 'postProcess' ) ? '#9C27B0'
						: isTextAnimPath( track.path ) ? '#E91E63'
						: '#FF9800';
					// Step keys (track interp or key ease) are drawn as squares.
					const stepKey = track.interp === 'step' || k.ease === 'step';
					diamond.style.cssText = [
						'position:absolute',
						'left:' + pct + '%',
						'top:50%',
						'width:9px',
						'height:9px',
						'margin-left:-4px',
						'margin-top:-4px',
						'background:' + color,
						stepKey ? 'transform:none' : 'transform:rotate(45deg)',
						'cursor:pointer',
						'z-index:5',
						'box-sizing:border-box',
						selected ? 'outline:2px solid #ffeb3b;outline-offset:1px' : 'outline:none',
					].join( ';' );
					diamond.title = k.t.toFixed( 3 ) + 's (f' + timeToFrame( k.t ).toFixed( 1 ) + ') = ' + k.v.toFixed( 3 )
						+ ( k.ease ? ' · ' + ( ANIM_EASE_LABELS_ZH[ k.ease ] || k.ease ) : '' );
					diamond.addEventListener( 'mousedown', function ( ev ) {

						ev.preventDefault();
						ev.stopPropagation();
						playing = false;
						playButton.dom.innerHTML = playIcon;
						const additive = !!( ev.shiftKey || ev.ctrlKey || ev.metaKey );
						// Live check — do NOT use rebuildTracks-time `selected` closure (stale after marquee).
						const liveKeyIndex = parseInt( diamond.dataset.keyIndex, 10 );
						const idx = Number.isFinite( liveKeyIndex ) ? liveKeyIndex : keyIndex;
						const currentlySelected = isKeySelected( target.objectUuid, track.path, idx );
						if ( additive ) {

							if ( currentlySelected ) {

								selectedKeys = selectedKeys.filter( ( s ) => !( s.targetUuid === target.objectUuid && s.path === track.path && s.keyIndex === idx ) );

							} else {

								selectedKeys.push( { targetUuid: target.objectUuid, path: track.path, keyIndex: idx } );

							}

						} else if ( ! currentlySelected ) {

							// Click unselected key: select only that one.
							selectedKeys = [ { targetUuid: target.objectUuid, path: track.path, keyIndex: idx } ];

						}
						// Click already-selected key (no modifier): keep multi-select and drag all.
						paintKeySelection();
						refreshKeyInspector();
						isDraggingKey = true;
						const originKey = track.keys[ idx ] || k;
						dragKeyRef = {
							targetUuid: target.objectUuid,
							path: track.path,
							keyIndex: idx,
							originT: originKey.t,
							el: diamond,
							group: snapshotSelectedKeyDragGroup()
						};
						// Do NOT set playTime / applyAndRefresh here — playhead stays put.

					} );
					tl.appendChild( diamond );

				} );
				row.appendChild( tl );
				trackListContainer.appendChild( row );

			}

		}

	}

	function flash( msg ) {

		statusText.textContent = msg || '';
		setTimeout( function () { statusText.textContent = ''; }, 1800 );

	}

	async function saveAnimToProject() {

		const clip = editor.activeFreecapcutAnim;
		recomputeDuration( clip );
		clip.name = nameInput.getValue() || clip.name;
		clip.loop = loopSelect.getValue() === 'loop' ? 'loop' : 'clamp';
		const json = JSON.stringify( clip, null, 2 );
		const safe = String( clip.name || 'Animation' ).replace( /[<>:"/\\|?*\s]+/g, '_' ).slice( 0, 48 ) || 'Animation';
		const filename = safe + '.anim';
		const pf = editor.projectFolder;
		if ( pf && typeof pf.hasFolder === 'function' && pf.hasFolder() && typeof pf.saveBlob === 'function' ) {

			try {

				await pf.saveBlob( 'assets/animations', filename, json );
				const rel = 'assets/animations/' + filename;
				if ( ! editor.freecapcutAnims.find( ( a ) => a.name === clip.name ) ) editor.freecapcutAnims.push( clip );
				clip._projectPath = rel;
				clip._export = true;
				flash( ( strings.getKey( 'animation/saved' ) || '\u5df2\u4fdd\u5b58' ) + ': ' + rel );
				return;

			} catch ( err ) {

				console.warn( '[FreeFilmCut] save .anim failed', err );

			}

		}
		const blob = new Blob( [ json ], { type: 'application/json' } );
		const a = document.createElement( 'a' );
		a.href = URL.createObjectURL( blob );
		a.download = filename;
		a.click();
		URL.revokeObjectURL( a.href );
		flash( strings.getKey( 'animation/downloaded' ) || '\u5df2\u4e0b\u8f7d .anim' );

	}

	function loadAnimFromFile() {

		const input = document.createElement( 'input' );
		input.type = 'file';
		input.accept = '.anim,application/json';
		input.addEventListener( 'change', function () {

			const file = input.files && input.files[ 0 ];
			if ( ! file ) return;
			const reader = new FileReader();
			reader.onload = function () {

				try {

					const raw = JSON.parse( String( reader.result || '{}' ) );
					editor.activeFreecapcutAnim = normalizeAnim( raw );
					markClipForExport( editor.activeFreecapcutAnim );
					frameStart = 0;
					playTime = 0;
					selectedKeys = [];
					syncFrameInputsFromClip();
					rebuildTracks();
					applyAndRefresh();
					flash( strings.getKey( 'animation/loaded' ) || '\u5df2\u52a0\u8f7d' );

				} catch ( err ) {

					flash( 'JSON error' );
					console.warn( err );

				}

			};
			reader.readAsText( file );

		} );
		input.click();

	}

	function savePos() {

		try {

			editor._animWinPos = {
				left: root.style.left,
				top: root.style.top,
				width: root.style.width,
				height: root.style.height,
			};

		} catch ( e ) { /* ignore */ }

	}

	function restorePos() {

		const p = editor._animWinPos;
		if ( ! p ) return;
		if ( p.left ) root.style.left = p.left;
		if ( p.top ) root.style.top = p.top;
		if ( p.width ) root.style.width = p.width;
		if ( p.height ) root.style.height = p.height;

	}

	function setPanelVisible( visible ) {

		panelVisible = !! visible;
		if ( panelVisible ) {

			root.style.display = 'flex';
			restorePos();
			syncFrameInputsFromClip();
			refreshThreeClipUI();
			rebuildTracks();
			applyAndRefresh();
			// Floating: never shrink viewport
			signals.animationPanelChanged.dispatch( false );
			const resizer = document.getElementById( 'animation-resizer' );
			if ( resizer ) resizer.style.display = 'none';

		} else {

			playing = false;
			playButton.dom.innerHTML = playIcon;
			root.style.display = 'none';
			savePos();
			signals.animationPanelChanged.dispatch( false );

		}

	}

	editor.toggleAnimationPanel = function () {

		setPanelVisible( ! panelVisible );

	};

	editor.openAnimationPanel = function () {

		setPanelVisible( true );

	};

	editor.isAnimationPanelOpen = function () {

		return panelVisible;

	};

	editor.getAnimPreviewTime = function () {

		return playTime;

	};

	/** Re-sample all clips at the playhead and redraw tracks (after outside key edits). */
	editor.refreshAnimPanel = function () {

		syncFrameInputsFromClip();
		rebuildTracks();
		applyAndRefresh();

	};


	signals.objectSelected.add( function ( object ) {

		if ( ! panelVisible ) return;
		refreshThreeClipUI();
		if ( ! object || object === editor.scene ) {

			rebuildTracks();
			return;

		}
		const clip = switchActiveAnimToObject( editor, object );
		if ( clip ) {

			selectedKeys = selectedKeys.filter( ( s ) => s.targetUuid === object.uuid );
			nameInput.setValue( clip.name || '' );
			syncFrameInputsFromClip();
			rebuildTracks();
			applyAndRefresh();

		} else {

			rebuildTracks();

		}

	} );

	signals.freecapcutAnimsChanged.add( function () {

		if ( ! editor.activeFreecapcutAnim ) {

			editor.activeFreecapcutAnim = createEmptyAnim( 'Animation', 30 );

		}
		migratePendingTextAnimTimes( editor );
		playing = false;
		playButton.dom.innerHTML = playIcon;
		playTime = Number( editor.pendingAnimPreviewTime ) || 0;
		editor.pendingAnimPreviewTime = 0;
		frameStart = 0;
		selectedKeys = [];
		syncFrameInputsFromClip();
		rebuildTracks();
		applyAndRefresh();
		flash( strings.getKey( 'animation/restored' ) || '\u5df2\u6062\u590d\u52a8\u753b' );

	} );

	// Pasted / imported Texts may still carry textanim/2 time windows. Project
	// load is handled by freecapcutAnimsChanged: clips restored after setScene()
	// replace editor.freecapcutAnims, so keys written now would be lost.
	signals.objectAdded.add( function ( object ) {

		if ( editor.isLoadingState ) return;
		if ( migratePendingTextAnimTimes( editor, object ) ) {

			rebuildTracks();
			applyAndRefresh();

		}

	} );

	signals.editorCleared.add( function () {

		playing = false;
		stopThreeClipPreview( editor );
		editor.activeFreecapcutAnim = createEmptyAnim( 'Animation', 30 );
		editor.freecapcutAnims = [];
		frameStart = 0;
		playTime = 0;
		selectedKeys = [];
		syncFrameInputsFromClip();
		rebuildTracks();

	} );

	// Start closed — open via View → 动画
	setPanelVisible( false );
	syncFrameInputsFromClip();

	return container;

}

export { Animation };
