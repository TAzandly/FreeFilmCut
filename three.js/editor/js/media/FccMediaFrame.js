/**
 * FreeFilmCut MediaFrame backends: GIF + imageSequence → sampleFrame → shared blit into RT.
 * Timeline owns transport (seek every frame). Sequence uses LRU window prefetch — never full preload.
 *
 * GIF: ImageDecoder frame-at-a-time + LRU (Chromium). Small GIFs (≤ GIF_FULL_DECODE_MAX frames)
 * may decode fully once. No free-run clock.
 */
import * as THREE from 'three';

const VP_KEY = 'fccVideoPlayer';

/** Prefetch window around playhead for image sequences. */
export const SEQ_LRU_AHEAD = 12;
export const SEQ_LRU_BEHIND = 4;
export const SEQ_LRU_MAX = 24;

/** GIF frame cache cap; below this count we may full-decode once. */
export const GIF_LRU_MAX = 64;
export const GIF_FULL_DECODE_MAX = 120;

const IMAGE_EXT = /\.(png|jpe?g|webp|bmp|gif|tga)$/i;

function mediaKind( object ) {

	const vp = object && object.userData && object.userData[ VP_KEY ];
	const k = vp && vp.kind;
	if ( k === 'gif' || k === 'imageSequence' ) return k;
	return 'video';

}


function getPlaybackRate( object ) {

	const vp = object && object.userData && object.userData[ VP_KEY ];
	let r = vp != null ? Number( vp.playbackRate ) : 1;
	if ( ! Number.isFinite( r ) || r <= 0 ) r = 1;
	// Clamp: 0.05x .. 16x keeps scrub usable without exploding seek.
	return Math.min( 16, Math.max( 0.05, r ) );

}

function scaledMediaTime( object, mediaTimeSec ) {

	return ( Number( mediaTimeSec ) || 0 ) * getPlaybackRate( object );

}

function ensureFrameTexture( object, width, height ) {

	const w = Math.max( 1, Math.round( width ) || 1 );
	const h = Math.max( 1, Math.round( height ) || 1 );
	let canvas = object.__fccFrameCanvas;
	if ( ! canvas ) {

		canvas = document.createElement( 'canvas' );
		object.__fccFrameCanvas = canvas;

	}
	if ( canvas.width !== w || canvas.height !== h ) {

		canvas.width = w;
		canvas.height = h;

	}
	let tex = object.__fccFrameTexture;
	if ( ! tex ) {

		tex = new THREE.CanvasTexture( canvas );
		tex.colorSpace = THREE.SRGBColorSpace;
		tex.minFilter = THREE.LinearFilter;
		tex.magFilter = THREE.LinearFilter;
		tex.generateMipmaps = false;
		tex.flipY = true;
		tex.premultipliedAlpha = false;
		tex.format = THREE.RGBAFormat;
		object.__fccFrameTexture = tex;

	}
	// alpha:true so GIF/PNG transparency survives upload into the CanvasTexture.
	return { canvas, tex, ctx: canvas.getContext( '2d', { alpha: true, willReadFrequently: false } ) };

}

function uploadBitmapToFrame( object, bitmap ) {

	if ( ! bitmap ) return null;
	const w = bitmap.width || 1;
	const h = bitmap.height || 1;
	const { canvas, tex, ctx } = ensureFrameTexture( object, w, h );
	// 'copy' replaces dst alpha with source alpha (source-over can leave opaque residue).
	ctx.save();
	ctx.globalCompositeOperation = 'copy';
	ctx.clearRect( 0, 0, canvas.width, canvas.height );
	ctx.drawImage( bitmap, 0, 0, canvas.width, canvas.height );
	ctx.restore();
	tex.needsUpdate = true;
	object.__fccFrameUploadedIndex = object.__fccMediaFrameIndex;
	return tex;

}

function releaseFrameTexture( object ) {

	if ( object.__fccFrameTexture ) {

		object.__fccFrameTexture.dispose();
		object.__fccFrameTexture = null;

	}
	object.__fccFrameCanvas = null;
	object.__fccFrameUploadedIndex = - 1;

}

/* ─── GIF ─────────────────────────────────────────────────────────── */

