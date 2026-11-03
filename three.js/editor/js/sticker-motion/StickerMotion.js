/**
 * Editor copy of opencut sticker-motion.ts.
 * Keep the formulas the same as that file.
 */

const STICKER_MOTION_PATHS = [
	'sticker.opacity',
	'sticker.scale',
	'sticker.rotate',
	'sticker.positionX',
	'sticker.positionY',
];

const PATH_SET = new Set( STICKER_MOTION_PATHS );

const STICKER_MOTION_IDENTITY = {
	opacity: 1,
	scale: 1,
	rotate: 0,
	positionX: 0,
	positionY: 0,
};

function isStickerMotionPath( path ) {

	return PATH_SET.has( path );

}

function createEmptyStickerMotion() {

	return {
		phase: 'in',
		duration: 0.5,
		loop: 'clamp',
		playStickerTimeline: true,
		tracks: [],
	};

}

function normalizeStickerMotion( raw ) {

	const phase = raw && ( raw.phase === 'out' || raw.phase === 'loop' ) ? raw.phase : 'in';
	const duration = Math.max( 0.1, Number( raw && raw.duration ) || 0.5 );
	const tracks = [];
	const list = raw && Array.isArray( raw.tracks ) ? raw.tracks : [];
	for ( const track of list ) {

		if ( ! track || ! isStickerMotionPath( track.path ) ) continue;
		const keys = [];
		for ( const key of track.keys || [] ) {

			const t = Number( key && key.t );
			const v = Number( key && key.v );
			if ( ! Number.isFinite( t ) || ! Number.isFinite( v ) ) continue;
			keys.push( { t, v } );

		}
		keys.sort( ( a, b ) => a.t - b.t );
		if ( keys.length === 0 ) continue;
		tracks.push( {
			path: track.path,
			interp: track.interp === 'step' ? 'step' : 'linear',
			keys,
		} );

	}
	return {
		phase,
		duration,
		loop: phase === 'loop' ? 'loop' : 'clamp',
		playStickerTimeline: ! raw || raw.playStickerTimeline !== false,
		tracks,
	};

}

function sampleStickerKeys( keys, time, interp ) {

	if ( ! keys || keys.length === 0 ) return null;
	if ( time <= keys[ 0 ].t ) return keys[ 0 ].v;
	if ( time >= keys[ keys.length - 1 ].t ) return keys[ keys.length - 1 ].v;
	for ( let i = 0; i < keys.length - 1; i ++ ) {

		const a = keys[ i ];
		const b = keys[ i + 1 ];
		if ( time >= a.t && time <= b.t ) {

			if ( interp === 'step' || b.t === a.t ) return a.v;
			const u = ( time - a.t ) / ( b.t - a.t );
			return a.v + ( b.v - a.v ) * u;

		}

	}
	return keys[ keys.length - 1 ].v;

}

function sampleStickerMotion( motion, time ) {

	const pose = { ...STICKER_MOTION_IDENTITY };
	if ( ! motion ) return pose;
	const duration = Math.max( 0.1, Number( motion.duration ) || 0.5 );
	const loop = motion.loop === 'loop' ? 'loop' : 'clamp';
	let t = Number( time ) || 0;
	if ( loop === 'loop' ) {

		t = t % duration;
		if ( t < 0 ) t += duration;

	} else {

		t = Math.max( 0, Math.min( duration, t ) );

	}
	for ( const track of motion.tracks || [] ) {

		if ( ! isStickerMotionPath( track.path ) ) continue;
		const value = sampleStickerKeys( track.keys, t, track.interp === 'step' ? 'step' : 'linear' );
		if ( value == null || ! Number.isFinite( value ) ) continue;
		if ( track.path === 'sticker.opacity' ) pose.opacity = value;
		else if ( track.path === 'sticker.scale' ) pose.scale = value;
		else if ( track.path === 'sticker.rotate' ) pose.rotate = value;
		else if ( track.path === 'sticker.positionX' ) pose.positionX = value;
		else pose.positionY = value;

	}
	return pose;

}

export {
	STICKER_MOTION_PATHS,
	STICKER_MOTION_IDENTITY,
	createEmptyStickerMotion,
	normalizeStickerMotion,
	sampleStickerMotion,
	isStickerMotionPath,
};
