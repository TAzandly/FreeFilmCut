/**
 * Face FX anchor3d — load real GLB and bind to landmark UV on the media plane.
 */

import * as THREE from 'three';
import { resolveBindPoint } from './FaceFxLandmarks.js?v=fcc-ui-240';

const GROUP_NAME = '__fccFaceFxAnchors';

function FaceFxAnchors( editor ) {

	this.editor = editor;
	this.group = null;
	this.cache = new Map(); // asset path -> Promise<Object3D template>
	this.instances = []; // { layerId, root, asset }
	this.loaderPromise = null;

}

FaceFxAnchors.prototype._ensureGroup = function ( scene ) {

	if ( this.group && this.group.parent === scene ) return this.group;
	if ( this.group && this.group.parent ) this.group.parent.remove( this.group );
	let existing = scene.getObjectByName( GROUP_NAME );
	if ( existing ) {

		this.group = existing;
		return this.group;

	}
	this.group = new THREE.Group();
	this.group.name = GROUP_NAME;
	this.group.userData.fccFaceFx = true;
	scene.add( this.group );
	return this.group;

};

FaceFxAnchors.prototype._getLoader = async function () {

	if ( ! this.loaderPromise ) {

		this.loaderPromise = import( 'three/addons/loaders/GLTFLoader.js' ).then( ( { GLTFLoader } ) => new GLTFLoader() );

	}
	return this.loaderPromise;

};

/**
 * Resolve asset URL: project folder → relative editor path → absolute/http.
 */
FaceFxAnchors.prototype.resolveAssetUrl = async function ( asset ) {

	const rel = String( asset || '' ).trim();
	if ( ! rel ) return null;
	if ( /^https?:\/\//i.test( rel ) || rel.startsWith( 'blob:' ) ) return rel;

	const editor = this.editor;
	const pf = editor && editor.projectFolder;
	if ( pf && typeof pf.readBinaryFile === 'function' ) {

		const tryPaths = [
			rel,
			'assets/' + rel.replace( /^\.\//, '' ),
			'assets/models/' + rel.split( /[/\\]/ ).pop(),
			'models/' + rel.split( /[/\\]/ ).pop()
		];
		for ( const p of tryPaths ) {

			try {

				const bin = await pf.readBinaryFile( p );
				if ( bin && bin.buffer ) {

					const blob = new Blob( [ bin.buffer ], { type: 'model/gltf-binary' } );
					return URL.createObjectURL( blob );

				}

			} catch ( e ) { /* next */ }

		}

	}

	// Built-in sample next to editor / NLE public packs.
	const base = String( rel ).replace( /^\.\//, '' );
	return '/vfxpacks/face-fx/' + base;

};

FaceFxAnchors.prototype.loadTemplate = async function ( asset ) {

	const key = String( asset || '' ).trim();
	if ( ! key ) return null;
	if ( this.cache.has( key ) ) return this.cache.get( key );

	const promise = ( async () => {

		const url = await this.resolveAssetUrl( key );
		if ( ! url ) throw new Error( 'Face FX asset not found: ' + key );
		const loader = await this._getLoader();
		const gltf = await loader.loadAsync( url );
		const root = gltf.scene || gltf.scenes[ 0 ];
		root.traverse( ( o ) => {

			if ( o.isMesh ) {

				o.castShadow = false;
				o.receiveShadow = false;
				o.frustumCulled = false;

			}

		} );
		root.userData.fccFaceFxTemplate = key;
		return root;

	} )().catch( ( err ) => {

		this.cache.delete( key );
		console.warn( '[FaceFx] GLB load failed', key, err );
		return null;

	} );

	this.cache.set( key, promise );
	return promise;

};

FaceFxAnchors.prototype.syncLayers = async function ( layers ) {

	const scene = this.editor.scene;
	if ( ! scene ) return;
	const group = this._ensureGroup( scene );
	const wanted = ( layers || [] ).filter( ( l ) => l.kind === 'anchor3d' && l.asset );

	// Drop unused instances
	for ( let i = this.instances.length - 1; i >= 0; i -- ) {

		const inst = this.instances[ i ];
		if ( ! wanted.some( ( l ) => l.id === inst.layerId && l.asset === inst.asset ) ) {

			group.remove( inst.root );
			this.instances.splice( i, 1 );

		}

	}

	for ( const layer of wanted ) {

		let inst = this.instances.find( ( x ) => x.layerId === layer.id );
		if ( ! inst || inst.asset !== layer.asset ) {

			if ( inst ) {

				group.remove( inst.root );
				this.instances = this.instances.filter( ( x ) => x !== inst );

			}
			const template = await this.loadTemplate( layer.asset );
			if ( ! template ) continue;
			const root = template.clone( true );
			root.name = 'FaceFxAnchor_' + layer.id;
			root.visible = false;
			group.add( root );
			inst = { layerId: layer.id, asset: layer.asset, root, layer };
			this.instances.push( inst );

		}
		inst.layer = layer;

	}

};

/**
 * Place anchors on the media display plane using landmark UV.
 * `planeMesh` should be the mesh sampling the MediaPlayer RT (PlaneGeometry).
 */
FaceFxAnchors.prototype.updatePoses = function ( {
	faces,
	planeMesh,
	maxFaces = 4
} ) {

	if ( ! this.group ) return;
	if ( ! faces || ! faces.length || ! planeMesh ) {

		for ( const inst of this.instances ) inst.root.visible = false;
		return;

	}

	planeMesh.updateWorldMatrix( true, false );
	const box = new THREE.Box3().setFromObject( planeMesh );
	const size = new THREE.Vector3();
	const center = new THREE.Vector3();
	box.getSize( size );
	box.getCenter( center );

	// Assume plane faces camera roughly in XY (editor Media RT quads).
	const width = Math.max( size.x, 1e-4 );
	const height = Math.max( size.y, 1e-4 );

	for ( const inst of this.instances ) {

		const layer = inst.layer;
		const face = faces[ 0 ];
		if ( ! face ) {

			inst.root.visible = false;
			continue;

		}
		const bind = resolveBindPoint( face, layer.bind || 'forehead' );
		if ( ! bind.ok ) {

			inst.root.visible = false;
			continue;

		}
		// UV: x right, y down → local plane: x right, y up
		const lx = ( bind.x - 0.5 ) * width;
		const ly = ( 0.5 - bind.y ) * height;
		const off = layer.offset || [ 0, 0, 0 ];
		const world = new THREE.Vector3(
			center.x + lx + off[ 0 ] * width,
			center.y + ly + off[ 1 ] * height,
			center.z + off[ 2 ] * Math.max( width, height ) * 0.05
		);
		inst.root.position.copy( world );
		const faceScale = Math.max( face.box.w * width, face.box.h * height ) * ( layer.scale || 1 );
		inst.root.scale.setScalar( Math.max( 0.01, faceScale ) );
		// Face camera lightly
		const cam = this.editor.viewportCamera || this.editor.camera;
		if ( cam ) inst.root.lookAt( cam.position );
		inst.root.visible = true;
		void maxFaces;

	}

};

FaceFxAnchors.prototype.clear = function () {

	if ( this.group && this.group.parent ) this.group.parent.remove( this.group );
	this.group = null;
	this.instances = [];

};

FaceFxAnchors.prototype.dispose = function () {

	this.clear();
	this.cache.clear();

};

export { FaceFxAnchors, GROUP_NAME };