function releaseGif( object ) {

	const g = object.__fccGif;
	if ( g ) {

		if ( g.lru ) {

			for ( const ent of g.lru.values() ) {

				if ( ent && ent.bitmap && typeof ent.bitmap.close === 'function' ) ent.bitmap.close();

			}
			g.lru.clear();

		}
		if ( g.frames ) {

			for ( const f of g.frames ) {

				if ( f && f.bitmap && typeof f.bitmap.close === 'function' ) f.bitmap.close();

			}

		}
		if ( g.decoder && typeof g.decoder.close === 'function' ) {

			try { g.decoder.close(); } catch ( e ) { /* ignore */ }

		}
		object.__fccGif = null;

	}
	if ( object.__fccGifBytes ) object.__fccGifBytes = null;
	if ( object.__fccGifUrl ) {

		URL.revokeObjectURL( object.__fccGifUrl );
		object.__fccGifUrl = '';

	}
	releaseFrameTexture( object );

}


/** Prefer straight (non-premultiplied) alpha so RT blit keeps GIF/PNG transparency. */
function bitmapFromSource( source ) {

	try {

		return createImageBitmap( source, { premultiplyAlpha: 'none' } );

	} catch ( e ) {

		return createImageBitmap( source );

	}

}

async function decodeGifWithImageDecoder( buffer ) {

	if ( typeof ImageDecoder === 'undefined' ) return null;
	let decoder;
	try {

		decoder = new ImageDecoder( { data: buffer, type: 'image/gif' } );
		await decoder.tracks.ready;
		const track = decoder.tracks.selectedTrack || decoder.tracks[ 0 ];
		if ( ! track ) return null;
		const frameCount = track.frameCount || 0;
		if ( frameCount <= 0 ) return null;

		const delays = [];
		let width = 0;
		let height = 0;
		const full = frameCount <= GIF_FULL_DECODE_MAX;
		const frames = full ? [] : null;

		for ( let i = 0; i < frameCount; i ++ ) {

			const result = await decoder.decode( { frameIndex: i } );
			const image = result.image;
			const delayUs = Number( image.duration ) || 100000;
			delays.push( Math.max( 10, delayUs / 1000 ) );
			width = Math.max( width, image.displayWidth || image.codedWidth || 0 );
			height = Math.max( height, image.displayHeight || image.codedHeight || 0 );
			if ( full ) {

				const bitmap = await bitmapFromSource( image );
				image.close();
				frames.push( { bitmap, delayMs: delays[ i ] } );

			} else {

				image.close();

			}

		}

		let durationSec = delays.reduce( ( a, b ) => a + b, 0 ) / 1000;
		if ( ! ( durationSec > 0 ) ) durationSec = frameCount / 10;

		if ( full ) {

			if ( typeof decoder.close === 'function' ) decoder.close();
			return {
				mode: 'full',
				frames,
				frameCount,
				delays,
				durationSec,
				width: width || ( frames[ 0 ] && frames[ 0 ].bitmap.width ) || 1,
				height: height || ( frames[ 0 ] && frames[ 0 ].bitmap.height ) || 1,
				lru: null,
				decoder: null,
				buffer,
			};

		}

		return {
			mode: 'lru',
			frames: null,
			frameCount,
			delays,
			durationSec,
			width: width || 1,
			height: height || 1,
			lru: new Map(),
			inflight: new Map(),
			decoder,
			buffer,
		};

	} catch ( e ) {

		if ( decoder && typeof decoder.close === 'function' ) {

			try { decoder.close(); } catch ( err ) { /* ignore */ }

		}
		console.warn( '[FreeFilmCut] ImageDecoder GIF failed', e );
		return null;

	}

}

/** Fallback: single static frame via createImageBitmap (no timeline scrub of frames). */
async function decodeGifStaticFallback( buffer ) {

	const blob = new Blob( [ buffer ], { type: 'image/gif' } );
	const bitmap = await bitmapFromSource( blob );
	return {
		mode: 'full',
		frames: [ { bitmap, delayMs: 1000 } ],
		frameCount: 1,
		delays: [ 1000 ],
		durationSec: 1,
		width: bitmap.width,
		height: bitmap.height,
		lru: null,
		decoder: null,
		buffer,
		staticFallback: true,
	};

}

