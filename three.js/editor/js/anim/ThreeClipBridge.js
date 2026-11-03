/**
 * Bridge: THREE.AnimationClip (GLB/FBX/Blender) preview via AnimationMixer,
 * and convert to FreeFilmCut freecapcut.anim/1 for vfxpack export.
 * Skeletal: preview uses mixer (full bones). Convert maps bone tracks to Bone.uuid.
 */
import * as THREE from 'three';
import {
	createEmptyAnim,
	ensureTarget,
	ensureTrack,
	upsertKey,
	recomputeDuration,
	uniqueAnimName,
} from './FreeCapCutAnimCore.js?v=fcc-anim-20';

/** @returns {{ root: THREE.Object3D|null, clips: THREE.AnimationClip[] }} */
export function findThreeClipsNear( object ) {

	if ( ! object ) return { root: null, clips: [] };

	let o = object;
	while ( o ) {

		if ( Array.isArray( o.animations ) && o.animations.length > 0 ) {

			return { root: o, clips: o.animations.slice() };

		}
		o = o.parent;

	}

	let found = null;
	object.traverse( ( child ) => {

		if ( found ) return;
		if ( Array.isArray( child.animations ) && child.animations.length > 0 ) {

			found = child;

		}

	} );
	if ( found ) return { root: found, clips: found.animations.slice() };
	return { root: null, clips: [] };

}

function ensurePreviewState( editor ) {

	if ( ! editor._threeClipPreview ) {

		editor._threeClipPreview = {
			action: null,
			root: null,
			clip: null,
			actions: [],
		};

	}
	return editor._threeClipPreview;

}

/** True while a THREE (Blender) clip is being previewed — FreeFilmCut sampling should pause. */
export function isThreeClipPreviewActive( editor ) {

	const st = editor && editor._threeClipPreview;
	return !!( st && st.action && st.action.isRunning && st.action.isRunning() );

}

export function isThreeClipPreviewHeld( editor ) {

	const st = editor && editor._threeClipPreview;
	return !!( st && st.action );

}

export function stopThreeClipPreview( editor ) {

	if ( ! editor || ! editor.mixer ) return;
	const st = ensurePreviewState( editor );
	if ( st.actions && st.actions.length ) {

		for ( const a of st.actions ) {

			try {

				a.stop();
				editor.mixer.uncacheAction( a.getClip(), st.root || undefined );

			} catch ( e ) { /* ignore */ }

		}

	} else if ( st.action ) {

		try {

			st.action.stop();

		} catch ( e ) { /* ignore */ }

	}
	st.action = null;
	st.root = null;
	st.clip = null;
	st.actions = [];

}

/**
 * Play a THREE.AnimationClip on imported root (skeletal via optionalRoot binding).
 * Uses editor.mixer so Viewport already updates it.
 */
export function playThreeClip( editor, root, clip, opts = {} ) {

	if ( ! editor || ! editor.mixer || ! root || ! clip ) return null;
	stopThreeClipPreview( editor );
	const st = ensurePreviewState( editor );
	const action = editor.mixer.clipAction( clip, root );
	action.reset();
	const loop = opts.loop !== false;
	action.setLoop( loop ? THREE.LoopRepeat : THREE.LoopOnce, Infinity );
	action.clampWhenFinished = ! loop;
	action.enabled = true;
	action.paused = false;
	action.play();
	st.action = action;
	st.root = root;
	st.clip = clip;
	st.actions = [ action ];
	return action;

}

/** Scrub preview to time (seconds); keeps action enabled so bones stay posed. */
export function scrubThreeClip( editor, timeSec ) {

	const st = editor && editor._threeClipPreview;
	if ( ! st || ! st.action || ! editor.mixer ) return;
	const dur = st.clip && st.clip.duration > 0 ? st.clip.duration : 0;
	let t = Number( timeSec ) || 0;
	if ( dur > 0 ) t = Math.max( 0, Math.min( dur, t ) );
	st.action.paused = true;
	st.action.enabled = true;
	st.action.time = t;
	st.action.play();
	editor.mixer.update( 0 );
	st.action.paused = true;

}

/**
 * Resolve a track to a scene Object3D (Bone / Mesh / Object3D).
 * Uses PropertyBinding relative to imported root.
 */
function resolveTrackTarget( root, trackName ) {

	const parsed = THREE.PropertyBinding.parseTrackName( trackName );
	let node = THREE.PropertyBinding.findNode( root, parsed.nodeName );
	if ( ! node && ( parsed.nodeName === '' || parsed.nodeName == null ) ) {

		node = root;

	}
	if ( ! node ) return { object: null, propertyName: parsed.propertyName, parsed };

	// SkinnedMesh .bones[i] → actual Bone
	if ( parsed.objectName === 'bones' && parsed.objectIndex !== undefined && parsed.objectIndex !== null ) {

		const idx = parseInt( parsed.objectIndex, 10 );
		if ( node.skeleton && Array.isArray( node.skeleton.bones ) && node.skeleton.bones[ idx ] ) {

			node = node.skeleton.bones[ idx ];

		} else if ( node.isSkinnedMesh && node.skeleton && node.skeleton.bones[ idx ] ) {

			node = node.skeleton.bones[ idx ];

		}

	}

	return { object: node, propertyName: parsed.propertyName, parsed };

}

