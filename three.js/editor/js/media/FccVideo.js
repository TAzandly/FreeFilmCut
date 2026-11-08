/**
 * FreeFilmCut MediaFramePlayer (legacy name VideoPlayer):
 * kind video | gif | imageSequence → sampleFrame → blit into a RenderTexture.
 * Materials sample that one RT texture. Timeline owns transport for all kinds. autoplay: pack free-run when no timeline (fcc-ui-203). Media RT LinearSRGB (fcc-ui-207): r186 writes linear into non-XR RTs; marking sRGB caused double-decode (dark/red GIF).
 */
import * as THREE from 'three';
import { releaseVideoAudio, tryRoutePlayingVideos, applyVideoPlayerGain } from './FccAudio.js?v=fcc-ui-106';
import {
	mediaKind,
	getPlaybackRate,
	attachGifBuffer,
	attachImageSequence,
	releaseMediaExtras,
	seekMediaFrame,
	sampleMediaFrameSync,
	getMediaDurationSec,
	buildSequenceFileList,
	IMAGE_EXT,
	SEQ_LRU_AHEAD,
	SEQ_LRU_BEHIND,
	SEQ_LRU_MAX,
} from './FccMediaFrame.js?v=fcc-ui-190';

const RT_KEY = 'fccRenderTexture';

/** RT wrapMode strings -> Three.js wrapping (S and T share one mode). Default clamp. */
const RT_WRAP_THREE = {
	clamp: THREE.ClampToEdgeWrapping,
	repeat: THREE.RepeatWrapping,
	mirroredRepeat: THREE.MirroredRepeatWrapping,
};

function normalizeRtWrapMode( mode ) {

	const m = String( mode == null ? '' : mode ).trim();
	if ( m === 'clamp' || m === 'repeat' || m === 'mirroredRepeat' ) return m;
	if ( m === 'ClampToEdge' || m === 'ClampToEdgeWrapping' || m === 'Clamp' ) return 'clamp';
	if ( m === 'Repeat' || m === 'RepeatWrapping' ) return 'repeat';
	if ( m === 'MirroredRepeat' || m === 'MirroredRepeatWrapping' ) return 'mirroredRepeat';
	return 'clamp';

}

function applyRtTextureWrap( texture, wrapMode ) {

	if ( ! texture ) return;
	const wrapping = RT_WRAP_THREE[ normalizeRtWrapMode( wrapMode ) ] || THREE.ClampToEdgeWrapping;
	if ( texture.wrapS !== wrapping || texture.wrapT !== wrapping ) {

		texture.wrapS = wrapping;
		texture.wrapT = wrapping;
		texture.needsUpdate = true;

	}

}

const VP_KEY = 'fccVideoPlayer';

const MIN_SIZE = 16;
const MAX_SIZE = 4096;

const _blitCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
/**
 * MeshBasic + NoBlending copies map RGBA into the RT.
 * NoBlending makes Three skip the OPAQUE define (which forces a=1), so GIF/PNG
 * alpha survives; built-in material correctly samples VideoTexture/CanvasTexture
 * (raw ShaderMaterial blit went blank under r187 color management).
 */
const _blitMat = new THREE.MeshBasicMaterial( {
	map: null,
	depthTest: false,
	depthWrite: false,
	toneMapped: false,
	transparent: true,
	blending: THREE.NoBlending,
} );
const _blitMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), _blitMat );
const _blitScene = new THREE.Scene();
_blitScene.add( _blitMesh );
const _clearColor = new THREE.Color();

function clampSize( n, fallback ) {

	const v = Math.round( Number( n ) );
	if ( ! Number.isFinite( v ) ) return fallback;
	return Math.min( MAX_SIZE, Math.max( MIN_SIZE, v ) );

}

function isFccRenderTexture( object ) {

	return !!( object && object.userData && object.userData[ RT_KEY ] );

}

function isFccVideoPlayer( object ) {

	return !!( object && object.userData && object.userData[ VP_KEY ] );

}

function uniqueName( scene, base ) {

	const names = new Set();
	if ( scene ) scene.traverse( ( o ) => names.add( o.name ) );
	if ( ! names.has( base ) ) return base;
	let i = 2;
	while ( names.has( base + i ) ) i ++;
	return base + i;

}

function createRenderTextureObject( scene ) {

	const object = new THREE.Object3D();
	object.name = uniqueName( scene, 'RenderTexture' );
	object.userData[ RT_KEY ] = { width: 512, height: 512, wrapMode: 'clamp' };
	return object;

}

function createVideoPlayerObject( scene ) {

	const object = new THREE.Object3D();
	object.name = uniqueName( scene, 'VideoPlayer' );
	object.userData[ VP_KEY ] = {
		kind: 'video',
		loop: true,
		muted: false,
		volume: 1,
		playing: true,
		playbackRate: 1,
		autoplay: false,
		targetUuid: '',
		fileName: '',
		projectPath: '',
		sequenceDir: '',
		sequenceFps: 30,
		sequenceStart: 0,
		sequenceEnd: - 1,
	};
	return object;

}