async function attachGifBuffer( object, buffer, fileName ) {

	if ( ! object || ! object.userData || ! object.userData[ VP_KEY ] || ! buffer ) return false;
	releaseGif( object );
	const vp = object.userData[ VP_KEY ];
	vp.kind = 'gif';
	vp.fileName = fileName || vp.fileName || 'anim.gif';
	object.__fccGifBytes = buffer;

	let g = await decodeGifWithImageDecoder( buffer );
	if ( ! g ) g = await decodeGifStaticFallback( buffer );
	object.__fccGif = g;
	object.__fccMediaTime = 0;
	object.__fccMediaActive = true;
	object.__fccMediaFrameIndex = 0;
	if ( g.staticFallback ) {

		console.warn( '[FreeFilmCut] GIF scrub needs ImageDecoder; showing static first frame only' );

	}
	return true;

}

function gifFrameIndexAt( g, mediaTimeSec, loop ) {

	if ( ! g || ! g.frameCount ) return 0;
	let t = Number( mediaTimeSec ) || 0;
	const dur = g.durationSec || 1;
	if ( loop ) t = ( ( t % dur ) + dur ) % dur;
	else t = Math.max( 0, Math.min( dur - 1e-4, t ) );

	const delays = g.delays || [];
	let acc = 0;
	for ( let i = 0; i < g.frameCount; i ++ ) {

		acc += ( delays[ i ] || 100 ) / 1000;
		if ( t < acc ) return i;

	}
	return Math.max( 0, g.frameCount - 1 );

}

async function gifEnsureLruFrame( g, index ) {

	if ( ! g || g.mode !== 'lru' || ! g.decoder ) return null;
	if ( g.lru.has( index ) ) {

		const ent = g.lru.get( index );
		g.lru.delete( index );
		g.lru.set( index, ent );
		return ent.bitmap;

	}
	if ( g.inflight.has( index ) ) return g.inflight.get( index );

	const p = ( async () => {

		try {

			const result = await g.decoder.decode( { frameIndex: index } );
			const bitmap = await bitmapFromSource( result.image );
			result.image.close();
			while ( g.lru.size >= GIF_LRU_MAX ) {

				const oldest = g.lru.keys().next().value;
				const old = g.lru.get( oldest );
				g.lru.delete( oldest );
				if ( old && old.bitmap && typeof old.bitmap.close === 'function' ) old.bitmap.close();

			}
			g.lru.set( index, { bitmap } );
			return bitmap;

		} catch ( e ) {

			console.warn( '[FreeFilmCut] GIF frame decode', index, e );
			return null;

		} finally {

			g.inflight.delete( index );

		}

	} )();

	g.inflight.set( index, p );
	return p;

}

function gifPrefetch( g, center, ahead, behind ) {

	if ( ! g || g.mode !== 'lru' ) return;
	const n = g.frameCount || 0;
	if ( n <= 0 ) return;
	const list = [];
	for ( let d = 0; d <= ahead; d ++ ) list.push( ( center + d ) % n );
	for ( let d = 1; d <= behind; d ++ ) list.push( ( center - d + n * 8 ) % n );
	for ( const i of list ) {

		if ( ! g.lru.has( i ) && ! g.inflight.has( i ) ) gifEnsureLruFrame( g, i );

	}

}

async function sampleGifFrame( object, mediaTimeSec, opts ) {

	const g = object.__fccGif;
	if ( ! g ) return null;
	const loop = !!( opts && opts.loop );
	const index = gifFrameIndexAt( g, scaledMediaTime( object, mediaTimeSec ), loop );
	object.__fccMediaFrameIndex = index;

	let bitmap = null;
	if ( g.mode === 'full' && g.frames && g.frames[ index ] ) {

		bitmap = g.frames[ index ].bitmap;

	} else {

		gifPrefetch( g, index, 8, 2 );
		bitmap = await gifEnsureLruFrame( g, index );
		if ( ! bitmap && g.lru.size ) {

			const last = [ ...g.lru.values() ].pop();
			bitmap = last && last.bitmap;

		}

	}
	if ( ! bitmap ) return object.__fccFrameTexture || null;
	if ( object.__fccFrameUploadedIndex === index && object.__fccFrameTexture ) return object.__fccFrameTexture;
	return uploadBitmapToFrame( object, bitmap );

}

/* ─── Image sequence (LRU) ───────────────────────────────────────── */

function naturalFrameSort( a, b ) {

	return String( a ).localeCompare( String( b ), undefined, { numeric: true, sensitivity: 'base' } );

}

