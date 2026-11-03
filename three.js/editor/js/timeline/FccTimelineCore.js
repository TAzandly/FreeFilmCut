/**
 * FreeFilmCut Timeline core — sample + asset helpers (editor).
 * Format must match NLE `vfxpack/timeline.ts`.
 */
import * as THREE from 'three';
import { applyAnimToRoot } from '../anim/FreeCapCutAnimCore.js?v=fcc-anim-20';

export const TIMELINE_FORMAT = 'freecapcut-timeline/1';
export const TL_KEY = 'fccTimeline';

export function createEmptyTimelineAsset( name = 'Timeline', fps = 30 ) {
	return {
		format: TIMELINE_FORMAT,
		name: String( name || 'Timeline' ),
		fps: Number( fps ) || 30,
		duration: 1,
		loop: 'clamp',
		tracks: [],
	};
}

export function isFccTimeline( object ) {
	return !!( object && object.userData && object.userData[ TL_KEY ] );
}

export function createTimelineObject( scene ) {
	const names = new Set();
	if ( scene ) scene.traverse( ( o ) => names.add( o.name ) );
	let name = 'Timeline';
	let i = 2;
	while ( names.has( name ) ) { name = 'Timeline' + i; i ++; }
	const object = new THREE.Object3D();
	object.name = name;
	object.userData[ TL_KEY ] = {
		projectPath: '',
		active: false,
		fps: 30,
		duration: 1,
		loop: 'clamp',
	};
	return object;
}

export function snapTimeToFrame( t, fps ) {
	const f = Math.max( 1, Number( fps ) || 30 );
	return Math.round( ( Number( t ) || 0 ) * f ) / f;
}

export function computeContentDuration( asset ) {
	let max = 0;
	for ( const track of asset.tracks || [] ) {
		for ( const clip of track.clips || [] ) {
			const end = ( Number( clip.start ) || 0 ) + ( Number( clip.duration ) || 0 );
			if ( end > max ) max = end;
		}
	}
	return Math.max( 0.01, max || Number( asset.duration ) || 0.01 );
}

/**
 * Apply timeline at time t (seconds) onto the scene.
 * @param {object} ctx
 * @param {THREE.Object3D} ctx.scene
 * @param {object} ctx.asset TimelineAsset
 * @param {number} ctx.t seconds
 * @param {Map<string, object>} [ctx.animByName] name -> freecapcut anim clip
 * @param {function} [ctx.seekVideoPlayer] (object, mediaTimeSec, { loop }) => void
 * @param {Set<string>} [ctx.activationBoundUuids] uuids touched by activation (for restore)
 */
export function sampleTimeline( ctx ) {
	const scene = ctx.scene;
	const asset = ctx.asset;
	if ( ! scene || ! asset ) return;
	const fps = asset.fps || 30;
	const dur = Math.max( 0.01, Number( asset.duration ) || 0.01 );
	let tRaw = Number( ctx.t ) || 0;
	if ( asset.loop === 'loop' ) {
		tRaw = ( ( tRaw % dur ) + dur ) % dur;
	} else {
		tRaw = Math.max( 0, Math.min( dur, tRaw ) );
	}
	// Anim/activation snap to frames; video uses continuous time while playing to free-run cleanly.
	const t = snapTimeToFrame( tRaw, fps );
	const tVideo = ctx.timelinePlaying ? tRaw : t;

	const animByName = ctx.animByName || new Map();
	const seekVideo = typeof ctx.seekVideoPlayer === 'function' ? ctx.seekVideoPlayer : null;

	// Activation: collect bound uuids, then force visibility
	const activationBounds = new Map(); // uuid -> array of [start, end)
	for ( const track of asset.tracks || [] ) {
		if ( track.muted || track.type !== 'activation' || ! track.bindingUuid ) continue;
		const list = activationBounds.get( track.bindingUuid ) || [];
		for ( const clip of track.clips || [] ) {
			const start = Number( clip.start ) || 0;
			const end = start + ( Number( clip.duration ) || 0 );
			list.push( [ start, end ] );
		}
		activationBounds.set( track.bindingUuid, list );
	}
	for ( const [ uuid, ranges ] of activationBounds ) {
		const obj = scene.getObjectByProperty( 'uuid', uuid );
		if ( ! obj ) continue;
		if ( ctx.activationBoundUuids ) ctx.activationBoundUuids.add( uuid );
		let visible = false;
		for ( const [ a, b ] of ranges ) {
			if ( t >= a && t < b ) { visible = true; break; }
		}
		obj.visible = visible;
	}

	// Animation tracks (later track / later clip wins)
	for ( const track of asset.tracks || [] ) {
		if ( track.muted || track.type !== 'animation' || ! track.bindingUuid ) continue;
		for ( const clip of track.clips || [] ) {
			const start = Number( clip.start ) || 0;
			const cdur = Number( clip.duration ) || 0;
			if ( t < start || t >= start + cdur ) continue;
			const anim = animByName.get( clip.animId ) || animByName.get( clip.animPath ) || animByName.get( clip.name );
			if ( ! anim ) continue;
			const local = ( t - start ) + ( Number( clip.clipLocalOffset ) || 0 );
			applyAnimToRoot( scene, anim, local, ctx.animOpts || {} );
		}
	}

	// Video tracks — clipKey lets play mode hard-seek only on clip change / large drift
	for ( const track of asset.tracks || [] ) {
		if ( track.muted || track.type !== 'video' ) continue;
		const uuid = track.bindingUuid || track.videoPlayerUuid;
		if ( ! uuid || ! seekVideo ) continue;
		const obj = scene.getObjectByProperty( 'uuid', uuid );
		if ( ! obj ) continue;
		let mediaT = null;
		let mediaLoop = false;
		let clipKey = '';
		for ( const clip of track.clips || [] ) {
			const start = Number( clip.start ) || 0;
			const cdur = Number( clip.duration ) || 0;
			if ( tVideo < start || tVideo >= start + cdur ) continue;
			mediaT = ( tVideo - start ) + ( Number( clip.mediaOffset ) || 0 );
			mediaLoop = !! clip.loop;
			clipKey = String( clip.id || ( track.id + ':' + start ) );
		}
		if ( mediaT !== null ) {
			seekVideo( obj, mediaT, {
				loop: mediaLoop,
				playing: !! ctx.timelinePlaying,
				clipKey,
			} );
		} else {
			seekVideo( obj, null, { playing: false } );
		}
	}
}
