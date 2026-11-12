/**
 * Face FX config normalize (editor mirror of NLE face-fx.ts).
 */

const BIND_TARGETS = [ 'forehead', 'noseBridge', 'leftEye', 'rightEye', 'eyesCenter', 'faceMatrix' ];
const KINDS = [ 'anchor3d', 'eyeRay', 'warp2d' ];
const WARP = [ 'bulge', 'pinch', 'stretchY', 'wave' ];

function asFinite( value, fallback ) {

	const n = typeof value === 'number' ? value : Number( value );
	return Number.isFinite( n ) ? n : fallback;

}

function createDefaultFaceFx() {

	return {
		driver: {
			landmarks: true,
			transformationMatrix: true,
			maxFaces: 4
		},
		layers: []
	};

}

function normalizeFaceFx( raw ) {

	if ( ! raw || typeof raw !== 'object' ) return createDefaultFaceFx();
	const driverIn = raw.driver && typeof raw.driver === 'object' ? raw.driver : {};
	const maxFaces = Math.max( 1, Math.min( 8, Math.round( asFinite( driverIn.maxFaces, 4 ) ) ) );
	const layersIn = Array.isArray( raw.layers ) ? raw.layers : [];
	const layers = [];
	for ( let i = 0; i < layersIn.length; i ++ ) {

		const L = layersIn[ i ];
		if ( ! L || typeof L !== 'object' ) continue;
		const kind = String( L.kind || '' ).trim();
		if ( ! KINDS.includes( kind ) ) continue;
		const id = String( L.id || '' ).trim() || ( 'layer_' + i );
		if ( kind === 'anchor3d' ) {

			const off = Array.isArray( L.offset ) && L.offset.length >= 3 ? L.offset : [ 0, 0, 0 ];
			let bind = String( L.bind || 'forehead' ).trim();
			if ( ! BIND_TARGETS.includes( bind ) ) bind = 'forehead';
			layers.push( {
				id,
				kind: 'anchor3d',
				asset: String( L.asset || '' ).trim(),
				bind,
				offset: [ asFinite( off[ 0 ], 0 ), asFinite( off[ 1 ], 0 ), asFinite( off[ 2 ], 0 ) ],
				scale: Math.max( 0.001, asFinite( L.scale, 1 ) )
			} );

		} else if ( kind === 'eyeRay' ) {

			layers.push( {
				id,
				kind: 'eyeRay',
				color: String( L.color || '#ff0033' ).trim() || '#ff0033',
				length: Math.max( 0, asFinite( L.length, 2 ) ),
				width: Math.max( 0.0001, asFinite( L.width, 0.01 ) )
			} );

		} else {

			let preset = String( L.preset || 'bulge' ).trim();
			if ( ! WARP.includes( preset ) ) preset = 'bulge';
			layers.push( {
				id,
				kind: 'warp2d',
				preset,
				strength: Math.max( 0, Math.min( 2, asFinite( L.strength, 0.5 ) ) ),
				region: L.region ? String( L.region ).trim() : undefined
			} );

		}

	}

	return {
		driver: {
			landmarks: driverIn.landmarks !== false,
			transformationMatrix: driverIn.transformationMatrix !== false,
			maxFaces
		},
		layers
	};

}

/** Read faceFx from project config or scene.userData. */
function readEditorFaceFx( editor ) {

	const fromConfig = editor && editor.config && editor.config.getKey( 'project/vfxpack/faceFx' );
	const fromScene = editor && editor.scene && editor.scene.userData && editor.scene.userData.faceFx;
	return normalizeFaceFx( fromConfig || fromScene );

}

function writeEditorFaceFx( editor, config ) {

	const normalized = normalizeFaceFx( config );
	if ( editor.config ) editor.config.setKey( 'project/vfxpack/faceFx', normalized );
	if ( editor.scene ) {

		editor.scene.userData = editor.scene.userData || {};
		editor.scene.userData.faceFx = normalized;

	}
	return normalized;

}

const FACE_FX_PRESETS = {
	rabbitEars: {
		driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
		layers: [ {
			id: 'ears',
			kind: 'anchor3d',
			asset: 'models/rabbit_ears.glb',
			bind: 'forehead',
			offset: [ 0, 0.02, 0 ],
			scale: 1
		} ]
	},
	eyeLaser: {
		driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
		layers: [ {
			id: 'laser',
			kind: 'eyeRay',
			color: '#ff2244',
			length: 2.2,
			width: 0.012
		} ]
	},
	funhouseBulge: {
		driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
		layers: [ {
			id: 'bulge',
			kind: 'warp2d',
			preset: 'bulge',
			strength: 0.85,
			region: 'face'
		} ]
	},
	partyCombo: {
		driver: { landmarks: true, transformationMatrix: true, maxFaces: 4 },
		layers: [
			{
				id: 'ears',
				kind: 'anchor3d',
				asset: 'models/rabbit_ears.glb',
				bind: 'forehead',
				offset: [ 0, 0.02, 0 ],
				scale: 1
			},
			{
				id: 'laser',
				kind: 'eyeRay',
				color: '#00e5ff',
				length: 1.8,
				width: 0.01
			},
			{
				id: 'wave',
				kind: 'warp2d',
				preset: 'wave',
				strength: 0.55,
				region: 'face'
			}
		]
	}
};

export {
	BIND_TARGETS,
	KINDS,
	WARP,
	FACE_FX_PRESETS,
	createDefaultFaceFx,
	normalizeFaceFx,
	readEditorFaceFx,
	writeEditorFaceFx
};