function releaseSequence( object ) {

	const s = object.__fccSeq;
	if ( s ) {

		if ( s.lru ) {

			for ( const ent of s.lru.values() ) {

				if ( ent && ent.bitmap && typeof ent.bitmap.close === 'function' ) ent.bitmap.close();

			}
			s.lru.clear();

		}
		if ( s.inflight ) s.inflight.clear();
		if ( s.gen != null ) s.gen ++;
		object.__fccSeq = null;

	}
	releaseFrameTexture( object );

}

function buildSequenceFileList( names, opts ) {

	opts = opts || {};
	let list = ( names || [] ).filter( ( n ) => IMAGE_EXT.test( n ) );
	list.sort( naturalFrameSort );
	const start = Math.max( 0, Number( opts.sequenceStart ) || 0 );
	let end = Number( opts.sequenceEnd );
	if ( ! Number.isFinite( end ) || end < 0 ) end = list.length - 1;
	end = Math.min( list.length - 1, end );
	if ( start > 0 || end < list.length - 1 ) list = list.slice( start, end + 1 );
	return list;

}

/**
 * Attach an image sequence.
 * @param {object} object
 * @param {{ names: string[], dirRel?: string, files?: Map<string, File|Blob|ArrayBuffer>, fps?: number, sequenceStart?: number, sequenceEnd?: number, readBinary?: (rel)=>Promise<ArrayBuffer|null> }} spec
 */
function attachImageSequence( object, spec ) {

	if ( ! object || ! object.userData || ! object.userData[ VP_KEY ] || ! spec ) return false;
	releaseSequence( object );
	const vp = object.userData[ VP_KEY ];
	vp.kind = 'imageSequence';
	const fps = Math.max( 1, Number( spec.fps ) || Number( vp.sequenceFps ) || 30 );
	vp.sequenceFps = fps;
	vp.sequenceStart = Number( spec.sequenceStart ) || 0;
	vp.sequenceEnd = Number.isFinite( Number( spec.sequenceEnd ) ) ? Number( spec.sequenceEnd ) : - 1;
	const names = buildSequenceFileList( spec.names || [], vp );
	if ( names.length === 0 ) {

		console.warn( '[FreeFilmCut] imageSequence has no frames' );
		return false;

	}
	const dirRel = String( spec.dirRel || vp.sequenceDir || '' ).replace( /\\/g, '/' ).replace( /\/$/, '' );
	vp.sequenceDir = dirRel;
	vp.fileName = ( dirRel.split( '/' ).pop() || 'sequence' ) + ' (' + names.length + ' frames)';
	vp.projectPath = dirRel;

	const fileMap = spec.files || null;
	const readBinary = typeof spec.readBinary === 'function' ? spec.readBinary : null;

	object.__fccSeq = {
		names,
		dirRel,
		fps,
		count: names.length,
		durationSec: names.length / fps,
		width: 0,
		height: 0,
		lru: new Map(),
		inflight: new Map(),
		gen: 0,
		fileMap,
		readBinary,
		playDirection: 1,
	};
	object.__fccMediaTime = 0;
	object.__fccMediaActive = true;
	object.__fccMediaFrameIndex = 0;
	// Kick first frame load
	seqEnsureFrame( object, 0 );
	return true;

}

function seqFrameIndexAt( s, mediaTimeSec, loop ) {

	if ( ! s || ! s.count ) return 0;
	let t = Number( mediaTimeSec ) || 0;
	const dur = s.durationSec || ( s.count / ( s.fps || 30 ) );
	if ( loop ) t = ( ( t % dur ) + dur ) % dur;
	else t = Math.max( 0, Math.min( dur - 1e-6, t ) );
	let idx = Math.floor( t * ( s.fps || 30 ) );
	if ( loop ) idx = ( ( idx % s.count ) + s.count ) % s.count;
	else idx = Math.max( 0, Math.min( s.count - 1, idx ) );
	return idx;

}

function seqRelPath( s, index ) {

	const name = s.names[ index ];
	if ( ! name ) return '';
	if ( s.dirRel ) return s.dirRel + '/' + name;
	return name;

}

function seqEvictFarthest( s, playhead ) {

	while ( s.lru.size >= SEQ_LRU_MAX ) {

		let farKey = null;
		let farDist = - 1;
		for ( const key of s.lru.keys() ) {

			const dist = Math.min(
				Math.abs( key - playhead ),
				Math.abs( key - playhead + s.count ),
				Math.abs( key - playhead - s.count ),
			);
			if ( dist > farDist ) {

				farDist = dist;
				farKey = key;

			}

		}
		if ( farKey == null ) break;
		const old = s.lru.get( farKey );
		s.lru.delete( farKey );
		if ( old && old.bitmap && typeof old.bitmap.close === 'function' ) old.bitmap.close();

	}

}

