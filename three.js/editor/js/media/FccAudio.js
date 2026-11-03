/**
 * One AudioListener for the editor (Unity-style). VideoPlayer tracks connect
 * here; master volume / mute live on the listener.
 */
import * as THREE from 'three';

const LISTENER_KEY = 'fccAudioListener';

let boundEditor = null;

function clamp01( n ) {

	const v = Number( n );
	if ( ! Number.isFinite( v ) ) return 1;
	return Math.min( 1, Math.max( 0, v ) );

}

function bindFccAudio( editor ) {

	boundEditor = editor;
	ensureFccAudioListener( editor );

}

function listenerSettings( editor ) {

	const scene = editor && editor.scene;
	if ( ! scene ) return { volume: 1, muted: false };
	if ( ! scene.userData[ LISTENER_KEY ] ) {

		scene.userData[ LISTENER_KEY ] = { volume: 1, muted: false };

	}
	const s = scene.userData[ LISTENER_KEY ];
	s.volume = clamp01( s.volume === undefined ? 1 : s.volume );
	s.muted = s.muted === true;
	return s;

}

function ensureFccAudioListener( editor ) {

	const ed = editor || boundEditor;
	if ( ! ed ) return null;
	if ( ! ed.fccAudioListener ) {

		const listener = new THREE.AudioListener();
		listener.name = 'AudioListener';
		ed.fccAudioListener = listener;

	}
	applyListenerGain( ed );
	return ed.fccAudioListener;

}

function applyListenerGain( editor ) {

	const listener = editor && editor.fccAudioListener;
	if ( ! listener ) return;
	const s = listenerSettings( editor );
	const volume = s.muted ? 0 : s.volume;
	try {

		listener.setMasterVolume( volume );

	} catch ( e ) {

		listener.gain.gain.value = volume;

	}

}

function syncFccListenerToCamera( editor ) {

	const ed = editor || boundEditor;
	const listener = ed && ed.fccAudioListener;
	const cam = ed && ( ed.viewportCamera || ed.camera );
	if ( ! listener || ! cam ) return;
	cam.updateWorldMatrix( true, false );
	listener.position.setFromMatrixPosition( cam.matrixWorld );
	listener.quaternion.setFromRotationMatrix( cam.matrixWorld );
	listener.updateMatrixWorld( true );

}

function setFccListenerSettings( editor, partial ) {

	const s = listenerSettings( editor );
	if ( partial && partial.volume !== undefined ) s.volume = clamp01( partial.volume );
	if ( partial && partial.muted !== undefined ) s.muted = partial.muted === true;
	ensureFccAudioListener( editor );
	applyListenerGain( editor );

}

function videoAudibleVolume( object ) {

	const vp = object && object.userData && object.userData.fccVideoPlayer;
	if ( ! vp ) return 0;
	if ( vp.volume === undefined ) {

		vp.volume = 1;
		vp.muted = false;

	}
	vp.volume = clamp01( vp.volume );
	return vp.muted ? 0 : vp.volume;

}

function applyVideoPlayerGain( object ) {

	const sound = object && object.__fccSound;
	if ( ! sound ) return;
	const volume = videoAudibleVolume( object );
	try {

		sound.setVolume( volume );

	} catch ( e ) {

		if ( sound.gain && sound.gain.gain ) sound.gain.gain.value = volume;

	}

}

function routeVideoPlayerAudio( editor, object ) {

	const ed = editor || boundEditor;
	const video = object && object.__fccVideo;
	const vp = object && object.userData && object.userData.fccVideoPlayer;
	if ( ! ed || ! video || ! vp ) return;
	const listener = ensureFccAudioListener( ed );
	if ( ! object.__fccSound ) {

		video.muted = false;
		video.volume = 1;
		try {

			const sound = new THREE.Audio( listener );
			sound.setMediaElementSource( video );
			object.__fccSound = sound;

		} catch ( e ) {

			console.warn( '[FreeFilmCut] video audio route', e );

		}

	} else {

		video.muted = false;
		video.volume = 1;

	}
	applyVideoPlayerGain( object );

}

function routeSceneVideos( editor ) {

	const ed = editor || boundEditor;
	const scene = ed && ed.scene;
	if ( ! scene ) return;
	scene.traverse( ( object ) => {

		if ( object.userData && object.userData.fccVideoPlayer && object.__fccVideo ) {

			routeVideoPlayerAudio( ed, object );

		}

	} );

}

function resumeAndRouteVideos( editor ) {

	const ed = editor || boundEditor;
	const listener = ensureFccAudioListener( ed );
	if ( ! listener ) return;
	const run = () => routeSceneVideos( ed );
	if ( listener.context.state === 'suspended' ) {

		listener.context.resume().then( run ).catch( run );

	} else {

		run();

	}

}

function tryRoutePlayingVideos( scene ) {

	const editor = boundEditor;
	const listener = editor && editor.fccAudioListener;
	if ( ! editor || ! scene || ! listener ) return;
	if ( listener.context.state !== 'running' ) return;
	scene.traverse( ( object ) => {

		if ( object.userData && object.userData.fccVideoPlayer && object.__fccVideo && ! object.__fccSound ) {

			routeVideoPlayerAudio( editor, object );

		}

	} );

}

function releaseVideoAudio( object ) {

	const sound = object && object.__fccSound;
	if ( ! sound ) return;
	try {

		sound.disconnect();

	} catch ( e ) { /* already disconnected */ }
	object.__fccSound = null;

}

export {
	LISTENER_KEY,
	bindFccAudio,
	listenerSettings,
	ensureFccAudioListener,
	syncFccListenerToCamera,
	setFccListenerSettings,
	applyVideoPlayerGain,
	routeVideoPlayerAudio,
	resumeAndRouteVideos,
	tryRoutePlayingVideos,
	releaseVideoAudio,
};