/** Alias — same Object3D + fccVideoPlayer userData (MediaFramePlayer). */
const createMediaPlayerObject = createVideoPlayerObject;

function markRTTexture( object, texture ) {

	texture.name = object.name || 'RenderTexture';
	texture.userData = texture.userData || {};
	texture.userData.fccRenderTextureUuid = object.uuid;
	texture.flipY = false;
	texture.generateMipmaps = false;
	// Three r152+: non-XR RTs are written in workingColorSpace (linear). Marking
	// SRGB here made MeshBasic/sticker sample decode again -> dark/red GIF cores.
	const prevCS = texture.colorSpace;
	texture.colorSpace = THREE.LinearSRGBColorSpace;
	if ( prevCS && prevCS !== THREE.LinearSRGBColorSpace ) {

		// Program cache keys on map.colorSpace; force consumers to rebuild once.
		texture.userData.fccColorSpaceResync = true;

	}
	texture.premultipliedAlpha = false;
	if ( texture.format === undefined ) texture.format = THREE.RGBAFormat;

}

/** Materials sampling an alpha RT must be transparent or Three forces a=1 (OPAQUE).
 * Also rebuilds programs once after Media RT colorSpace is corrected to LinearSRGB.
 */
function ensureMaterialsShowRtAlpha( scene, rtTexture ) {

	if ( ! scene || ! rtTexture || ! rtTexture.userData ) return;
	const uuid = rtTexture.userData.fccRenderTextureUuid;
	const needAlpha = !! rtTexture.userData.fccHasAlpha;
	const needCS = !! rtTexture.userData.fccColorSpaceResync;
	if ( ! needAlpha && ! needCS ) return;

	function touch( material ) {

		if ( ! material ) return;
		let hit = false;
		for ( let k = 0; k < MATERIAL_TEXTURE_KEYS.length; k ++ ) {

			const tex = material[ MATERIAL_TEXTURE_KEYS[ k ] ];
			if ( tex && ( tex === rtTexture || ( tex.userData && tex.userData.fccRenderTextureUuid === uuid ) ) ) hit = true;

		}
		if ( material.uniforms ) {

			for ( const name in material.uniforms ) {

				const entry = material.uniforms[ name ];
				const tex = entry && entry.value;
				if ( tex && tex.isTexture && ( tex === rtTexture || ( tex.userData && tex.userData.fccRenderTextureUuid === uuid ) ) ) hit = true;

			}

		}
		if ( ! hit ) return;
		if ( needAlpha && ! material.transparent ) {

			material.transparent = true;
			material.needsUpdate = true;

		}
		if ( needCS ) material.needsUpdate = true;

	}

	scene.traverse( ( object ) => {

		const materials = Array.isArray( object.material ) ? object.material : ( object.material ? [ object.material ] : null );
		if ( ! materials ) return;
		for ( let i = 0; i < materials.length; i ++ ) touch( materials[ i ] );

	} );

	if ( needCS ) delete rtTexture.userData.fccColorSpaceResync;

}

function ensureRenderTarget( object ) {

	if ( ! isFccRenderTexture( object ) ) return null;
	const spec = object.userData[ RT_KEY ];
	const width = clampSize( spec.width, 512 );
	const height = clampSize( spec.height, 512 );
	spec.width = width;
	spec.height = height;
	spec.wrapMode = normalizeRtWrapMode( spec.wrapMode );

	let rt = object.__fccRT;
	if ( ! rt ) {

		rt = new THREE.WebGLRenderTarget( width, height, {
			depthBuffer: false,
			stencilBuffer: false,
			generateMipmaps: false,
			minFilter: THREE.LinearFilter,
			magFilter: THREE.LinearFilter,
			format: THREE.RGBAFormat,
			type: THREE.UnsignedByteType,
			colorSpace: THREE.LinearSRGBColorSpace,
		} );
		rt.texture.premultipliedAlpha = false;
		object.__fccRT = rt;

	} else if ( rt.width !== width || rt.height !== height ) {

		rt.setSize( width, height );

	}

	// Always re-mark so hot-reload / old sessions pick up LinearSRGB.
	markRTTexture( object, rt.texture );
	applyRtTextureWrap( rt.texture, spec.wrapMode );
	return rt;

}

function getRenderTexture( object ) {

	const rt = ensureRenderTarget( object );
	return rt ? rt.texture : null;

}

function findRenderTextureObject( scene, uuid ) {

	if ( ! scene || ! uuid ) return null;
	const object = scene.getObjectByProperty( 'uuid', uuid );
	return isFccRenderTexture( object ) ? object : null;

}

function textureForRenderTextureUuid( editor, uuid ) {

	const scene = editor && editor.scene;
	const object = findRenderTextureObject( scene, uuid );
	return object ? getRenderTexture( object ) : null;

}

function listRenderTextureOptions( scene ) {

	const options = { '': '—' };
	if ( ! scene ) return options;
	scene.traverse( ( object ) => {

		if ( ! isFccRenderTexture( object ) ) return;
		options[ object.uuid ] = object.name || 'RenderTexture';

	} );
	return options;

}