async function seqLoadBitmap( object, index ) {

	const s = object.__fccSeq;
	if ( ! s || index < 0 || index >= s.count ) return null;
	const name = s.names[ index ];
	let blobOrBuf = null;
	if ( s.fileMap && s.fileMap.has( name ) ) {

		blobOrBuf = s.fileMap.get( name );

	} else if ( s.readBinary ) {

		const rel = seqRelPath( s, index );
		const bin = await s.readBinary( rel );
		if ( bin && bin.buffer ) blobOrBuf = bin.buffer;
		else if ( bin instanceof ArrayBuffer ) blobOrBuf = bin;

	}
	if ( ! blobOrBuf ) return null;
	let blob;
	if ( blobOrBuf instanceof Blob ) blob = blobOrBuf;
	else blob = new Blob( [ blobOrBuf ] );
	return bitmapFromSource( blob );

}

function seqEnsureFrame( object, index ) {

	const s = object.__fccSeq;
	if ( ! s ) return Promise.resolve( null );
	if ( s.lru.has( index ) ) {

		const ent = s.lru.get( index );
		s.lru.delete( index );
		s.lru.set( index, ent );
		return Promise.resolve( ent.bitmap );

	}
	if ( s.inflight.has( index ) ) return s.inflight.get( index );

	const gen = s.gen;
	const p = ( async () => {

		try {

			const bitmap = await seqLoadBitmap( object, index );
			if ( ! bitmap || ! object.__fccSeq || object.__fccSeq.gen !== gen ) {

				if ( bitmap && typeof bitmap.close === 'function' ) bitmap.close();
				return null;

			}
			seqEvictFarthest( s, object.__fccMediaFrameIndex || 0 );
			s.lru.set( index, { bitmap } );
			if ( ! s.width ) {

				s.width = bitmap.width;
				s.height = bitmap.height;

			}
			return bitmap;

		} catch ( e ) {

			console.warn( '[FreeFilmCut] sequence frame', index, e );
			return null;

		} finally {

			if ( object.__fccSeq === s ) s.inflight.delete( index );

		}

	} )();

	s.inflight.set( index, p );
	return p;

}

function seqPrefetchWindow( object, center, playingForward ) {

	const s = object.__fccSeq;
	if ( ! s || ! s.count ) return;
	const ahead = playingForward !== false ? SEQ_LRU_AHEAD : SEQ_LRU_BEHIND;
	const behind = playingForward !== false ? SEQ_LRU_BEHIND : SEQ_LRU_AHEAD;
	const n = s.count;
	const want = new Set();
	want.add( center );
	for ( let d = 1; d <= ahead; d ++ ) want.add( ( center + d ) % n );
	for ( let d = 1; d <= behind; d ++ ) want.add( ( center - d + n * 16 ) % n );
	for ( const i of want ) {

		if ( ! s.lru.has( i ) && ! s.inflight.has( i ) ) seqEnsureFrame( object, i );

	}
	// Cancel stale: bump not needed; inflight results check gen. Evict far from window.
	seqEvictFarthest( s, center );

}

async function sampleSequenceFrame( object, mediaTimeSec, opts ) {

	const s = object.__fccSeq;
	if ( ! s ) return null;
	const loop = !!( opts && opts.loop );
	const playing = !!( opts && opts.playing );
	const prev = object.__fccMediaFrameIndex;
	const index = seqFrameIndexAt( s, scaledMediaTime( object, mediaTimeSec ), loop );
	object.__fccMediaFrameIndex = index;
	if ( prev != null && index !== prev ) {

		s.playDirection = index >= prev || ( prev - index > s.count / 2 ) ? 1 : - 1;

	}
	seqPrefetchWindow( object, index, s.playDirection >= 0 || playing );
	let bitmap = s.lru.has( index ) ? s.lru.get( index ).bitmap : null;
	if ( ! bitmap ) {

		bitmap = await seqEnsureFrame( object, index );
	}
	if ( ! bitmap ) {

		// Keep last good frame while async load catches up
		return object.__fccFrameTexture || null;

	}
	if ( object.__fccFrameUploadedIndex === index && object.__fccFrameTexture ) return object.__fccFrameTexture;
	return uploadBitmapToFrame( object, bitmap );

}

