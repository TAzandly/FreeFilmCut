/**
 * MediaPipe Face Landmarker for Face FX editor preview.
 */

const MEDIAPIPE_VERSION = '1.2.2';
const ESM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ MEDIAPIPE_VERSION }/vision_bundle.mjs`;
const WASM_CDN = `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${ MEDIAPIPE_VERSION }/wasm`;
const MODEL_URL =
	'https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/1/face_landmarker.task';

const LANDMARK_COUNT = 478;
const IRIS_LEFT = 473; // image-left = subject's right
const IRIS_RIGHT = 468;
const FOREHEAD = 10;
const NOSE_BRIDGE = 168;

let landmarkerPromise = null;
let lastMatrix = null;

async function getLandmarker( wantMatrix ) {

	if ( landmarkerPromise && lastMatrix === wantMatrix ) return landmarkerPromise;
	lastMatrix = wantMatrix;
	landmarkerPromise = ( async () => {

		const mod = await import( /* @vite-ignore */ ESM_CDN );
		const { FaceLandmarker, FilesetResolver } = mod;
		const fileset = await FilesetResolver.forVisionTasks( WASM_CDN, false );
		return FaceLandmarker.createFromOptions( fileset, {
			baseOptions: { modelAssetPath: MODEL_URL },
			runningMode: 'IMAGE',
			numFaces: 4,
			minFaceDetectionConfidence: 0.35,
			minFacePresenceConfidence: 0.35,
			minTrackingConfidence: 0.35,
			outputFaceBlendshapes: false,
			outputFacialTransformationMatrixes: !! wantMatrix
		} );

	} )().catch( ( err ) => {

		landmarkerPromise = null;
		throw err;

	} );
	return landmarkerPromise;

}

function boxFromPoints( points ) {

	let minX = Infinity, minY = Infinity, maxX = - Infinity, maxY = - Infinity;
	for ( let i = 0; i + 1 < points.length; i += 2 ) {

		const x = points[ i ], y = points[ i + 1 ];
		if ( x < minX ) minX = x;
		if ( x > maxX ) maxX = x;
		if ( y < minY ) minY = y;
		if ( y > maxY ) maxY = y;

	}
	if ( ! Number.isFinite( minX ) ) return { x: 0, y: 0, w: 0, h: 0 };
	return {
		x: Math.max( 0, minX ),
		y: Math.max( 0, minY ),
		w: Math.max( 0, Math.min( 1, maxX ) - Math.max( 0, minX ) ),
		h: Math.max( 0, Math.min( 1, maxY ) - Math.max( 0, minY ) )
	};

}

function landmarksToFaces( faceLandmarks, matrices ) {

	const faces = [];
	for ( let fi = 0; fi < faceLandmarks.length; fi ++ ) {

		const landmarks = faceLandmarks[ fi ];
		if ( ! landmarks || landmarks.length < LANDMARK_COUNT ) continue;
		const points = new Float32Array( LANDMARK_COUNT * 2 );
		for ( let i = 0; i < LANDMARK_COUNT; i ++ ) {

			points[ i * 2 ] = landmarks[ i ].x;
			points[ i * 2 + 1 ] = landmarks[ i ].y;

		}
		const face = { points, box: boxFromPoints( points ) };
		const mat = matrices && matrices[ fi ];
		const data = mat && mat.data;
		if ( data && data.length >= 16 ) face.transformationMatrix = Float32Array.from( data );
		faces.push( face );

	}
	return faces;

}

async function detectFacesFromImage( image, opts = {} ) {

	const wantMatrix = opts.transformationMatrix !== false;
	const landmarker = await getLandmarker( wantMatrix );
	const result = landmarker.detect( image );
	return landmarksToFaces( result.faceLandmarks || [], result.facialTransformationMatrixes );

}

function readXY( points, index ) {

	const o = index * 2;
	if ( o + 1 >= points.length ) return null;
	const x = points[ o ], y = points[ o + 1 ];
	if ( ! Number.isFinite( x ) || ! Number.isFinite( y ) ) return null;
	return { x, y };

}

function resolveBindPoint( face, bind ) {

	if ( bind === 'faceMatrix' ) {

		const box = face.box;
		return {
			x: box.x + box.w / 2,
			y: box.y + box.h / 2,
			ok: box.w > 0 && box.h > 0
		};

	}
	if ( bind === 'leftEye' ) {

		const p = readXY( face.points, IRIS_LEFT );
		return p ? { ...p, ok: true } : { x: 0.5, y: 0.5, ok: false };

	}
	if ( bind === 'rightEye' ) {

		const p = readXY( face.points, IRIS_RIGHT );
		return p ? { ...p, ok: true } : { x: 0.5, y: 0.5, ok: false };

	}
	if ( bind === 'eyesCenter' ) {

		const l = resolveBindPoint( face, 'leftEye' );
		const r = resolveBindPoint( face, 'rightEye' );
		if ( ! l.ok && ! r.ok ) return { x: 0.5, y: 0.5, ok: false };
		if ( ! l.ok ) return r;
		if ( ! r.ok ) return l;
		return { x: ( l.x + r.x ) / 2, y: ( l.y + r.y ) / 2, ok: true };

	}
	const idx = bind === 'noseBridge' ? NOSE_BRIDGE : FOREHEAD;
	const p = readXY( face.points, idx );
	return p ? { ...p, ok: true } : { x: 0.5, y: 0.5, ok: false };

}

function packWarpFaces( faces, strength, maxFaces = 4 ) {

	const n = Math.min( faces.length, maxFaces );
	const data = new Float32Array( 4 * 4 );
	for ( let i = 0; i < n; i ++ ) {

		const box = faces[ i ].box;
		const o = i * 4;
		data[ o ] = box.x + box.w / 2;
		data[ o + 1 ] = box.y + box.h / 2;
		data[ o + 2 ] = Math.max( box.w, box.h ) * 0.55;
		data[ o + 3 ] = strength;

	}
	return { count: n, data };

}

function packEyeRays( faces, maxFaces = 4 ) {

	const data = new Float32Array( 8 * 4 );
	let count = 0;
	for ( let fi = 0; fi < faces.length && fi < maxFaces; fi ++ ) {

		const face = faces[ fi ];
		const nose = resolveBindPoint( face, 'noseBridge' );
		for ( const eyeBind of [ 'leftEye', 'rightEye' ] ) {

			if ( count >= 8 ) break;
			const eye = resolveBindPoint( face, eyeBind );
			if ( ! eye.ok ) continue;
			let dx = eye.x - nose.x;
			let dy = eye.y - nose.y;
			const len = Math.hypot( dx, dy ) || 1;
			dx /= len;
			dy /= len;
			const o = count * 4;
			data[ o ] = eye.x;
			data[ o + 1 ] = eye.y;
			data[ o + 2 ] = dx;
			data[ o + 3 ] = dy;
			count ++;

		}

	}
	return { count, data };

}

function packEarAnchors( faces, maxFaces = 4 ) {

	const data = new Float32Array( 4 * 4 );
	const n = Math.min( faces.length, maxFaces );
	for ( let i = 0; i < n; i ++ ) {

		const face = faces[ i ];
		const forehead = resolveBindPoint( face, 'forehead' );
		const o = i * 4;
		data[ o ] = forehead.x;
		data[ o + 1 ] = forehead.y;
		data[ o + 2 ] = Math.max( 0.05, face.box.w );
		data[ o + 3 ] = Math.max( 0.05, face.box.h );

	}
	return { count: n, data };

}

export {
	detectFacesFromImage,
	resolveBindPoint,
	packWarpFaces,
	packEyeRays,
	packEarAnchors,
	LANDMARK_COUNT
};