function videoMime( name ) {

	const n = String( name || '' ).toLowerCase();
	if ( n.endsWith( '.webm' ) ) return 'video/webm';
	if ( n.endsWith( '.mov' ) ) return 'video/quicktime';
	if ( n.endsWith( '.ogv' ) || n.endsWith( '.ogg' ) ) return 'video/ogg';
	return 'video/mp4';

}

function safeVideoName( name ) {

	const base = String( name || 'video.mp4' ).split( /[/\\]/ ).pop().replace( /[\\/:*?"<>|]/g, '_' );
	return base || 'video.mp4';

}

function safeGifName( name ) {

	const base = String( name || 'anim.gif' ).split( /[/\\]/ ).pop().replace( /[\\/:*?"<>|]/g, '_' );
	return base || 'anim.gif';

}

function releaseVideoElement( object ) {

	releaseVideoAudio( object );
	const video = object.__fccVideo;
	if ( object.__fccVideoTexture ) {

		object.__fccVideoTexture.dispose();
		object.__fccVideoTexture = null;

	}
	if ( video ) {

		video.pause();
		video.removeAttribute( 'src' );
		video.load();
		object.__fccVideo = null;

	}
	if ( object.__fccVideoUrl ) {

		URL.revokeObjectURL( object.__fccVideoUrl );
		object.__fccVideoUrl = '';

	}

}

function releaseAllMedia( object ) {

	releaseVideoElement( object );
	releaseMediaExtras( object );
	object.__fccVideoBytes = null;
	object.__fccGifBytes = null;

}

function attachVideoBuffer( object, buffer, fileName, mime ) {

	if ( ! isFccVideoPlayer( object ) || ! buffer ) return;
	const vp = object.userData[ VP_KEY ];
	releaseAllMedia( object );
	vp.kind = 'video';
	object.__fccVideoBytes = buffer;
	vp.fileName = fileName || vp.fileName || 'video.mp4';

	const blob = new Blob( [ buffer ], { type: mime || videoMime( vp.fileName ) } );
	const url = URL.createObjectURL( blob );
	const video = document.createElement( 'video' );
	video.crossOrigin = 'anonymous';
	video.playsInline = true;
	video.loop = vp.loop !== false;
	video.playbackRate = getPlaybackRate( object );
	video.muted = true;
	video.volume = 1;
	video.autoplay = vp.playing !== false;
	video.src = url;
	object.__fccVideo = video;
	object.__fccVideoUrl = url;

	const texture = new THREE.VideoTexture( video );
	texture.colorSpace = THREE.SRGBColorSpace;
	texture.minFilter = THREE.LinearFilter;
	texture.magFilter = THREE.LinearFilter;
	texture.generateMipmaps = false;
	object.__fccVideoTexture = texture;

	if ( vp.playing !== false ) {

		video.play().catch( () => {} );

	}

}

function assignVideoFile( object, file ) {

	return new Promise( ( resolve, reject ) => {

		if ( ! file || ! isFccVideoPlayer( object ) ) {

			resolve( false );
			return;

		}
		const reader = new FileReader();
		reader.addEventListener( 'load', () => {

			const buffer = reader.result;
			object.userData[ VP_KEY ].projectPath = '';
			attachVideoBuffer( object, buffer, file.name, file.type || videoMime( file.name ) );
			resolve( true );

		} );
		reader.addEventListener( 'error', () => reject( reader.error ) );
		reader.readAsArrayBuffer( file );

	} );

}

function assignGifFile( object, file ) {

	return new Promise( ( resolve, reject ) => {

		if ( ! file || ! isFccVideoPlayer( object ) ) {

			resolve( false );
			return;

		}
		const reader = new FileReader();
		reader.addEventListener( 'load', async () => {

			try {

				releaseVideoElement( object );
				object.__fccVideoBytes = null;
				object.userData[ VP_KEY ].projectPath = '';
				const ok = await attachGifBuffer( object, reader.result, file.name );
				resolve( !! ok );

			} catch ( e ) {

				reject( e );

			}

		} );
		reader.addEventListener( 'error', () => reject( reader.error ) );
		reader.readAsArrayBuffer( file );

	} );

}

/**
 * Attach image sequence from a FileList / array of Files (webkitdirectory) or project dir.
 */
async function assignSequenceFromFiles( object, fileList, opts ) {

	if ( ! object || ! isFccVideoPlayer( object ) ) return false;
	opts = opts || {};
	const raw = Array.from( fileList || [] ).filter( ( f ) => f && IMAGE_EXT.test( f.name ) );
	if ( ! raw.length ) return false;
	// webkitdirectory: prefer basename; keep only files in the chosen folder (not nested extras)
	const files = raw.slice();
	files.sort( ( a, b ) => a.name.localeCompare( b.name, undefined, { numeric: true, sensitivity: 'base' } ) );
	const map = new Map();
	for ( const f of files ) map.set( f.name, f );
	releaseVideoElement( object );
	object.__fccVideoBytes = null;
	const vp = object.userData[ VP_KEY ];
	if ( opts.fps ) vp.sequenceFps = opts.fps;
	let dirRel = opts.dirRel || '';
	if ( ! dirRel ) {

		// Infer folder name from webkitRelativePath (e.g. MySeq/001.png) or opts.folderName
		const rel = ( files[ 0 ] && files[ 0 ].webkitRelativePath ) || '';
		const top = rel.split( /[/\\]/ ).filter( Boolean )[ 0 ] || opts.folderName || 'sequence';
		dirRel = 'assets/sequences/' + String( top ).replace( /[<>:"/\\|?*]/g, '_' );

	}
	vp.projectPath = dirRel;
	vp.sequenceDir = dirRel;
	return attachImageSequence( object, {
		names: files.map( ( f ) => f.name ),
		dirRel,
		files: map,
		fps: vp.sequenceFps,
		sequenceStart: vp.sequenceStart,
		sequenceEnd: vp.sequenceEnd,
		readBinary: opts.readBinary || null,
	} );

}

/**
 * Pick a folder (File System Access) and bind as imageSequence for live play.
 * Does NOT copy frames into the project — flushFccVideosToProject does that on Save
 * (same contract as video: bind on pick, persist on saveToFolder).
 */
async function assignSequenceFromDirectoryPicker( object, editor, opts ) {

	if ( ! object || ! isFccVideoPlayer( object ) ) return false;
	opts = opts || {};
	if ( typeof window.showDirectoryPicker !== 'function' ) {

		console.warn( '[FreeFilmCut] showDirectoryPicker not available; use the folder file input' );
		return false;

	}
	let dirHandle;
	try {

		dirHandle = await window.showDirectoryPicker( { mode: 'read' } );

	} catch ( e ) {

		return false; // user cancelled

	}
	if ( ! dirHandle ) return false;

	const files = [];
	try {

		for await ( const entry of dirHandle.values() ) {

			if ( entry.kind !== 'file' ) continue;
			if ( ! IMAGE_EXT.test( entry.name ) ) continue;
			files.push( await entry.getFile() );

		}

	} catch ( e ) {

		console.warn( '[FreeFilmCut] read sequence folder', e );
		return false;

	}
	if ( ! files.length ) {

		console.warn( '[FreeFilmCut] no image frames in folder:', dirHandle.name );
		return false;

	}

	const folderName = String( dirHandle.name || 'sequence' ).replace( /[<>:"/\\|?*]/g, '_' ) || 'sequence';
	// Intended project path after Save; live play uses FileMap until then.
	const dirRel = 'assets/sequences/' + folderName;
	return assignSequenceFromFiles( object, files, {
		fps: opts.fps,
		dirRel,
		folderName,
	} );

}

async function assignSequenceFromProject( object, editor, dirRel, opts ) {

	if ( ! object || ! isFccVideoPlayer( object ) || ! editor ) return false;
	const pf = editor.projectFolder;
	if ( ! pf || ! pf.hasFolder || ! pf.hasFolder() ) return false;
	opts = opts || {};
	dirRel = String( dirRel || '' ).replace( /\\/g, '/' ).replace( /\/$/, '' );
	let names = await pf.listAssetFiles( dirRel );
	let images = ( names || [] ).filter( ( n ) => IMAGE_EXT.test( n ) );
	// Bare assets/sequences is a reserved container — look into a single child folder if needed.
	if ( ! images.length && dirRel === 'assets/sequences' && typeof pf.listAssetDirs === 'function' ) {

		const subs = await pf.listAssetDirs( dirRel );
		if ( subs && subs.length === 1 ) {

			dirRel = dirRel + '/' + subs[ 0 ];
			names = await pf.listAssetFiles( dirRel );
			images = ( names || [] ).filter( ( n ) => IMAGE_EXT.test( n ) );

		}

	}
	if ( ! images.length ) return false;
	releaseVideoElement( object );
	object.__fccVideoBytes = null;
	const vp = object.userData[ VP_KEY ];
	if ( opts.fps ) vp.sequenceFps = opts.fps;
	vp.projectPath = dirRel;
	vp.sequenceDir = dirRel;
	return attachImageSequence( object, {
		names: images,
		dirRel,
		fps: vp.sequenceFps,
		sequenceStart: vp.sequenceStart,
		sequenceEnd: vp.sequenceEnd,
		readBinary: async ( rel ) => pf.readBinaryFile( rel ),
	} );

}

function syncVideoElement( object ) {

	const video = object.__fccVideo;
	const vp = object.userData[ VP_KEY ];
	if ( ! video || ! vp ) return;
	if ( mediaKind( object ) !== 'video' ) return;
	if ( vp.volume === undefined ) {

		vp.volume = 1;
		vp.muted = false;

	}
	if ( object.__fccSound ) {

		video.muted = false;
		video.volume = 1;
		applyVideoPlayerGain( object );

	} else {

		video.muted = true;

	}
	// Timeline owns transport while previewing — do not fight seekVideoPlayer play/pause.
	if ( typeof window !== 'undefined' && window.editor && window.editor.timelinePreviewOwnsAnim ) {

		video.loop = false;
		video.playbackRate = getPlaybackRate( object );
		return;

	}

	video.loop = vp.loop !== false;
	video.playbackRate = getPlaybackRate( object );

	if ( vp.playing === false ) {

		if ( ! video.paused ) video.pause();

	} else if ( video.paused && video.readyState >= 2 ) {

		video.play().catch( () => {} );

	}

}

const MATERIAL_TEXTURE_KEYS = [
	'map', 'alphaMap', 'aoMap', 'bumpMap', 'displacementMap', 'emissiveMap',
	'envMap', 'lightMap', 'metalnessMap', 'normalMap', 'roughnessMap',
	'specularMap', 'gradientMap', 'matcap',
];

function liveRenderTextureMap( scene ) {

	const live = new Map();
	if ( ! scene ) return live;
	scene.traverse( ( object ) => {

		if ( ! isFccRenderTexture( object ) ) return;
		const rt = ensureRenderTarget( object );
		if ( rt && rt.texture ) live.set( object.uuid, rt.texture );

	} );
	return live;

}

function swapRenderTexture( texture, live ) {

	if ( ! texture || ! texture.isTexture ) return texture;
	const id = texture.userData && texture.userData.fccRenderTextureUuid;
	if ( ! id ) return texture;
	const next = live.get( id );
	return next || texture;

}

/**
 * ObjectLoader restores an RT as an empty Texture (no GPU target).
 * Point every material / uniform that remembered fccRenderTextureUuid
 * back at the live render-target texture.
 */
function rebindFccRenderTextures( scene ) {

	const live = liveRenderTextureMap( scene );
	if ( live.size === 0 ) return 0;

	let rebound = 0;

	function applyTextureSlot( owner, key ) {

		const current = owner[ key ];
		if ( ! current || ! current.isTexture ) return;
		const next = swapRenderTexture( current, live );
		if ( next !== current ) {

			owner[ key ] = next;
			rebound ++;

		}

	}

	scene.traverse( ( object ) => {

		const materials = Array.isArray( object.material ) ? object.material : ( object.material ? [ object.material ] : null );
		if ( ! materials ) return;

		for ( let i = 0; i < materials.length; i ++ ) {

			const material = materials[ i ];
			if ( ! material ) continue;
			let touched = false;

			for ( let k = 0; k < MATERIAL_TEXTURE_KEYS.length; k ++ ) {

				const key = MATERIAL_TEXTURE_KEYS[ k ];
				const before = material[ key ];
				applyTextureSlot( material, key );
				if ( material[ key ] !== before ) touched = true;

			}

			if ( material.uniforms ) {

				for ( const name in material.uniforms ) {

					const entry = material.uniforms[ name ];
					if ( ! entry || ! entry.value || ! entry.value.isTexture ) continue;
					const next = swapRenderTexture( entry.value, live );
					if ( next !== entry.value ) {

						entry.value = next;
						touched = true;
						rebound ++;

					}

				}

			}

			// Flower texture fill / shader slots authored as rt:<uuid>
			const slots = material.userData && material.userData.fccRtSlots;
			if ( Array.isArray( slots ) ) {

				for ( let s = 0; s < slots.length; s ++ ) {

					const slot = slots[ s ];
					if ( ! slot || ! slot.uuid || ! slot.key ) continue;
					const texture = live.get( slot.uuid );
					if ( ! texture ) continue;
					if ( slot.key === 'map' && material.map !== texture ) {

						material.map = texture;
						touched = true;
						rebound ++;

					}
					if ( material.uniforms && material.uniforms[ slot.key ] ) {

						const entry = material.uniforms[ slot.key ];
						if ( entry.value !== texture ) {

							entry.value = texture;
							touched = true;
							rebound ++;

						}
						if ( material.uniforms.useMap ) material.uniforms.useMap.value = true;
						if ( slot.key === 'uFccTex' && material.uniforms.uFccTexUse ) {

							material.uniforms.uFccTexUse.value = 1;

						}

					}

				}

			}

			if ( touched ) material.needsUpdate = true;

		}

	} );

	if ( scene.background && scene.background.isTexture ) {

		const next = swapRenderTexture( scene.background, live );
		if ( next !== scene.background ) scene.background = next;

	}

	if ( scene.environment && scene.environment.isTexture ) {

		const next = swapRenderTexture( scene.environment, live );
		if ( next !== scene.environment ) scene.environment = next;

	}

	return rebound;

}

function fccVideoPlaying( scene ) {

	if ( ! scene ) return false;
	let playing = false;
	scene.traverse( ( object ) => {

		if ( playing || ! isFccVideoPlayer( object ) ) return;
		const vp = object.userData[ VP_KEY ];
		if ( ! vp || ! vp.targetUuid ) return;
		const kind = mediaKind( object );
		if ( kind === 'video' ) {

			const video = object.__fccVideo;
			if ( ! video || vp.playing === false ) return;
			if ( video.readyState >= 2 ) playing = true;
			return;

		}
		// gif / sequence: keep ticking while active (timeline scrub/play) or free-play flag
		if ( object.__fccMediaActive !== false && vp.playing !== false ) {

			if ( object.__fccGif || object.__fccSeq ) playing = true;

		}

	} );
	return playing;

}

function blitTextureToRT( renderer, texture, rt, opts ) {

	opts = opts || {};
	const hasAlpha = !! opts.hasAlpha;
	_blitMat.map = texture;
	// Keep transparent true so map alpha is not forced to 1; NoBlending = RGBA copy.
	_blitMat.transparent = true;
	_blitMat.blending = THREE.NoBlending;
	_blitMat.needsUpdate = true;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.autoClear = false;
	renderer.setRenderTarget( rt );
	renderer.setViewport( 0, 0, rt.width, rt.height );
	renderer.setScissorTest( false );
	renderer.getClearColor( _clearColor );
	const prevAlpha = renderer.getClearAlpha();
	// gif/seq: clear a=0 so source alpha is the RT alpha. video: opaque black.
	if ( hasAlpha ) {

		renderer.setClearColor( 0x000000, 0 );

	} else {

		renderer.setClearColor( 0x000000, 1 );

	}
	renderer.clear( true, true, true );
	renderer.render( _blitScene, _blitCam );
	renderer.setClearColor( _clearColor, prevAlpha );
	if ( rt && rt.texture ) {

		rt.texture.userData = rt.texture.userData || {};
		rt.texture.userData.fccHasAlpha = hasAlpha;
		rt.texture.premultipliedAlpha = false;

	}

}

/**
 * Clear an RT to empty (transparent for gif/seq, opaque black for video).
 * Same renderer contract as blitTextureToRT: leaves the RT bound; caller restores.
 * Used when Timeline is outside the MediaFramePlayer's clip range so the last
 * frame does not linger on materials that sample the RT.
 */
function clearRenderTargetEmpty( renderer, rt, opts ) {

	if ( ! renderer || ! rt ) return;
	opts = opts || {};
	const hasAlpha = opts.hasAlpha !== false;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.autoClear = false;
	renderer.setRenderTarget( rt );
	renderer.setViewport( 0, 0, rt.width, rt.height );
	renderer.setScissorTest( false );
	renderer.getClearColor( _clearColor );
	const prevAlpha = renderer.getClearAlpha();
	if ( hasAlpha ) {

		renderer.setClearColor( 0x000000, 0 );

	} else {

		renderer.setClearColor( 0x000000, 1 );

	}
	renderer.clear( true, true, true );
	renderer.setClearColor( _clearColor, prevAlpha );
	if ( rt.texture ) {

		rt.texture.userData = rt.texture.userData || {};
		rt.texture.userData.fccHasAlpha = hasAlpha;
		rt.texture.premultipliedAlpha = false;

	}

}

function updateFccVideos( renderer, scene ) {

	if ( ! renderer || ! scene ) return;

	rebindFccRenderTextures( scene );
	tryRoutePlayingVideos( scene );

	const players = [];
	scene.traverse( ( object ) => {

		if ( isFccVideoPlayer( object ) ) players.push( object );

	} );
	if ( players.length === 0 ) return;

	const prevTarget = renderer.getRenderTarget();
	const prevAutoClear = renderer.autoClear;
	const prevTone = renderer.toneMapping;
	const prevViewport = new THREE.Vector4();
	const prevScissor = new THREE.Vector4();
	renderer.getViewport( prevViewport );
	renderer.getScissor( prevScissor );
	const prevScissorTest = renderer.getScissorTest();
	const timelineOwns = typeof window !== 'undefined' && window.editor && window.editor.timelinePreviewOwnsAnim;

	for ( let i = 0; i < players.length; i ++ ) {

		const object = players[ i ];
		const vp = object.userData[ VP_KEY ];
		if ( ! vp || ! vp.targetUuid ) continue;
		const kind = mediaKind( object );
		const target = findRenderTextureObject( scene, vp.targetUuid );
		const rt = ensureRenderTarget( target );
		if ( ! rt ) continue;

		/**
		 * Timeline parked this player outside its clip (`seekVideoPlayer(null)`).
		 * Clear the RT once so the last frame does not linger; skip further blit.
		 */
		if ( timelineOwns && object.__fccMediaActive === false ) {

			if ( ! object.__fccRtClearedForInactive ) {

				clearRenderTargetEmpty( renderer, rt, {
					hasAlpha: kind !== 'video',
				} );
				ensureMaterialsShowRtAlpha( scene, rt.texture );
				object.__fccRtClearedForInactive = true;

			}
			continue;

		}

		if ( kind === 'video' ) {

			syncVideoElement( object );
			const video = object.__fccVideo;
			const texture = object.__fccVideoTexture;
			if ( ! video || ! texture ) continue;
			if ( video.readyState < 2 ) continue;
			texture.needsUpdate = true;
			blitTextureToRT( renderer, texture, rt, { hasAlpha: false } );
			ensureMaterialsShowRtAlpha( scene, rt.texture );
			object.__fccRtClearedForInactive = false;
			continue;

		}

		// gif / imageSequence — timeline seek sets __fccMediaTime; without timeline, advance by clock if playing
		if ( ! timelineOwns && vp.playing !== false && object.__fccMediaActive !== false ) {

			const dur = getMediaDurationSec( object );
			if ( dur > 0 ) {

				const now = performance.now() / 1000;
				if ( object.__fccMediaWallStart == null ) {

					object.__fccMediaWallStart = now;
					object.__fccMediaTime = object.__fccMediaTime || 0;

				}
				let t = ( now - object.__fccMediaWallStart );
				if ( vp.loop !== false ) t = ( ( t % dur ) + dur ) % dur;
				object.__fccMediaTime = t;
				object.__fccMediaActive = true;

			}

		} else if ( timelineOwns ) {

			object.__fccMediaWallStart = null;

		}

		if ( object.__fccMediaActive === false ) continue;
		const tex = sampleMediaFrameSync( object, {
			loop: vp.loop !== false,
			playing: vp.playing !== false || timelineOwns,
		} );
		if ( ! tex ) continue;
		blitTextureToRT( renderer, tex, rt, { hasAlpha: true } );
		ensureMaterialsShowRtAlpha( scene, rt.texture );
		object.__fccRtClearedForInactive = false;

	}

	_blitMat.map = null;
	renderer.toneMapping = prevTone;
	renderer.autoClear = prevAutoClear;
	renderer.setRenderTarget( prevTarget );
	renderer.setViewport( prevViewport );
	renderer.setScissor( prevScissor );
	renderer.setScissorTest( prevScissorTest );

}

function disposeFccMedia( object ) {

	if ( ! object ) return;
	object.traverse( ( child ) => {

		releaseAllMedia( child );
		if ( child.__fccRT ) {

			child.__fccRT.dispose();
			child.__fccRT = null;

		}

	} );

}

async function flushFccVideosToProject( editor ) {

	const result = { saved: 0 };
	const pf = editor && editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) return result;
	if ( typeof pf.saveBlob !== 'function' || ! editor.scene ) return result;

	const players = [];
	editor.scene.traverse( ( object ) => {

		if ( isFccVideoPlayer( object ) ) players.push( object );

	} );

	for ( const object of players ) {

		const vp = object.userData[ VP_KEY ];
		const kind = mediaKind( object );

		if ( kind === 'video' && object.__fccVideoBytes ) {

			const safe = safeVideoName( vp.fileName );
			const ok = await pf.saveBlob( 'assets/videos', safe, object.__fccVideoBytes );
			if ( ok ) {

				vp.projectPath = 'assets/videos/' + safe;
				vp.fileName = safe;
				result.saved ++;

			}
			continue;

		}

		if ( kind === 'gif' && object.__fccGifBytes ) {

			const safe = safeGifName( vp.fileName );
			const ok = await pf.saveBlob( 'assets/textures', safe, object.__fccGifBytes );
			if ( ok ) {

				vp.projectPath = 'assets/textures/' + safe;
				vp.fileName = safe;
				result.saved ++;

			}
			continue;

		}

		if ( kind === 'imageSequence' && object.__fccSeq && object.__fccSeq.fileMap && object.__fccSeq.fileMap.size ) {

			const folder = String( vp.sequenceDir || ( 'assets/sequences/' + ( object.name || 'seq' ).replace( /[\\/:*?"<>|]/g, '_' ) ) );
			const parts = folder.replace( /\\/g, '/' ).split( '/' ).filter( Boolean );
			const subdir = parts.join( '/' );
			let n = 0;
			for ( const [ name, file ] of object.__fccSeq.fileMap ) {

				const ok = await pf.saveBlob( subdir, name, file );
				if ( ok ) n ++;

			}
			if ( n ) {

				vp.sequenceDir = subdir;
				vp.projectPath = subdir;
				// Switch to project reader for subsequent LRU loads
				attachImageSequence( object, {
					names: object.__fccSeq.names.slice(),
					dirRel: subdir,
					fps: object.__fccSeq.fps,
					sequenceStart: vp.sequenceStart,
					sequenceEnd: vp.sequenceEnd,
					readBinary: async ( rel ) => pf.readBinaryFile( rel ),
				} );
				result.saved += n;

			}

		}

	}

	return result;

}

async function restoreFccVideosFromProject( editor, root = null ) {

	const pf = editor && editor.projectFolder;
	if ( ! pf || typeof pf.hasFolder !== 'function' || ! pf.hasFolder() ) return;
	if ( typeof pf.readBinaryFile !== 'function' ) return;
	const scene = root || editor.scene;
	if ( ! scene ) return;

	const players = [];
	scene.traverse( ( object ) => {

		if ( ! isFccVideoPlayer( object ) ) return;
		players.push( object );

	} );

	for ( const object of players ) {

		const vp = object.userData[ VP_KEY ];
		if ( ! vp ) continue;
		const kind = mediaKind( object );

		if ( kind === 'video' ) {

			if ( object.__fccVideo ) continue;
			const tryPaths = [];
			if ( vp.projectPath ) tryPaths.push( vp.projectPath );
			if ( vp.fileName ) tryPaths.push( 'assets/videos/' + String( vp.fileName ).split( /[/\\]/ ).pop() );
			let bin = null;
			for ( const path of tryPaths ) {

				bin = await pf.readBinaryFile( path );
				if ( bin && bin.buffer ) {

					vp.projectPath = path;
					break;

				}

			}
			if ( ! bin || ! bin.buffer ) {

				console.warn( '[FreeFilmCut] restore video missing', object.name || object.uuid, tryPaths );
				continue;

			}
			attachVideoBuffer( object, bin.buffer, bin.name || vp.fileName, videoMime( bin.name || vp.fileName ) );
			continue;

		}

		if ( kind === 'gif' ) {

			if ( object.__fccGif ) continue;
			const tryPaths = [];
			if ( vp.projectPath ) tryPaths.push( vp.projectPath );
			if ( vp.fileName ) tryPaths.push( 'assets/textures/' + String( vp.fileName ).split( /[/\\]/ ).pop() );
			let bin = null;
			for ( const path of tryPaths ) {

				bin = await pf.readBinaryFile( path );
				if ( bin && bin.buffer ) {

					vp.projectPath = path;
					break;

				}

			}
			if ( ! bin || ! bin.buffer ) {

				console.warn( '[FreeFilmCut] restore gif missing', object.name || object.uuid, tryPaths );
				continue;

			}
			await attachGifBuffer( object, bin.buffer, bin.name || vp.fileName );
			continue;

		}

		if ( kind === 'imageSequence' ) {

			if ( object.__fccSeq ) continue;
			const dir = vp.sequenceDir || vp.projectPath;
			if ( ! dir ) {

				console.warn( '[FreeFilmCut] restore sequence missing dir', object.name || object.uuid );
				continue;

			}
			await assignSequenceFromProject( object, editor, dir );

		}

	}

}

/**
 * Drive MediaFramePlayer from Timeline (video free-run; gif/seq force sample every seek).
 */
function seekVideoPlayer( object, mediaTimeSec, opts ) {

	if ( ! object || ! isFccVideoPlayer( object ) ) return;
	const kind = mediaKind( object );
	opts = opts || {};

	if ( kind === 'gif' || kind === 'imageSequence' ) {

		seekMediaFrame( object, mediaTimeSec, opts );
		// Force sync sample so RT updates this frame even before RAF blit.
		if ( mediaTimeSec != null && Number.isFinite( Number( mediaTimeSec ) ) ) {

			sampleMediaFrameSync( object, {
				loop: !! opts.loop || ( object.userData[ VP_KEY ].loop !== false ),
				playing: !! opts.playing,
			} );

		}
		return;

	}

	const video = object.__fccVideo;
	if ( ! video ) return;
	const wantPlay = !! opts.playing;
	const clipKey = opts.clipKey != null ? String( opts.clipKey ) : '';

	if ( mediaTimeSec == null || ! Number.isFinite( Number( mediaTimeSec ) ) ) {

		object.__fccTlVideoClipKey = '';
		object.__fccMediaActive = false;
		object.__fccMediaTime = null;
		if ( ! video.paused ) video.pause();
		return;

	}

	object.__fccMediaActive = true;
	object.__fccMediaTime = Number( mediaTimeSec ) || 0;

	let t = ( Number( mediaTimeSec ) || 0 ) * getPlaybackRate( object );
	const d = Number( video.duration );
	if ( Number.isFinite( d ) && d > 0 ) {

		if ( opts.loop ) t = ( ( t % d ) + d ) % d;
		else t = Math.max( 0, Math.min( d - 0.001, t ) );

	}

	const prevKey = object.__fccTlVideoClipKey || '';
	const clipChanged = clipKey !== '' && clipKey !== prevKey;
	if ( clipKey ) object.__fccTlVideoClipKey = clipKey;

	const VIDEO_SEEK_SCRUB = 1 / 60;
	const VIDEO_SEEK_PLAY = 0.2;
	const drift = Math.abs( ( video.currentTime || 0 ) - t );
	if ( wantPlay ) {

		if ( clipChanged || video.paused || drift > VIDEO_SEEK_PLAY ) {

			try { video.currentTime = t; } catch ( e ) { /* ignore */ }

		}
		if ( video.paused ) video.play().catch( () => {} );

	} else {

		if ( drift > VIDEO_SEEK_SCRUB ) {

			try { video.currentTime = t; } catch ( e ) { /* ignore */ }

		}
		if ( ! video.paused ) video.pause();

	}

}

export {
	RT_KEY,
	VP_KEY,
	isFccRenderTexture,
	isFccVideoPlayer,
	createRenderTextureObject,
	createVideoPlayerObject,
	createMediaPlayerObject,
	ensureRenderTarget,
	normalizeRtWrapMode,
	applyRtTextureWrap,
	getRenderTexture,
	textureForRenderTextureUuid,
	listRenderTextureOptions,
	assignVideoFile,
	assignGifFile,
	assignSequenceFromFiles,
	assignSequenceFromDirectoryPicker,
	assignSequenceFromProject,
	attachVideoBuffer,
	attachGifBuffer,
	attachImageSequence,
	mediaKind,
	getPlaybackRate,
	getMediaDurationSec,
	seekVideoPlayer,
	fccVideoPlaying,
	rebindFccRenderTextures,
	updateFccVideos,
	disposeFccMedia,
	flushFccVideosToProject,
	restoreFccVideosFromProject,
	SEQ_LRU_AHEAD,
	SEQ_LRU_BEHIND,
	SEQ_LRU_MAX,
	buildSequenceFileList,
};