/* ─── Shared seek / sample API ───────────────────────────────────── */

/**
 * Timeline-driven seek. Video keeps free-run semantics via caller; gif/seq force sample time.
 * @returns {{ kind: string, texture: THREE.Texture|null, hasAlpha: boolean }|null}
 */
function seekMediaFrame( object, mediaTimeSec, opts ) {

	if ( ! object || ! object.userData || ! object.userData[ VP_KEY ] ) return null;
	const kind = mediaKind( object );
	opts = opts || {};

	if ( mediaTimeSec == null || ! Number.isFinite( Number( mediaTimeSec ) ) ) {

		object.__fccMediaActive = false;
		object.__fccMediaTime = null;
		object.__fccTlVideoClipKey = '';
		return { kind, texture: null, hasAlpha: kind !== 'video', active: false };

	}

	object.__fccMediaActive = true;
	object.__fccMediaTime = Number( mediaTimeSec ) || 0;
	if ( opts.clipKey ) object.__fccTlVideoClipKey = String( opts.clipKey );

	return { kind, texture: null, hasAlpha: kind !== 'video', active: true, time: object.__fccMediaTime };

}

/**
 * Resolve current frame texture for blit (async-safe: returns last good sync; kicks loads).
 */
function sampleMediaFrameSync( object, opts ) {

	if ( ! object || object.__fccMediaActive === false ) return null;
	const kind = mediaKind( object );
	const t = object.__fccMediaTime;
	if ( t == null || ! Number.isFinite( t ) ) return null;
	const loop = !!( opts && opts.loop );
	const playing = !!( opts && opts.playing );

	if ( kind === 'gif' ) {

		const g = object.__fccGif;
		if ( ! g ) return null;
		const index = gifFrameIndexAt( g, scaledMediaTime( object, t ), loop );
		object.__fccMediaFrameIndex = index;
		if ( g.mode === 'full' && g.frames && g.frames[ index ] ) {

			if ( object.__fccFrameUploadedIndex !== index ) uploadBitmapToFrame( object, g.frames[ index ].bitmap );
			return object.__fccFrameTexture;

		}
		gifPrefetch( g, index, 8, 2 );
		if ( g.lru && g.lru.has( index ) ) {

			if ( object.__fccFrameUploadedIndex !== index ) uploadBitmapToFrame( object, g.lru.get( index ).bitmap );
			return object.__fccFrameTexture;

		}
		gifEnsureLruFrame( g, index );
		return object.__fccFrameTexture || null;

	}

	if ( kind === 'imageSequence' ) {

		const s = object.__fccSeq;
		if ( ! s ) return null;
		const index = seqFrameIndexAt( s, scaledMediaTime( object, t ), loop );
		const prev = object.__fccMediaFrameIndex;
		object.__fccMediaFrameIndex = index;
		if ( prev != null && index !== prev ) s.playDirection = index >= prev ? 1 : - 1;
		seqPrefetchWindow( object, index, ( s.playDirection || 1 ) >= 0 || playing );
		if ( s.lru.has( index ) ) {

			if ( object.__fccFrameUploadedIndex !== index ) uploadBitmapToFrame( object, s.lru.get( index ).bitmap );
			return object.__fccFrameTexture;

		}
		seqEnsureFrame( object, index );
		return object.__fccFrameTexture || null;

	}

	return object.__fccVideoTexture || null;

}

function getMediaDurationSec( object ) {

	const kind = mediaKind( object );
	if ( kind === 'gif' && object.__fccGif ) return object.__fccGif.durationSec || 0;
	if ( kind === 'imageSequence' && object.__fccSeq ) return object.__fccSeq.durationSec || 0;
	const video = object.__fccVideo;
	const d = video ? Number( video.duration ) : NaN;
	return Number.isFinite( d ) && d > 0 ? d : 0;

}

function releaseMediaExtras( object ) {

	releaseGif( object );
	releaseSequence( object );

}

export {
	VP_KEY,
	mediaKind,
	getPlaybackRate,
	attachGifBuffer,
	attachImageSequence,
	releaseGif,
	releaseSequence,
	releaseMediaExtras,
	seekMediaFrame,
	sampleMediaFrameSync,
	sampleGifFrame,
	sampleSequenceFrame,
	getMediaDurationSec,
	buildSequenceFileList,
	IMAGE_EXT,
};