function writeVectorTracks( fccClip, objectUuid, prop, times, values, stride ) {

	const axes = [ 'x', 'y', 'z' ];
	const n = Math.min( 3, stride );
	const target = ensureTarget( fccClip, objectUuid );
	for ( let a = 0; a < n; a ++ ) {

		const tr = ensureTrack( target, prop + '.' + axes[ a ], 'linear' );
		for ( let i = 0; i < times.length; i ++ ) {

			upsertKey( tr, times[ i ], values[ i * stride + a ] );

		}

	}

}

function writeQuaternionAsEuler( fccClip, object, times, values, stride ) {

	const order = ( object.rotation && object.rotation.order ) || 'XYZ';
	const quat = new THREE.Quaternion();
	const euler = new THREE.Euler();
	const target = ensureTarget( fccClip, object.uuid );
	const tx = ensureTrack( target, 'rotation.x', 'linear' );
	const ty = ensureTrack( target, 'rotation.y', 'linear' );
	const tz = ensureTrack( target, 'rotation.z', 'linear' );
	for ( let i = 0; i < times.length; i ++ ) {

		const o = i * stride;
		quat.set( values[ o ], values[ o + 1 ], values[ o + 2 ], values[ o + 3 ] ).normalize();
		euler.setFromQuaternion( quat, order );
		upsertKey( tx, times[ i ], euler.x );
		upsertKey( ty, times[ i ], euler.y );
		upsertKey( tz, times[ i ], euler.z );

	}

}

/**
 * Convert THREE.AnimationClip → freecapcut.anim/1 and register in editor.
 * Bone tracks → Bone.uuid. Morph targets skipped (console.warn).
 * @returns {{ clip: object, stats: { tracks: number, skipped: number, bones: number } }}
 */
export function convertThreeClipToFreecapcut( editor, root, threeClip ) {

	const stats = { tracks: 0, skipped: 0, bones: 0, unresolved: 0 };
	if ( ! editor || ! root || ! threeClip ) {

		return { clip: null, stats };

	}

	const fpsGuess = 30;
	const name = uniqueAnimName( editor, threeClip.name || root.name || 'Imported' );
	const fcc = createEmptyAnim( name, fpsGuess );
	fcc.duration = Math.max( 0.01, Number( threeClip.duration ) || 1 );
	fcc.loop = 'clamp';

	const tracks = threeClip.tracks || [];
	for ( const track of tracks ) {

		if ( ! track || ! track.name ) {

			stats.skipped ++;
			continue;

		}
		const { object, propertyName } = resolveTrackTarget( root, track.name );
		if ( ! object ) {

			console.warn( '[FreeFilmCut] convert: unresolved track', track.name );
			stats.unresolved ++;
			stats.skipped ++;
			continue;

		}
		const prop = String( propertyName || '' );
		if ( prop === 'morphTargetInfluences' || prop.indexOf( 'morphTarget' ) === 0 ) {

			console.warn( '[FreeFilmCut] convert: skip morph track', track.name );
			stats.skipped ++;
			continue;

		}

		const times = track.times;
		const values = track.values;
		const stride = typeof track.getValueSize === 'function' ? track.getValueSize() : 3;
		if ( ! times || ! values || times.length === 0 ) {

			stats.skipped ++;
			continue;

		}

		if ( object.isBone ) stats.bones ++;

		// Do not bake Blender root transform onto the import Group: Editor placement
		// of that parent must survive export. Child / bone tracks stay absolute-local.
		const isImportRoot = object === root;
		const isRootXform = isImportRoot && (
			prop === 'position' || prop === 'scale' || prop === 'quaternion' || prop === 'rotation'
		);
		if ( isRootXform ) {

			console.info( '[FreeFilmCut] convert: skip import-root transform track (keep Editor placement)', track.name );
			stats.skipped ++;
			continue;

		}

		if ( prop === 'position' || prop === 'scale' ) {

			writeVectorTracks( fcc, object.uuid, prop, times, values, stride );
			stats.tracks ++;

		} else if ( prop === 'quaternion' ) {

			writeQuaternionAsEuler( fcc, object, times, values, stride );
			stats.tracks ++;

		} else if ( prop === 'rotation' ) {

			// Euler radians already (rare)
			writeVectorTracks( fcc, object.uuid, 'rotation', times, values, stride );
			stats.tracks ++;

		} else {

			console.warn( '[FreeFilmCut] convert: unsupported property', prop, track.name );
			stats.skipped ++;

		}

	}

	recomputeDuration( fcc );
	if ( ! fcc.duration || fcc.duration < ( threeClip.duration || 0 ) ) {

		fcc.duration = Math.max( fcc.duration || 0, Number( threeClip.duration ) || 0, 0.01 );

	}

	if ( ! editor.freecapcutAnims ) editor.freecapcutAnims = [];
	fcc._export = true;
	const idx = editor.freecapcutAnims.findIndex( ( a ) => a === fcc || ( a && a.name === fcc.name ) );
	if ( idx >= 0 ) editor.freecapcutAnims[ idx ] = fcc;
	else editor.freecapcutAnims.push( fcc );
	editor.activeFreecapcutAnim = fcc;

	if ( ! root.userData ) root.userData = {};
	root.userData.freecapcutAnimController = {
		enabled: true,
		clipId: String( fcc.name || '' ),
		fromThreeClip: String( threeClip.name || '' ),
	};

	return { clip: fcc, stats };

}
