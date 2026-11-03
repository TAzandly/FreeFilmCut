/**
 * Sidebar for MediaFramePlayer (Video / GIF / Sequence) and RenderTexture objects.
 * RT wrapMode + MediaPlayer autoplay (fcc-ui-203). Media RT LinearSRGB (fcc-ui-207).
 */
import { UIPanel, UIRow, UIText, UINumber, UIButton, UISelect, UICheckbox, UIInput } from './libs/ui.js';
import {
	isFccRenderTexture,
	isFccVideoPlayer,
	ensureRenderTarget,
	listRenderTextureOptions,
	assignVideoFile,
	assignGifFile,
	assignSequenceFromFiles,
	assignSequenceFromDirectoryPicker,
	assignSequenceFromProject,
	mediaKind,
	getMediaDurationSec,
	VP_KEY,
	RT_KEY,
} from './media/FccVideo.js?v=fcc-ui-207';
import { applyVideoPlayerGain, resumeAndRouteVideos, routeVideoPlayerAudio } from './media/FccAudio.js?v=fcc-ui-106';

function SidebarObjectMedia( editor ) {

	const signals = editor.signals;
	const lang = ( editor.config && editor.config.getKey( 'language' ) ) || 'en';
	const isZh = lang === 'zh';

	const container = new UIPanel();
	container.setDisplay( 'none' );

	const title = new UIText( '' ).setTextTransform( 'uppercase' );
	container.add( title );

	const rtSizeRow = new UIRow();
	rtSizeRow.add( new UIText( isZh ? '尺寸' : 'Size' ).setClass( 'Label' ) );
	const rtWidth = new UINumber( 512 ).setPrecision( 0 ).setRange( 16, 4096 ).setWidth( '50px' );
	const rtHeight = new UINumber( 512 ).setPrecision( 0 ).setRange( 16, 4096 ).setWidth( '50px' ).setMarginLeft( '4px' );
	rtSizeRow.add( rtWidth );
	rtSizeRow.add( rtHeight );
	container.add( rtSizeRow );

	const rtWrapRow = new UIRow();
	rtWrapRow.add( new UIText( isZh ? '采样' : 'Wrap' ).setClass( 'Label' ) );
	const rtWrapSelect = new UISelect().setWidth( '140px' ).setOptions( {
		clamp: 'Clamp',
		repeat: 'Repeat',
		mirroredRepeat: 'Mirrored Repeat',
	} ).onChange( onWrapChange );
	rtWrapRow.add( rtWrapSelect );
	container.add( rtWrapRow );

	const kindRow = new UIRow();
	kindRow.add( new UIText( isZh ? '类型' : 'Kind' ).setClass( 'Label' ) );
	const kindSelect = new UISelect().setWidth( '140px' ).setOptions( {
		video: isZh ? '视频' : 'Video',
		gif: 'GIF',
		imageSequence: isZh ? '序列帧' : 'Sequence',
	} ).onChange( onKindChange );
	kindRow.add( kindSelect );
	container.add( kindRow );

	const fileRow = new UIRow();
	const fileButton = new UIButton( isZh ? '选择文件' : 'File' );
	const fileName = new UIText( '' ).setMarginLeft( '8px' ).setFontSize( '11px' );
	fileRow.add( fileButton );
	fileRow.add( fileName );
	container.add( fileRow );

	const fileInput = document.createElement( 'input' );
	fileInput.type = 'file';
	fileInput.style.display = 'none';
	container.dom.appendChild( fileInput );

	const seqDirInput = document.createElement( 'input' );
	seqDirInput.type = 'file';
	seqDirInput.style.display = 'none';
	seqDirInput.setAttribute( 'webkitdirectory', '' );
	seqDirInput.setAttribute( 'directory', '' );
	seqDirInput.multiple = true;
	container.dom.appendChild( seqDirInput );

	const seqFpsRow = new UIRow();
	seqFpsRow.add( new UIText( 'FPS' ).setClass( 'Label' ) );
	const seqFps = new UINumber( 30 ).setPrecision( 2 ).setRange( 1, 120 ).setWidth( '50px' ).onChange( onSeqFpsChange );
	seqFpsRow.add( seqFps );
	container.add( seqFpsRow );

	const speedRow = new UIRow();
	speedRow.add( new UIText( isZh ? '速度' : 'Speed' ).setClass( 'Label' ) );
	const speedNumber = new UINumber( 1 ).setPrecision( 2 ).setRange( 0.05, 16 ).setWidth( '50px' ).onChange( onSpeedChange );
	speedRow.add( speedNumber );
	container.add( speedRow );

	const seqProjectRow = new UIRow();
	const seqProjectBtn = new UIButton( isZh ? '工程序列夹' : 'Project seq' );
	const seqProjectInput = new UIInput( '' ).setWidth( '100px' ).setMarginLeft( '4px' );
	seqProjectRow.add( seqProjectBtn );
	seqProjectRow.add( seqProjectInput );
	container.add( seqProjectRow );

	const targetRow = new UIRow();
	targetRow.add( new UIText( 'RT' ).setClass( 'Label' ) );
	const targetSelect = new UISelect().setWidth( '140px' ).onChange( onTargetChange );
	targetRow.add( targetSelect );
	container.add( targetRow );

	const loopRow = new UIRow();
	loopRow.add( new UIText( isZh ? '循环' : 'Loop' ).setClass( 'Label' ) );
	const loopBox = new UICheckbox( true ).onChange( onLoopChange );
	loopRow.add( loopBox );
	container.add( loopRow );

	const autoplayRow = new UIRow();
	autoplayRow.add( new UIText( isZh ? '自动播放' : 'Autoplay' ).setClass( 'Label' ) );
	const autoplayBox = new UICheckbox( false ).onChange( onAutoplayChange );
	autoplayRow.add( autoplayBox );
	container.add( autoplayRow );

	const volumeRow = new UIRow();
	volumeRow.add( new UIText( isZh ? '音量' : 'Volume' ).setClass( 'Label' ) );
	const volumeNumber = new UINumber( 1 ).setPrecision( 2 ).setRange( 0, 1 ).setWidth( '50px' ).onChange( onVolumeChange );
	volumeRow.add( volumeNumber );
	container.add( volumeRow );

	const muteRow = new UIRow();
	muteRow.add( new UIText( isZh ? '静音' : 'Mute' ).setClass( 'Label' ) );
	const muteBox = new UICheckbox( false ).onChange( onMuteChange );
	muteRow.add( muteBox );
	container.add( muteRow );

	const playRow = new UIRow();
	const playButton = new UIButton( isZh ? '播放' : 'Play' ).onClick( onPlayClick );
	playRow.add( playButton );
	container.add( playRow );

	const hintRow = new UIRow();
	const hint = new UIText( '' ).setFontSize( '10px' ).setColor( '#888' );
	hintRow.add( hint );
	container.add( hintRow );

	let object = null;

	function currentKind() {

		return object && isFccVideoPlayer( object ) ? mediaKind( object ) : 'video';

	}

	function onSizeChange() {

		if ( ! isFccRenderTexture( object ) ) return;
		const spec = object.userData[ RT_KEY ];
		spec.width = rtWidth.getValue();
		spec.height = rtHeight.getValue();
		ensureRenderTarget( object );
		signals.objectChanged.dispatch( object );
		signals.sceneGraphChanged.dispatch();

	}

	rtWidth.onChange( onSizeChange );
	rtHeight.onChange( onSizeChange );

	function onWrapChange() {

		if ( ! isFccRenderTexture( object ) ) return;
		const spec = object.userData[ RT_KEY ];
		spec.wrapMode = rtWrapSelect.getValue() || 'clamp';
		ensureRenderTarget( object );
		signals.objectChanged.dispatch( object );
		signals.sceneGraphChanged.dispatch();

	}

	function onKindChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		const next = kindSelect.getValue() || 'video';
		object.userData[ VP_KEY ].kind = next;
		refresh( object );
		signals.objectChanged.dispatch( object );

	}

	function onSeqFpsChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		const vp = object.userData[ VP_KEY ];
		vp.sequenceFps = seqFps.getValue();
		if ( object.__fccSeq ) {

			object.__fccSeq.fps = vp.sequenceFps;
			object.__fccSeq.durationSec = object.__fccSeq.count / vp.sequenceFps;

		}
		signals.objectChanged.dispatch( object );

	}

	function onSpeedChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		const vp = object.userData[ VP_KEY ];
		let r = Number( speedNumber.getValue() );
		if ( ! Number.isFinite( r ) || r <= 0 ) r = 1;
		r = Math.min( 16, Math.max( 0.05, r ) );
		vp.playbackRate = r;
		speedNumber.setValue( r );
		// Video element picks up rate on next sync / seek.
		if ( object.__fccVideo ) object.__fccVideo.playbackRate = r;
		signals.objectChanged.dispatch( object );

	}

	fileButton.onClick( function () {

		const kind = currentKind();
		if ( kind === 'imageSequence' ) {

			// Prefer directory picker (bind FileMap for play; flush on Save).
			if ( typeof window.showDirectoryPicker === 'function' ) {

				assignSequenceFromDirectoryPicker( object, editor, { fps: seqFps.getValue() } ).then( function ( ok ) {

					if ( ! ok ) console.warn( '[FreeFilmCut] no image frames in selected folder' );
					else if ( object.userData[ VP_KEY ] ) seqProjectInput.setValue( object.userData[ VP_KEY ].sequenceDir || '' );
					refresh( object );
					signals.objectChanged.dispatch( object );
					signals.sceneGraphChanged.dispatch();

				} ).catch( function ( e ) {

					console.warn( '[FreeFilmCut] sequence folder', e );

				} );
				return;

			}
			seqDirInput.click();
			return;

		}
		if ( kind === 'gif' ) {

			fileInput.accept = 'image/gif,.gif';

		} else {

			fileInput.accept = 'video/mp4,video/webm,video/ogg,.mp4,.webm,.mov,.ogv';

		}
		fileInput.click();

	} );

	fileInput.addEventListener( 'change', function () {

		const file = fileInput.files && fileInput.files[ 0 ];
		fileInput.value = '';
		if ( ! file || ! isFccVideoPlayer( object ) ) return;
		const kind = currentKind();
		const job = kind === 'gif'
			? assignGifFile( object, file )
			: assignVideoFile( object, file );
		job.then( function () {

			resumeAndRouteVideos( editor );
			refresh( object );
			signals.objectChanged.dispatch( object );
			signals.sceneGraphChanged.dispatch();

		} ).catch( function ( e ) {

			console.warn( '[FreeFilmCut] media file', e );

		} );

	} );

	seqDirInput.addEventListener( 'change', function () {

		const list = seqDirInput.files;
		seqDirInput.value = '';
		if ( ! list || ! list.length || ! isFccVideoPlayer( object ) ) return;
		assignSequenceFromFiles( object, list, { fps: seqFps.getValue() } ).then( function ( ok ) {

			if ( ! ok ) console.warn( '[FreeFilmCut] no image frames in folder' );
			else if ( object.userData[ VP_KEY ] ) seqProjectInput.setValue( object.userData[ VP_KEY ].sequenceDir || '' );
			refresh( object );
			signals.objectChanged.dispatch( object );
			signals.sceneGraphChanged.dispatch();

		} ).catch( function ( e ) {

			console.warn( '[FreeFilmCut] sequence folder', e );

		} );

	} );

	seqProjectBtn.onClick( function () {

		if ( ! isFccVideoPlayer( object ) ) return;
		let dir = String( seqProjectInput.getValue() || '' ).trim();
		const fps = seqFps.getValue();
		// Empty input: pick a real folder (do NOT default to empty assets/sequences).
		if ( ! dir ) {

			assignSequenceFromDirectoryPicker( object, editor, { fps } ).then( function ( ok ) {

				if ( ! ok ) console.warn( '[FreeFilmCut] no image frames in selected folder' );
				else if ( object.userData[ VP_KEY ] ) seqProjectInput.setValue( object.userData[ VP_KEY ].sequenceDir || '' );
				refresh( object );
				signals.objectChanged.dispatch( object );
				signals.sceneGraphChanged.dispatch();

			} ).catch( function ( e ) {

				console.warn( '[FreeFilmCut] sequence folder', e );

			} );
			return;

		}
		if ( ! dir.startsWith( 'assets/' ) ) dir = 'assets/sequences/' + dir.replace( /^\/+/, '' );
		// Refuse bare reserved container with no frames (list child or warn).
		if ( dir === 'assets/sequences' ) {

			console.warn( '[FreeFilmCut] enter a subfolder e.g. assets/sequences/MySeq, or leave empty to pick a folder' );
			return;

		}
		assignSequenceFromProject( object, editor, dir, { fps } ).then( function ( ok ) {

			if ( ! ok ) console.warn( '[FreeFilmCut] sequence folder empty or missing:', dir );
			refresh( object );
			signals.objectChanged.dispatch( object );
			signals.sceneGraphChanged.dispatch();

		} );

	} );

	function onTargetChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		object.userData[ VP_KEY ].targetUuid = targetSelect.getValue() || '';
		signals.objectChanged.dispatch( object );

	}

	function onLoopChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		object.userData[ VP_KEY ].loop = loopBox.getValue();
		signals.objectChanged.dispatch( object );

	}

	function onAutoplayChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		object.userData[ VP_KEY ].autoplay = autoplayBox.getValue() === true;
		signals.objectChanged.dispatch( object );

	}

	function onVolumeChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		const vp = object.userData[ VP_KEY ];
		vp.volume = volumeNumber.getValue();
		applyVideoPlayerGain( object );
		if ( vp.muted !== true ) resumeAndRouteVideos( editor );
		signals.objectChanged.dispatch( object );

	}

	function onMuteChange() {

		if ( ! isFccVideoPlayer( object ) ) return;
		const vp = object.userData[ VP_KEY ];
		vp.muted = muteBox.getValue() === true;
		if ( vp.muted ) applyVideoPlayerGain( object );
		else resumeAndRouteVideos( editor );
		signals.objectChanged.dispatch( object );

	}

	function onPlayClick() {

		if ( ! isFccVideoPlayer( object ) ) return;
		const vp = object.userData[ VP_KEY ];
		vp.playing = vp.playing === false;
		const kind = mediaKind( object );
		if ( kind === 'video' ) {

			const video = object.__fccVideo;
			resumeAndRouteVideos( editor );
			routeVideoPlayerAudio( editor, object );
			if ( video ) {

				if ( vp.playing === false ) video.pause();
				else video.play().catch( function () {} );

			}

		} else {

			object.__fccMediaWallStart = null;
			object.__fccMediaActive = vp.playing !== false;

		}
		refresh( object );
		signals.objectChanged.dispatch( object );

	}

	function refresh( current ) {

		object = current;
		const showRT = isFccRenderTexture( object );
		const showVP = isFccVideoPlayer( object );
		container.setDisplay( showRT || showVP ? '' : 'none' );
		rtSizeRow.setDisplay( showRT ? '' : 'none' );
		rtWrapRow.setDisplay( showRT ? '' : 'none' );
		kindRow.setDisplay( showVP ? '' : 'none' );
		fileRow.setDisplay( showVP ? '' : 'none' );
		targetRow.setDisplay( showVP ? '' : 'none' );
		loopRow.setDisplay( showVP ? '' : 'none' );
		autoplayRow.setDisplay( showVP ? '' : 'none' );
		hintRow.setDisplay( showVP ? '' : 'none' );

		const kind = showVP ? mediaKind( object ) : 'video';
		const isVideo = kind === 'video';
		const isSeq = kind === 'imageSequence';
		volumeRow.setDisplay( showVP && isVideo ? '' : 'none' );
		muteRow.setDisplay( showVP && isVideo ? '' : 'none' );
		playRow.setDisplay( showVP ? '' : 'none' );
		seqFpsRow.setDisplay( showVP && isSeq ? '' : 'none' );
		seqProjectRow.setDisplay( showVP && isSeq ? '' : 'none' );
		speedRow.setDisplay( showVP ? '' : 'none' );

		if ( showRT ) {

			title.setValue( isZh ? '渲染贴图' : 'Render Texture' );
			const spec = object.userData[ RT_KEY ];
			rtWidth.setValue( spec.width || 512 );
			rtHeight.setValue( spec.height || 512 );
			if ( ! spec.wrapMode ) spec.wrapMode = 'clamp';
			rtWrapSelect.setValue( spec.wrapMode );
			ensureRenderTarget( object );

		}

		if ( showVP ) {

			title.setValue( isZh ? '媒体播放器' : 'Media Player' );
			const vp = object.userData[ VP_KEY ];
			if ( ! vp.kind ) vp.kind = 'video';
			kindSelect.setValue( vp.kind || 'video' );
			fileButton.setTextContent(
				isSeq ? ( isZh ? '选帧文件夹' : 'Frame folder' )
					: kind === 'gif' ? ( isZh ? '选择 GIF' : 'GIF' )
						: ( isZh ? '选择视频' : 'Video' )
			);
			fileName.setValue( vp.fileName || ( isZh ? '未选择' : 'none' ) );
			targetSelect.setOptions( listRenderTextureOptions( editor.scene ) );
			targetSelect.setValue( vp.targetUuid || '' );
			loopBox.setValue( vp.loop !== false );
			if ( vp.autoplay == null ) vp.autoplay = false;
			autoplayBox.setValue( vp.autoplay === true );
			if ( vp.volume === undefined ) vp.volume = 1;
			volumeNumber.setValue( vp.volume );
			muteBox.setValue( vp.muted === true );
			seqFps.setValue( vp.sequenceFps || 30 );
			if ( vp.playbackRate == null || ! Number.isFinite( Number( vp.playbackRate ) ) || Number( vp.playbackRate ) <= 0 ) vp.playbackRate = 1;
			speedNumber.setValue( vp.playbackRate );
			seqProjectInput.setValue( vp.sequenceDir || vp.projectPath || '' );
			playButton.setTextContent( vp.playing === false
				? ( isZh ? '播放' : 'Play' )
				: ( isZh ? '暂停' : 'Pause' ) );
			const dur = getMediaDurationSec( object );
			const durTxt = dur > 0 ? ( ' · ' + dur.toFixed( 2 ) + 's' ) : '';
			if ( kind === 'gif' ) {

				const sp = Number( vp.playbackRate );
				const spTxt = ( Number.isFinite( sp ) && sp !== 1 ) ? ( ' · ×' + sp ) : '';
				hint.setValue( isZh
					? 'GIF 按帧 delay；速度 1=原速，2=快一倍' + durTxt + spTxt
					: 'GIF per-frame delays; Speed 1=original, 2=2x' + durTxt + spTxt );

			} else if ( isSeq ) {

				hint.setValue( isZh
					? '序列帧 LRU 预取，时间轴控制；工程夹或本地文件夹' + durTxt
					: 'Sequence LRU prefetch; timeline seeks frames' + durTxt );

			} else {

				hint.setValue( isZh
					? '视频由浏览器解码，画面写入所选 RT。声音送到场景的音频监听器。'
					: 'The browser decodes the video into the selected RT. Audio goes to the scene listener.' );

			}

		}

	}

	signals.objectSelected.add( refresh );

	signals.sceneGraphChanged.add( function () {

		if ( isFccVideoPlayer( object ) ) {

			const vp = object.userData[ VP_KEY ];
			const current = targetSelect.getValue();
			targetSelect.setOptions( listRenderTextureOptions( editor.scene ) );
			targetSelect.setValue( vp.targetUuid || current || '' );

		}

	} );

	return container;

}

export { SidebarObjectMedia };
