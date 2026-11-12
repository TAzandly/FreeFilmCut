/**
 * Face FX preview panel — enable live MediaPlayer preview + apply presets.
 */

import { UIPanel } from '../libs/ui.js';
import {
	FACE_FX_PRESETS,
	readEditorFaceFx,
	writeEditorFaceFx
} from './FaceFxConfig.js?v=fcc-ui-240';
import { packTypeIsFaceFx } from './FaceFxPreview.js?v=fcc-ui-252';

function FaceFxPanel( editor ) {

	const strings = editor.strings;
	const zh = ( ( editor.config && editor.config.getKey( 'language' ) ) || 'en' ) === 'zh';
	const T = ( z, e ) => ( zh ? z : e );

	const container = new UIPanel();
	container.setId( 'face-fx-panel' );
	const root = container.dom;
	root.style.cssText = [
		'display:none',
		'position:fixed',
		'left:96px',
		'top:100px',
		'width:360px',
		'z-index:10050',
		'flex-direction:column',
		'background:#1e1e1e',
		'border:1px solid #555',
		'border-radius:6px',
		'box-shadow:0 8px 28px rgba(0,0,0,0.55)',
		'overflow:hidden',
		'color:#ddd',
		'font-size:12px'
	].join( ';' );

	let panelVisible = false;

	const titleBar = document.createElement( 'div' );
	titleBar.style.cssText = 'display:flex;align-items:center;justify-content:space-between;padding:6px 10px;background:#2a2a2a;border-bottom:1px solid #444;cursor:move;user-select:none;';
	const title = document.createElement( 'div' );
	title.textContent = strings.getKey( 'faceFx/title' ) || T( '人脸特效预览', 'Face FX Preview' );
	title.style.fontWeight = '600';
	titleBar.appendChild( title );
	const closeBtn = document.createElement( 'button' );
	closeBtn.type = 'button';
	closeBtn.textContent = '\u00d7';
	closeBtn.style.cssText = 'width:24px;height:24px;border:none;background:transparent;color:#ccc;font-size:18px;cursor:pointer;';
	closeBtn.addEventListener( 'click', () => setPanelVisible( false ) );
	titleBar.appendChild( closeBtn );
	root.appendChild( titleBar );

	let drag = false, ox = 0, oy = 0;
	titleBar.addEventListener( 'mousedown', ( e ) => {

		if ( e.target === closeBtn ) return;
		drag = true;
		ox = e.clientX - root.offsetLeft;
		oy = e.clientY - root.offsetTop;
		e.preventDefault();

	} );
	window.addEventListener( 'mousemove', ( e ) => {

		if ( ! drag ) return;
		root.style.left = Math.max( 0, e.clientX - ox ) + 'px';
		root.style.top = Math.max( 0, e.clientY - oy ) + 'px';

	} );
	window.addEventListener( 'mouseup', () => { drag = false; } );

	const body = document.createElement( 'div' );
	body.style.cssText = 'padding:10px;display:flex;flex-direction:column;gap:8px;';
	root.appendChild( body );

	const hint = document.createElement( 'div' );
	hint.style.cssText = 'color:#999;line-height:1.4;';
	hint.textContent = T(
		'Pack type = Face FX。场景放 MediaFramePlayer + RenderTexture + 显示平面，导入人脸视频后开启预览。',
		'Set Pack type to Face FX. Add MediaFramePlayer → RenderTexture → display plane, load a face video, then enable preview.'
	);
	body.appendChild( hint );

	const previewRow = document.createElement( 'div' );
	previewRow.style.cssText = 'display:flex;align-items:center;gap:8px;';
	const previewBtn = document.createElement( 'button' );
	previewBtn.type = 'button';
	previewBtn.style.cssText = 'padding:6px 12px;cursor:pointer;';
	previewBtn.textContent = T( '开启预览', 'Enable preview' );
	previewBtn.addEventListener( 'click', () => {

		const preview = editor.faceFxPreview;
		if ( ! preview ) return;
		const next = ! preview.enabled;
		preview.setEnabled( next );
		syncPreviewBtn();

	} );
	previewRow.appendChild( previewBtn );
	body.appendChild( previewRow );

	const statusEl = document.createElement( 'div' );
	statusEl.style.cssText = 'color:#8ab4f8;min-height:1.2em;';
	body.appendChild( statusEl );

	const presetLabel = document.createElement( 'div' );
	presetLabel.textContent = T( '预设', 'Presets' );
	presetLabel.style.marginTop = '4px';
	body.appendChild( presetLabel );

	const presetNames = [
		[ 'rabbitEars', T( '兔耳朵 (GLB)', 'Rabbit Ears (GLB)' ) ],
		[ 'eyeLaser', T( '双眼镭射', 'Eye Laser' ) ],
		[ 'funhouseBulge', T( '哈哈镜', 'Funhouse Bulge' ) ],
		[ 'partyCombo', T( '派对组合', 'Party Combo' ) ]
	];
	for ( const [ key, label ] of presetNames ) {

		const btn = document.createElement( 'button' );
		btn.type = 'button';
		btn.textContent = label;
		btn.style.cssText = 'padding:6px 10px;cursor:pointer;text-align:left;';
		btn.addEventListener( 'click', () => {

			writeEditorFaceFx( editor, FACE_FX_PRESETS[ key ] );
			statusEl.textContent = T( '已应用预设：', 'Applied: ' ) + label;
			if ( editor.signals.sceneGraphChanged ) editor.signals.sceneGraphChanged.dispatch();

		} );
		body.appendChild( btn );

	}

	function syncPreviewBtn() {

		const on = !!( editor.faceFxPreview && editor.faceFxPreview.enabled );
		previewBtn.textContent = on ? T( '关闭预览', 'Disable preview' ) : T( '开启预览', 'Enable preview' );

	}

	function refreshStatus() {

		const preview = editor.faceFxPreview;
		if ( ! packTypeIsFaceFx( editor ) ) {

			statusEl.textContent = T( '请先把包类型设为 Face FX', 'Set Pack type to Face FX first' );
			return;

		}
		const cfg = readEditorFaceFx( editor );
		const st = preview && preview.getStatus ? preview.getStatus() : null;
		if ( st && st.message ) statusEl.textContent = st.message;
		else statusEl.textContent = T( '层数 ', 'Layers ' ) + cfg.layers.length;
		syncPreviewBtn();

	}

	function setPanelVisible( v ) {

		panelVisible = !! v;
		root.style.display = panelVisible ? 'flex' : 'none';
		if ( panelVisible ) refreshStatus();

	}

	editor.toggleFaceFxPanel = function () {

		setPanelVisible( ! panelVisible );

	};

	if ( editor.signals && editor.signals.faceFxPreviewStatus ) {

		editor.signals.faceFxPreviewStatus.add( refreshStatus );

	}

	setInterval( () => {

		if ( panelVisible ) refreshStatus();

	}, 500 );

	document.body.appendChild( root );
	return container;

}

export { FaceFxPanel };
