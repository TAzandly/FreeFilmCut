/**
 * Dedicated sticker-animation editor. Does not write object .anim or timeline tracks.
 */

import { UIPanel } from '../libs/ui.js';
import {
	STICKER_MOTION_PATHS,
	createEmptyStickerMotion,
	normalizeStickerMotion,
	sampleStickerMotion,
} from './StickerMotion.js?v=fcc-ui-106';

const PATH_META = {
	'sticker.opacity': { en: 'Opacity', zh: '透明度', step: 0.01, color: '#E8E8E8' },
	'sticker.scale': { en: 'Scale', zh: '缩放', step: 0.01, color: '#FF9800' },
	'sticker.rotate': { en: 'Rotate', zh: '旋转', step: 1, color: '#2196F3' },
	'sticker.positionX': { en: 'Position X', zh: '位移 X', step: 0.01, color: '#4CAF50' },
	'sticker.positionY': { en: 'Position Y', zh: '位移 Y', step: 0.01, color: '#8BC34A' },
};

const DEFAULTS = {
	'sticker.opacity': 1,
	'sticker.scale': 1,
	'sticker.rotate': 0,
	'sticker.positionX': 0,
	'sticker.positionY': 0,
};

const LABEL_W = 118;
const MIN_W = 520;
const MIN_H = 280;

function StickerMotionPanel( editor ) {

	const signals = editor.signals;
	const strings = editor.strings;
	const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
	const zh = lang === 'zh';
	const T = ( zhText, enText ) => ( zh ? zhText : enText );

	const container = new UIPanel();
	container.setId( 'sticker-motion' );
	const root = container.dom;
	root.style.cssText = [
		'display:none',
		'position:fixed',
		'left:96px',
		'top:120px',
		'width:760px',
		'height:420px',
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

	let panelVisible = false;
	let playing = false;
	let playTime = 0;
	let writing = false;
	let isDraggingWin = false;
	let isResizing = false;
	let isScrubbing = false;
	let isDraggingKey = false;
	let dragOffX = 0;
	let dragOffY = 0;
	let resizeStartX = 0;
	let resizeStartY = 0;
	let resizeStartW = 0;
	let resizeStartH = 0;
	let dragKey = null;
	/** @type {{ path: string, index: number }|null} */
	let selected = null;

	if ( ! editor.stickerMotion ) editor.stickerMotion = createEmptyStickerMotion();

	const titleBar = document.createElement( 'div' );
	titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#2a2a2a;border-bottom:1px solid #444;cursor:move;user-select:none;flex-shrink:0;';
	const title = document.createElement( 'div' );
	title.textContent = strings.getKey( 'stickerMotion/title' );
	title.style.fontWeight = '600';
	titleBar.appendChild( title );
	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.textContent = '\u00d7';
	closeBtn.style.cssText = 'width:24px;height:24px;border:none;background:transparent;color:#ccc;font-size:18px;cursor:pointer;';
	closeBtn.addEventListener( 'click', ( e ) => {

		e.stopPropagation();
		setPanelVisible( false );

	} );
	titleBar.appendChild( closeBtn );
	titleBar.addEventListener( 'mousedown', ( e ) => {

		if ( e.button !== 0 || e.target === closeBtn ) return;
		isDraggingWin = true;
		const rect = root.getBoundingClientRect();
		dragOffX = e.clientX - rect.left;
		dragOffY = e.clientY - rect.top;
		e.preventDefault();

	} );
	root.appendChild( titleBar );

	const controls = document.createElement( 'div' );
	controls.style.cssText = 'display:flex;flex-wrap:wrap;gap:6px;align-items:center;padding:6px 10px;border-bottom:1px solid #333;background:#222;flex-shrink:0;';
	root.appendChild( controls );

	const sheetWrap = document.createElement( 'div' );
	sheetWrap.style.cssText = 'flex:1;min-height:0;overflow:auto;background:#1a1a1a;';
	root.appendChild( sheetWrap );

	const inspector = document.createElement( 'div' );
	inspector.style.cssText = 'display:flex;gap:8px;align-items:center;padding:6px 10px;border-top:1px solid #333;background:#222;flex-shrink:0;min-height:32px;';
	root.appendChild( inspector );

	const resizeHandle = document.createElement( 'div' );
	resizeHandle.style.cssText = 'position:absolute;right:0;bottom:0;width:14px;height:14px;cursor:nwse-resize;z-index:20;background:linear-gradient(135deg,transparent 50%,#666 50%);';
	resizeHandle.addEventListener( 'mousedown', ( e ) => {

		if ( e.button !== 0 ) return;
		isResizing = true;
		resizeStartX = e.clientX;
		resizeStartY = e.clientY;
		resizeStartW = root.offsetWidth;
		resizeStartH = root.offsetHeight;
		e.preventDefault();
		e.stopPropagation();

	} );
	root.appendChild( resizeHandle );

	function packType() {

		return editor.config && editor.config.getKey( 'project/vfxpack/type' );

	}

	function motion() {

		editor.stickerMotion = normalizeStickerMotion( editor.stickerMotion );
		return editor.stickerMotion;

	}

	function trackFor( path, clip ) {

		const source = clip || motion();
		return source.tracks.find( ( track ) => track.path === path ) || null;

	}

	function poseValue( path, time ) {

		const pose = sampleStickerMotion( motion(), time );
		if ( path === 'sticker.opacity' ) return pose.opacity;
		if ( path === 'sticker.scale' ) return pose.scale;
		if ( path === 'sticker.rotate' ) return pose.rotate;
		if ( path === 'sticker.positionX' ) return pose.positionX;
		return pose.positionY;

	}

	function rememberSelection( path, t ) {

		const track = trackFor( path );
		if ( ! track ) {

			selected = null;
			return;

		}
		let best = 0;
		let bestD = Infinity;
		track.keys.forEach( ( key, index ) => {

			const d = Math.abs( key.t - t );
			if ( d < bestD ) {

				bestD = d;
				best = index;

			}

		} );
		selected = { path, index: best };

	}

	function commit( next, keep ) {

		writing = true;
		editor.stickerMotion = normalizeStickerMotion( next );
		playTime = Math.min( playTime, editor.stickerMotion.duration );
		editor.stickerMotionTime = playTime;
		if ( keep ) rememberSelection( keep.path, keep.t );
		if ( editor.config ) editor.config.setKey( 'project/vfxpack/stickerAnimPhase', editor.stickerMotion.phase );
		if ( signals.stickerMotionChanged ) signals.stickerMotionChanged.dispatch();
		writing = false;
		rebuild();
		syncTimeline();
		if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();

	}

	function syncTimeline() {

		const clip = editor.stickerMotion;
		if ( ! clip || clip.playStickerTimeline === false ) return;
		const api = editor.fccTimelineEditor;
		if ( ! api || typeof api.scrubSceneTimeline !== 'function' ) return;
		api.scrubSceneTimeline( playTime, { playing, silent: true, loop: true } );

	}

	function setPanelVisible( visible ) {

		panelVisible = !! visible;
		editor.stickerMotionPreview = panelVisible && packType() === 'sticker-anim';
		root.style.display = panelVisible ? 'flex' : 'none';
		if ( ! panelVisible ) {

			playing = false;
			editor.advanceStickerMotion = null;
			savePos();

		} else {

			restorePos();

		}
		rebuild();
		if ( panelVisible ) syncTimeline();
		if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();

	}

	editor.toggleStickerAnimPanel = function () {

		setPanelVisible( ! panelVisible );

	};

	function makePlayhead() {

		const head = document.createElement( 'div' );
		head.dataset.playhead = '1';
		head.style.cssText = 'position:absolute;top:0;bottom:0;width:1px;background:#ffeb3b;pointer-events:none;z-index:4;';
		return head;

	}

	function paintPlayhead() {

		const clip = editor.stickerMotion;
		const dur = Math.max( 0.1, clip ? clip.duration : 0.5 );
		const pct = ( ( playTime / dur ) * 100 ) + '%';
		sheetWrap.querySelectorAll( '[data-playhead]' ).forEach( ( head ) => {

			head.style.left = pct;

		} );
		const timeLabel = controls.querySelector( '[data-sticker-time]' );
		if ( timeLabel ) timeLabel.textContent = playTime.toFixed( 2 ) + 's';

	}

	function advance( dt ) {

		if ( ! playing || ! panelVisible ) return false;
		const clip = motion();
		playTime += dt;
		if ( clip.loop === 'loop' ) {

			playTime = playTime % clip.duration;
			if ( playTime < 0 ) playTime += clip.duration;

		} else if ( playTime >= clip.duration ) {

			playTime = clip.duration;
			playing = false;
			editor.advanceStickerMotion = null;
			const play = controls.querySelector( '[data-sticker-play]' );
			if ( play ) play.textContent = strings.getKey( 'stickerMotion/play' );

		}
		editor.stickerMotionTime = playTime;
		syncTimeline();
		paintPlayhead();
		return true;

	}

	function timeFromClientX( clientX, lane ) {

		const clip = motion();
		const rect = lane.getBoundingClientRect();
		const u = rect.width > 0 ? ( clientX - rect.left ) / rect.width : 0;
		return Math.max( 0, Math.min( clip.duration, u * clip.duration ) );

	}

	function seek( t ) {

		const clip = motion();
		playTime = Math.max( 0, Math.min( clip.duration, t ) );
		editor.stickerMotionTime = playTime;
		paintPlayhead();
		syncTimeline();
		if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();

	}

	function selectedKey() {

		if ( ! selected ) return null;
		const track = trackFor( selected.path );
		if ( ! track || ! track.keys[ selected.index ] ) return null;
		return track.keys[ selected.index ];

	}

	function btn( label ) {

		const button = document.createElement( 'button' );
		button.type = 'button';
		button.textContent = label;
		button.style.cssText = 'padding:3px 8px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;cursor:pointer;';
		return button;

	}

	function rebuild() {

		controls.replaceChildren();
		sheetWrap.replaceChildren();
		inspector.replaceChildren();
		editor.stickerMotionTime = playTime;
		if ( packType() !== 'sticker-anim' ) {

			const note = document.createElement( 'div' );
			note.style.cssText = 'color:#aaa;padding:12px;';
			note.textContent = strings.getKey( 'stickerMotion/needType' );
			sheetWrap.appendChild( note );
			editor.stickerMotionPreview = false;
			return;

		}
		editor.stickerMotionPreview = panelVisible;
		const clip = motion();

		const phase = document.createElement( 'select' );
		phase.style.cssText = 'background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;';
		for ( const value of [ 'in', 'out', 'loop' ] ) {

			const opt = document.createElement( 'option' );
			opt.value = value;
			opt.textContent = value === 'in' ? 'In' : value === 'out' ? 'Out' : 'Loop';
			phase.appendChild( opt );

		}
		phase.value = clip.phase;
		phase.addEventListener( 'change', () => {

			commit( { ...motion(), phase: phase.value, loop: phase.value === 'loop' ? 'loop' : 'clamp' } );

		} );
		controls.appendChild( phase );

		const durLabel = document.createElement( 'span' );
		durLabel.textContent = T( '时长', 'Duration' );
		durLabel.style.color = '#888';
		controls.appendChild( durLabel );
		const dur = document.createElement( 'input' );
		dur.type = 'number';
		dur.min = '0.1';
		dur.step = '0.1';
		dur.value = String( clip.duration );
		dur.style.cssText = 'width:64px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;';
		dur.addEventListener( 'change', () => {

			commit( { ...motion(), duration: Math.max( 0.1, Number( dur.value ) || 0.5 ) } );

		} );
		controls.appendChild( dur );

		const play = btn( playing ? strings.getKey( 'stickerMotion/stop' ) : strings.getKey( 'stickerMotion/play' ) );
		play.dataset.stickerPlay = '1';
		play.addEventListener( 'click', () => {

			playing = ! playing;
			if ( playing && playTime >= motion().duration && motion().loop !== 'loop' ) playTime = 0;
			editor.stickerMotionTime = playTime;
			editor.advanceStickerMotion = playing ? advance : null;
			play.textContent = playing ? strings.getKey( 'stickerMotion/stop' ) : strings.getKey( 'stickerMotion/play' );
			syncTimeline();
			if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();

		} );
		controls.appendChild( play );

		const timeLabel = document.createElement( 'span' );
		timeLabel.dataset.stickerTime = '1';
		timeLabel.style.cssText = 'color:#ffeb3b;font-variant-numeric:tabular-nums;min-width:52px;';
		timeLabel.textContent = playTime.toFixed( 2 ) + 's';
		controls.appendChild( timeLabel );

		const toggleLabel = document.createElement( 'label' );
		toggleLabel.style.cssText = 'display:flex;align-items:center;gap:4px;margin-left:4px;';
		const toggle = document.createElement( 'input' );
		toggle.type = 'checkbox';
		toggle.checked = clip.playStickerTimeline !== false;
		toggle.addEventListener( 'change', () => {

			const on = toggle.checked;
			commit( { ...motion(), playStickerTimeline: on } );
			if ( ! on && editor.fccTimelineEditor && editor.fccTimelineEditor.scrubSceneTimeline ) {

				editor.fccTimelineEditor.scrubSceneTimeline( playTime, { playing: false, silent: true, loop: true } );

			}

		} );
		toggleLabel.appendChild( toggle );
		toggleLabel.appendChild( document.createTextNode( strings.getKey( 'stickerMotion/playTimeline' ) ) );
		controls.appendChild( toggleLabel );

		const addSelect = document.createElement( 'select' );
		addSelect.style.cssText = 'margin-left:auto;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;';
		const unused = STICKER_MOTION_PATHS.filter( ( path ) => ! trackFor( path, clip ) );
		for ( const path of unused ) {

			const opt = document.createElement( 'option' );
			opt.value = path;
			opt.textContent = zh ? PATH_META[ path ].zh : PATH_META[ path ].en;
			addSelect.appendChild( opt );

		}
		const addBtn = btn( T( '添加参数', 'Add parameter' ) );
		addBtn.disabled = unused.length === 0;
		addBtn.addEventListener( 'click', () => {

			const path = addSelect.value;
			if ( ! path ) return;
			const next = normalizeStickerMotion( motion() );
			let found = next.tracks.find( ( track ) => track.path === path );
			if ( ! found ) {

				found = { path, interp: 'linear', keys: [] };
				next.tracks.push( found );

			}
			const t = playTime;
			found.keys.push( { t, v: poseValue( path, t ) } );
			commit( next, { path, t } );

		} );
		if ( unused.length ) controls.appendChild( addSelect );
		controls.appendChild( addBtn );

		const sheet = document.createElement( 'div' );
		sheet.style.cssText = 'min-width:480px;';

		const rulerRow = document.createElement( 'div' );
		rulerRow.style.cssText = 'display:flex;height:22px;border-bottom:1px solid #333;position:sticky;top:0;background:#1e1e1e;z-index:3;';
		const rulerLabel = document.createElement( 'div' );
		rulerLabel.style.cssText = 'width:' + LABEL_W + 'px;flex-shrink:0;';
		rulerRow.appendChild( rulerLabel );
		const ruler = document.createElement( 'div' );
		ruler.dataset.lane = '1';
		ruler.style.cssText = 'flex:1;position:relative;cursor:ew-resize;';
		const steps = Math.max( 2, Math.round( clip.duration / 0.25 ) );
		for ( let i = 0; i <= steps; i ++ ) {

			const tick = document.createElement( 'div' );
			const t = ( clip.duration * i ) / steps;
			tick.textContent = t.toFixed( 2 );
			tick.style.cssText = 'position:absolute;top:4px;left:' + ( ( i / steps ) * 100 ) + '%;transform:translateX(-50%);font-size:10px;color:#888;pointer-events:none;';
			ruler.appendChild( tick );

		}
		ruler.appendChild( makePlayhead() );
		ruler.addEventListener( 'mousedown', ( e ) => {

			if ( e.button !== 0 ) return;
			isScrubbing = true;
			playing = false;
			editor.advanceStickerMotion = null;
			const playBtn = controls.querySelector( '[data-sticker-play]' );
			if ( playBtn ) playBtn.textContent = strings.getKey( 'stickerMotion/play' );
			seek( timeFromClientX( e.clientX, ruler ) );
			e.preventDefault();

		} );
		rulerRow.appendChild( ruler );
		sheet.appendChild( rulerRow );

		if ( clip.tracks.length === 0 ) {

			const empty = document.createElement( 'div' );
			empty.style.cssText = 'color:#888;padding:16px 12px;';
			empty.textContent = T( '还没有参数。用右上角添加要 K 帧的通道。', 'No parameters yet. Add a channel to keyframe.' );
			sheet.appendChild( empty );

		}

		for ( const track of clip.tracks ) {

			const meta = PATH_META[ track.path ] || { en: track.path, zh: track.path, color: '#ccc' };
			const row = document.createElement( 'div' );
			row.style.cssText = 'display:flex;align-items:center;height:28px;border-bottom:1px solid #2a2a2a;';
			const label = document.createElement( 'div' );
			label.style.cssText = 'width:' + LABEL_W + 'px;box-sizing:border-box;padding:0 8px;display:flex;align-items:center;gap:6px;flex-shrink:0;';
			const name = document.createElement( 'span' );
			name.textContent = zh ? meta.zh : meta.en;
			name.style.cssText = 'overflow:hidden;text-overflow:ellipsis;white-space:nowrap;';
			label.appendChild( name );
			const remove = document.createElement( 'button' );
			remove.type = 'button';
			remove.textContent = '\u00d7';
			remove.title = T( '移除参数', 'Remove parameter' );
			remove.style.cssText = 'margin-left:auto;border:none;background:transparent;color:#888;cursor:pointer;';
			remove.addEventListener( 'click', () => {

				const next = normalizeStickerMotion( motion() );
				next.tracks = next.tracks.filter( ( item ) => item.path !== track.path );
				if ( selected && selected.path === track.path ) selected = null;
				commit( next );

			} );
			label.appendChild( remove );
			row.appendChild( label );

			const lane = document.createElement( 'div' );
			lane.dataset.lane = '1';
			lane.dataset.path = track.path;
			lane.style.cssText = 'flex:1;height:100%;position:relative;background:rgba(255,255,255,0.03);cursor:crosshair;';
			track.keys.forEach( ( key, index ) => {

				const diamond = document.createElement( 'div' );
				const selectedHere = selected && selected.path === track.path && selected.index === index;
				const pct = clip.duration > 0 ? ( key.t / clip.duration ) * 100 : 0;
				diamond.dataset.key = '1';
				diamond.style.cssText = [
					'position:absolute',
					'left:' + pct + '%',
					'top:50%',
					'width:9px',
					'height:9px',
					'margin-left:-4px',
					'margin-top:-4px',
					'background:' + meta.color,
					'transform:rotate(45deg)',
					'cursor:pointer',
					'z-index:5',
					selectedHere ? 'outline:2px solid #ffeb3b;outline-offset:1px' : 'outline:none',
				].join( ';' );
				diamond.title = key.t.toFixed( 2 ) + 's = ' + key.v;
				diamond.addEventListener( 'mousedown', ( e ) => {

					if ( e.button !== 0 ) return;
					e.preventDefault();
					e.stopPropagation();
					playing = false;
					editor.advanceStickerMotion = null;
					selected = { path: track.path, index };
					playTime = key.t;
					editor.stickerMotionTime = playTime;
					rebuild();
					const nextLane = sheetWrap.querySelector( '[data-path="' + track.path + '"]' );
					if ( nextLane ) {

						isDraggingKey = true;
						dragKey = { path: track.path, index, lane: nextLane };

					}

				} );
				lane.appendChild( diamond );

			} );
			lane.appendChild( makePlayhead() );
			lane.addEventListener( 'mousedown', ( e ) => {

				if ( e.button !== 0 || e.target !== lane ) return;
				const t = timeFromClientX( e.clientX, lane );
				const next = normalizeStickerMotion( motion() );
				const found = next.tracks.find( ( item ) => item.path === track.path );
				if ( ! found ) return;
				found.keys.push( { t, v: poseValue( track.path, t ) } );
				commit( next, { path: track.path, t } );

			} );
			row.appendChild( lane );
			sheet.appendChild( row );

		}

		sheetWrap.appendChild( sheet );

		const key = selectedKey();
		if ( ! key ) {

			inspector.textContent = T( '选中关键帧后可以改它的数值。在轨道上点击可在该时间加一帧。', 'Select a keyframe to edit its value. Click a lane to add a key.' );
			inspector.style.color = '#888';

		} else {

			inspector.style.color = '#ddd';
			const meta = PATH_META[ selected.path ];
			const name = document.createElement( 'span' );
			name.textContent = meta ? ( zh ? meta.zh : meta.en ) : selected.path;
			name.style.color = '#aaa';
			inspector.appendChild( name );
			const tLabel = document.createElement( 'span' );
			tLabel.textContent = T( '时间', 'Time' );
			inspector.appendChild( tLabel );
			const tIn = document.createElement( 'input' );
			tIn.type = 'number';
			tIn.step = '0.01';
			tIn.value = String( key.t );
			tIn.style.cssText = 'width:72px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;';
			tIn.addEventListener( 'change', () => {

				const next = normalizeStickerMotion( motion() );
				const found = next.tracks.find( ( item ) => item.path === selected.path );
				if ( ! found || ! found.keys[ selected.index ] ) return;
				const t = Math.max( 0, Number( tIn.value ) || 0 );
				found.keys[ selected.index ] = { t, v: found.keys[ selected.index ].v };
				commit( next, { path: selected.path, t } );

			} );
			inspector.appendChild( tIn );
			const vLabel = document.createElement( 'span' );
			vLabel.textContent = T( '数值', 'Value' );
			inspector.appendChild( vLabel );
			const vIn = document.createElement( 'input' );
			vIn.type = 'number';
			vIn.step = String( meta ? meta.step : 0.01 );
			vIn.value = String( key.v );
			vIn.style.cssText = 'width:80px;background:#333;color:#ddd;border:1px solid #555;border-radius:3px;padding:2px 4px;';
			vIn.addEventListener( 'input', () => {

				const live = selectedKey();
				if ( ! live ) return;
				const value = Number( vIn.value );
				if ( ! Number.isFinite( value ) ) return;
				live.v = value;
				editor.stickerMotionTime = playTime;
				if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();

			} );
			vIn.addEventListener( 'change', () => {

				const next = normalizeStickerMotion( motion() );
				const found = next.tracks.find( ( item ) => item.path === selected.path );
				if ( ! found || ! found.keys[ selected.index ] ) return;
				const value = Number( vIn.value );
				found.keys[ selected.index ] = { t: found.keys[ selected.index ].t, v: Number.isFinite( value ) ? value : 0 };
				commit( next, { path: selected.path, t: found.keys[ selected.index ].t } );

			} );
			inspector.appendChild( vIn );
			const del = btn( T( '删除关键帧', 'Delete key' ) );
			del.addEventListener( 'click', () => deleteSelected() );
			inspector.appendChild( del );

		}

		editor._stickerMotionPose = sampleStickerMotion( clip, playTime );
		paintPlayhead();

	}

	function deleteSelected() {

		if ( ! selected ) return;
		const next = normalizeStickerMotion( motion() );
		const found = next.tracks.find( ( item ) => item.path === selected.path );
		if ( ! found ) return;
		found.keys.splice( selected.index, 1 );
		if ( found.keys.length === 0 ) next.tracks = next.tracks.filter( ( item ) => item.path !== selected.path );
		selected = null;
		commit( next );

	}

	function savePos() {

		editor._stickerMotionWinPos = {
			left: root.style.left,
			top: root.style.top,
			width: root.style.width,
			height: root.style.height,
		};

	}

	function restorePos() {

		const pos = editor._stickerMotionWinPos;
		if ( ! pos ) return;
		if ( pos.left ) root.style.left = pos.left;
		if ( pos.top ) root.style.top = pos.top;
		if ( pos.width ) root.style.width = pos.width;
		if ( pos.height ) root.style.height = pos.height;

	}

	document.addEventListener( 'mousemove', ( e ) => {

		if ( isDraggingWin ) {

			root.style.left = Math.max( 0, Math.min( window.innerWidth - 80, e.clientX - dragOffX ) ) + 'px';
			root.style.top = Math.max( 0, Math.min( window.innerHeight - 40, e.clientY - dragOffY ) ) + 'px';

		} else if ( isResizing ) {

			root.style.width = Math.max( MIN_W, resizeStartW + ( e.clientX - resizeStartX ) ) + 'px';
			root.style.height = Math.max( MIN_H, resizeStartH + ( e.clientY - resizeStartY ) ) + 'px';

		} else if ( isScrubbing ) {

			const lane = sheetWrap.querySelector( '[data-lane]' );
			if ( lane ) seek( timeFromClientX( e.clientX, lane ) );

		} else if ( isDraggingKey && dragKey ) {

			const t = timeFromClientX( e.clientX, dragKey.lane );
			const raw = editor.stickerMotion;
			const track = raw && raw.tracks && raw.tracks.find( ( item ) => item.path === dragKey.path );
			if ( track && track.keys[ dragKey.index ] ) {

				track.keys[ dragKey.index ].t = t;
				playTime = t;
				editor.stickerMotionTime = playTime;
				paintPlayhead();
				const diamond = dragKey.lane.querySelectorAll( '[data-key]' )[ dragKey.index ];
				const dur = Math.max( 0.1, raw.duration || 0.5 );
				if ( diamond ) diamond.style.left = ( ( t / dur ) * 100 ) + '%';
				syncTimeline();
				if ( signals.sceneGraphChanged ) signals.sceneGraphChanged.dispatch();

			}

		}

	} );

	document.addEventListener( 'mouseup', () => {

		if ( isDraggingWin || isResizing ) savePos();
		if ( isDraggingKey && dragKey ) {

			const raw = editor.stickerMotion;
			const track = raw && raw.tracks && raw.tracks.find( ( item ) => item.path === dragKey.path );
			const key = track && track.keys[ dragKey.index ];
			const path = dragKey.path;
			const t = key ? key.t : playTime;
			isDraggingKey = false;
			dragKey = null;
			isDraggingWin = false;
			isResizing = false;
			isScrubbing = false;
			commit( raw, { path, t } );
			return;

		}
		isDraggingWin = false;
		isResizing = false;
		isScrubbing = false;
		isDraggingKey = false;
		dragKey = null;

	} );

	document.addEventListener( 'keydown', ( e ) => {

		if ( ! panelVisible || ! selected ) return;
		if ( e.key !== 'Delete' && e.key !== 'Backspace' ) return;
		const tag = e.target && e.target.tagName;
		if ( tag === 'INPUT' || tag === 'SELECT' || tag === 'TEXTAREA' ) return;
		e.preventDefault();
		deleteSelected();

	} );

	editor.advanceStickerMotion = null;

	signals.editorCleared.add( () => {

		editor.stickerMotion = createEmptyStickerMotion();
		playTime = 0;
		playing = false;
		selected = null;
		rebuild();

	} );
	if ( signals.stickerMotionChanged ) {

		signals.stickerMotionChanged.add( () => {

			if ( panelVisible && ! writing ) rebuild();

		} );

	}

	rebuild();
	return container;

}

export { StickerMotionPanel };
