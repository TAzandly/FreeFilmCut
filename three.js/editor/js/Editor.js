import * as THREE from 'three';

import { Config } from './Config.js?v=fcc-ui-212';
import { Loader } from './Loader.js?v=fcc-anim-14';
import { History as _History } from './History.js';
import { Strings } from './Strings.js?v=fcc-ui-252';
import { Storage as _Storage } from './Storage.js?v=fcc-ui-212';
import { Selector } from './Selector.js?v=fcc-ui-106';
import {
	BELOW_INPUT_UNIFORM_NAMES,
	restoreEditorBelowPreviewsInScene,
} from './FreeCapCutShaders.js';
import {
	buildProjectAnimPayload,
	applyProjectAnimPayload,
	loadFreecapcutAnimsFromProjectFolder,
	flushFreecapcutAnimsToProject,
	createEmptyAnim,
} from './anim/FreeCapCutAnimCore.js?v=fcc-anim-20';

import {
	restoreUITextFontsFromProject,
	restoreFlowerTexturesFromProject,
} from './ui/UIText.js?v=fcc-ui-234';
import { restoreFccVideosFromProject } from './media/FccVideo.js?v=fcc-ui-207';


var _DEFAULT_CAMERA = new THREE.PerspectiveCamera( 50, 1, 0.001, 1e10 );
_DEFAULT_CAMERA.name = 'Camera';
_DEFAULT_CAMERA.position.set( 0, 5, 10 );
_DEFAULT_CAMERA.lookAt( new THREE.Vector3() );
const _ORTHOGRAPHIC_FRUSTUM_SIZE = 100;

function Editor() {

	const Signal = signals.Signal; // eslint-disable-line no-undef

	this.signals = {

		// script

		editScript: new Signal(),

		// player

		startPlayer: new Signal(),
		stopPlayer: new Signal(),

		// xr

		enterXR: new Signal(),
		offerXR: new Signal(),
		leaveXR: new Signal(),

		// notifications

		editorCleared: new Signal(),

		savingStarted: new Signal(),
		savingFinished: new Signal(),
		projectFolderChanged: new Signal(), // FreeFilmCut: local project folder bound/cleared
		projectTitleChanged: new Signal(), // FreeFilmCut: project display name
		projectSettingsChanged: new Signal(), // FreeFilmCut: renderer toneMapping etc from project JSON

		transformModeChanged: new Signal(),
		snapChanged: new Signal(),
		spaceChanged: new Signal(),
		rendererCreated: new Signal(),
		rendererUpdated: new Signal(),
		rendererDetectKTX2Support: new Signal(),

		sceneBackgroundChanged: new Signal(),
		sceneEnvironmentChanged: new Signal(),
		sceneFogChanged: new Signal(),
		sceneFogSettingsChanged: new Signal(),
		sceneGraphChanged: new Signal(),
		sceneRendered: new Signal(),

		cameraChanged: new Signal(),
		cameraResetted: new Signal(),

		geometryChanged: new Signal(),

		objectSelected: new Signal(),
		objectFocused: new Signal(),

		objectAdded: new Signal(),
		objectChanged: new Signal(),
		objectRemoved: new Signal(),

		cameraAdded: new Signal(),
		cameraRemoved: new Signal(),

		helperAdded: new Signal(),
		helperRemoved: new Signal(),

		materialAdded: new Signal(),
		materialChanged: new Signal(),
		materialRemoved: new Signal(),

		scriptAdded: new Signal(),
		scriptChanged: new Signal(),
		scriptRemoved: new Signal(),

		windowResize: new Signal(),

		showHelpersChanged: new Signal(),
		refreshSidebarObject3D: new Signal(),
		historyChanged: new Signal(),

		viewportCameraChanged: new Signal(),
		viewportShadingChanged: new Signal(),

		intersectionsDetected: new Signal(),

		pathTracerUpdated: new Signal(),

		animationPanelChanged: new Signal(),
		animationPanelResized: new Signal(),
		freecapcutAnimsChanged: new Signal(), // FreeFilmCut: .anim list restored/changed
		animationSampled: new Signal(), // FreeFilmCut: scrub/play posed; viewport render only

		morphTargetsUpdated: new Signal(),

		// FreeFilmCut: project resolution / safe frame
		vfxpackChanged: new Signal(), // FreeFilmCut: VfxPack poster/hover preview updated
		resolutionChanged: new Signal(),
		faceFxPreviewStatus: new Signal() // FreeFilmCut: Face FX MediaPlayer preview status

	};

	this.config = new Config();
	this.history = new _History( this );
	this.selector = new Selector( this );
	this.storage = new _Storage();
	this.isLoadingState = false; // FreeFilmCut: block autosave while hydrating IndexedDB
		/** View — Text layer RT: overlay UI via RT→blit (OpenCut-aligned preview). */
		this.textLayerRTPreview = false;
	this.strings = new Strings( this.config );

	this.loader = new Loader( this );

	this.camera = _DEFAULT_CAMERA.clone();

	this.scene = new THREE.Scene();
	this.scene.name = 'Scene';

	this.sceneHelpers = new THREE.Scene();
	this.sceneHelpers.add( new THREE.HemisphereLight( 0xffffff, 0x888888, 2 ) );

	this.backgroundType = 'Default';
	this.environmentType = 'Default';

	this.object = {};
	this.geometries = {};
	this.materials = {};
	this.textures = {};
	this.scripts = {};

	this.materialsRefCounter = new Map(); // tracks how often is a material used by a 3D object

	this.mixer = new THREE.AnimationMixer( this.scene );

	this.selected = null;
	this.helpers = {};

	this.cameras = {};

	this.viewportCamera = this.camera;
	this.viewportShading = 'default';
	this.viewportColor = new THREE.Color();

	this.addCamera( this.camera );

}

Editor.prototype = {

	setScene: function ( scene ) {

		this.scene.uuid = scene.uuid;
		this.scene.name = scene.name;

		this.scene.background = scene.background;
		this.scene.environment = scene.environment;
		this.scene.fog = scene.fog;
		this.scene.backgroundBlurriness = scene.backgroundBlurriness;
		this.scene.backgroundIntensity = scene.backgroundIntensity;

		this.scene.userData = JSON.parse( JSON.stringify( scene.userData ) );

		// avoid render per object

		this.signals.sceneGraphChanged.active = false;

		while ( scene.children.length > 0 ) {

			this.addObject( scene.children[ 0 ] );

		}

		this.signals.sceneGraphChanged.active = true;
		this.signals.sceneGraphChanged.dispatch();

		this.signals.sceneEnvironmentChanged.dispatch( this.environmentType, scene.environment );

	},

	//

	addObject: function ( object, parent, index ) {

		var scope = this;

		object.traverse( function ( child ) {

			if ( child.geometry !== undefined ) scope.addGeometry( child.geometry );
			if ( child.material !== undefined ) scope.addMaterial( child.material );

			scope.addCamera( child );
			scope.addHelper( child );

		} );

		if ( parent === undefined ) {

			this.scene.add( object );

		} else {

			parent.children.splice( index, 0, object );
			object.parent = parent;

		}

		this.signals.objectAdded.dispatch( object );
		this.signals.sceneGraphChanged.dispatch();

	},

	nameObject: function ( object, name ) {

		object.name = name;
		this.signals.sceneGraphChanged.dispatch();

	},

	removeObject: function ( object ) {

		if ( object.parent === null ) return; // avoid deleting the camera or scene

		var scope = this;

		object.traverse( function ( child ) {

			scope.removeCamera( child );
			scope.removeHelper( child );

			if ( child.material !== undefined ) scope.removeMaterial( child.material );

		} );

		object.parent.remove( object );

		this.signals.objectRemoved.dispatch( object );
		this.signals.sceneGraphChanged.dispatch();

	},

	addGeometry: function ( geometry ) {

		this.geometries[ geometry.uuid ] = geometry;

	},

	setGeometryName: function ( geometry, name ) {

		geometry.name = name;
		this.signals.sceneGraphChanged.dispatch();

	},

	addMaterial: function ( material ) {

		if ( Array.isArray( material ) ) {

			for ( var i = 0, l = material.length; i < l; i ++ ) {

				this.addMaterialToRefCounter( material[ i ] );

			}

		} else {

			this.addMaterialToRefCounter( material );

		}

		this.signals.materialAdded.dispatch();

	},

	addMaterialToRefCounter: function ( material ) {

		var materialsRefCounter = this.materialsRefCounter;

		var count = materialsRefCounter.get( material );

		if ( count === undefined ) {

			materialsRefCounter.set( material, 1 );
			this.materials[ material.uuid ] = material;

		} else {

			count ++;
			materialsRefCounter.set( material, count );

		}

	},

	removeMaterial: function ( material ) {

		if ( Array.isArray( material ) ) {

			for ( var i = 0, l = material.length; i < l; i ++ ) {

				this.removeMaterialFromRefCounter( material[ i ] );

			}

		} else {

			this.removeMaterialFromRefCounter( material );

		}

		this.signals.materialRemoved.dispatch();

	},

	removeMaterialFromRefCounter: function ( material ) {

		var materialsRefCounter = this.materialsRefCounter;

		var count = materialsRefCounter.get( material );
		count --;

		if ( count === 0 ) {

			materialsRefCounter.delete( material );
			delete this.materials[ material.uuid ];

		} else {

			materialsRefCounter.set( material, count );

		}

	},

	getMaterialById: function ( id ) {

		var material;
		var materials = Object.values( this.materials );

		for ( var i = 0; i < materials.length; i ++ ) {

			if ( materials[ i ].id === id ) {

				material = materials[ i ];
				break;

			}

		}

		return material;

	},

	setMaterialName: function ( material, name ) {

		material.name = name;
		this.signals.sceneGraphChanged.dispatch();

	},

	addTexture: function ( texture ) {

		this.textures[ texture.uuid ] = texture;

	},

	//

	addCamera: function ( camera ) {

		if ( camera.isCamera ) {

			// Do not let a scene camera overwrite the editor.camera map slot.
			// fromJSON calls ensureEditorCameraUnique() after setScene to mint a new
			// editor uuid and register both cameras correctly.
			if ( camera !== this.camera && this.camera && camera.uuid === this.camera.uuid ) {

				console.warn( '[FreeFilmCut] Scene camera UUID equals editor.camera; deferring registry fix to ensureEditorCameraUnique' );
				this.signals.cameraAdded.dispatch( camera );
				return;

			}

			this.cameras[ camera.uuid ] = camera;

			this.signals.cameraAdded.dispatch( camera );

		}

	},

	removeCamera: function ( camera ) {

		// Never unregister the default editor navigation camera
		if ( ! camera || camera === this.camera ) return;

		if ( this.cameras[ camera.uuid ] !== undefined ) {

			delete this.cameras[ camera.uuid ];

			if ( this.viewportCamera === camera ) {

				this.setViewportCamera( this.camera.uuid );

			}

			this.signals.cameraRemoved.dispatch( camera );

		}

	},

	//

	addHelper: function () {

		var geometry = new THREE.SphereGeometry( 2, 4, 2 );
		var material = new THREE.MeshBasicMaterial( { color: 0xff0000, visible: false } );

		return function ( object, helper ) {

			if ( helper === undefined ) {

				if ( object.isCamera ) {

					helper = new THREE.CameraHelper( object );

				} else if ( object.isPointLight ) {

					helper = new THREE.PointLightHelper( object, 1 );

					helper.matrix = new THREE.Matrix4();
					helper.matrixAutoUpdate = true;

					const light = object;
					const editor = this;

					helper.updateMatrixWorld = function () {

						light.getWorldPosition( this.position );

						const distance = editor.viewportCamera.position.distanceTo( this.position );
						this.scale.setScalar( distance / 30 );

						this.updateMatrix();
						this.matrixWorld.copy( this.matrix );

						const children = this.children;

						for ( let i = 0, l = children.length; i < l; i ++ ) {

							children[ i ].updateMatrixWorld();

						}

					};

				} else if ( object.isDirectionalLight ) {

					helper = new THREE.DirectionalLightHelper( object, 1 );

				} else if ( object.isSpotLight ) {

					helper = new THREE.SpotLightHelper( object );

				} else if ( object.isHemisphereLight ) {

					helper = new THREE.HemisphereLightHelper( object, 1 );

				} else if ( object.isSkinnedMesh ) {

					helper = new THREE.SkeletonHelper( object.skeleton.bones[ 0 ] );
					helper.userData.object = object;

				} else if ( object.isBone === true && object.parent && object.parent.isBone !== true ) {

					helper = new THREE.SkeletonHelper( object );
					helper.userData.object = object;

				} else {

					// no helper for this object type
					return;

				}

				if ( helper.isSkeletonHelper !== true ) {

					const picker = new THREE.Mesh( geometry, material );
					picker.name = 'picker';
					picker.userData.object = object;
					helper.add( picker );

				}

			}

			this.sceneHelpers.add( helper );
			this.helpers[ object.id ] = helper;

			this.signals.helperAdded.dispatch( helper );

		};

	}(),

	removeHelper: function ( object ) {

		if ( this.helpers[ object.id ] !== undefined ) {

			var helper = this.helpers[ object.id ];
			helper.parent.remove( helper );
			helper.dispose();

			delete this.helpers[ object.id ];

			this.signals.helperRemoved.dispatch( helper );

		}

	},

	//

	addScript: function ( object, script ) {

		if ( this.scripts[ object.uuid ] === undefined ) {

			this.scripts[ object.uuid ] = [];

		}

		this.scripts[ object.uuid ].push( script );

		this.signals.scriptAdded.dispatch( script );

	},

	removeScript: function ( object, script ) {

		if ( this.scripts[ object.uuid ] === undefined ) return;

		var index = this.scripts[ object.uuid ].indexOf( script );

		if ( index !== - 1 ) {

			this.scripts[ object.uuid ].splice( index, 1 );

		}

		this.signals.scriptRemoved.dispatch( script );

	},

	getObjectMaterial: function ( object, slot ) {

		var material = object.material;

		if ( Array.isArray( material ) && slot !== undefined ) {

			material = material[ slot ];

		}

		return material;

	},

	setObjectMaterial: function ( object, slot, newMaterial ) {

		if ( Array.isArray( object.material ) && slot !== undefined ) {

			object.material[ slot ] = newMaterial;

		} else {

			object.material = newMaterial;

		}

	},

	setCameraType: function ( type ) {

		const oldCamera = this.camera;

		const isOrthographic = oldCamera.isOrthographicCamera === true;

		if ( ( type === 'orthographic' && isOrthographic ) || ( type === 'perspective' && ! isOrthographic ) ) return;

		// the orbit point the framing should be preserved around

		const center = this.controls ? this.controls.center : new THREE.Vector3();
		const distance = oldCamera.position.distanceTo( center );

		let newCamera;

		if ( type === 'orthographic' ) {

			const halfSize = _ORTHOGRAPHIC_FRUSTUM_SIZE / 2;
			newCamera = new THREE.OrthographicCamera( - halfSize, halfSize, halfSize, - halfSize, 0, 10000 );
			newCamera.position.copy( oldCamera.position );
			newCamera.quaternion.copy( oldCamera.quaternion );

			// derive the zoom so the orthographic framing matches the perspective view at the orbit center

			const halfFOV = THREE.MathUtils.DEG2RAD * oldCamera.fov / 2;
			newCamera.zoom = ( newCamera.top - newCamera.bottom ) / ( 2 * Math.max( distance, 0.0001 ) * Math.tan( halfFOV ) );

		} else {

			newCamera = new THREE.PerspectiveCamera( 50, 1, 0.001, 1e10 );
			newCamera.quaternion.copy( oldCamera.quaternion );

			// reposition along the view direction so the perspective framing matches the orthographic view

			const halfFOV = THREE.MathUtils.DEG2RAD * newCamera.fov / 2;
			const targetDistance = ( oldCamera.top - oldCamera.bottom ) / ( 2 * oldCamera.zoom * Math.tan( halfFOV ) );

			const offset = new THREE.Vector3().subVectors( oldCamera.position, center );
			if ( offset.lengthSq() === 0 ) offset.set( 0, 0, 1 ).applyQuaternion( oldCamera.quaternion );
			offset.normalize().multiplyScalar( targetDistance );

			newCamera.position.copy( center ).add( offset );

		}

		newCamera.name = oldCamera.name;
		newCamera.uuid = oldCamera.uuid;
		newCamera.updateProjectionMatrix();

		this.camera = newCamera;
		this.cameras[ newCamera.uuid ] = newCamera;

		if ( this.viewportCamera === oldCamera ) this.viewportCamera = newCamera;

		this.signals.cameraResetted.dispatch();

		// keep the selection (and thus the sidebar) in sync with the new camera instance

		if ( this.selected === oldCamera ) this.select( newCamera );

	},

	setViewportCamera: function ( uuid ) {

		// Always keep the default editor camera registered for the viewport menu
		if ( this.camera && this.cameras[ this.camera.uuid ] !== this.camera ) {

			this.cameras[ this.camera.uuid ] = this.camera;

		}

		if ( ! uuid || uuid === '__editor__' || ( this.camera && uuid === this.camera.uuid ) ) {

			this.viewportCamera = this.camera;

		} else if ( this.cameras[ uuid ] !== undefined ) {

			this.viewportCamera = this.cameras[ uuid ];

		} else {

			this.viewportCamera = this.camera;

		}

		this.signals.viewportCameraChanged.dispatch( this.viewportCamera );

	},

	setViewportShading: function ( value ) {

		this.viewportShading = value;
		this.signals.viewportShadingChanged.dispatch();

	},

	//

	select: function ( object ) {

		this.selector.select( object );

	},

	selectById: function ( id ) {

		if ( id === this.camera.id ) {

			this.select( this.camera );
			return;

		}

		this.select( this.scene.getObjectById( id ) );

	},

	selectByUuid: function ( uuid ) {

		var scope = this;

		this.scene.traverse( function ( child ) {

			if ( child.uuid === uuid ) {

				scope.select( child );

			}

		} );

	},

	deselect: function () {

		this.selector.deselect();

	},

	focus: function ( object ) {

		if ( object !== undefined ) {

			this.signals.objectFocused.dispatch( object );

		}

	},

	focusById: function ( id ) {

		this.focus( this.scene.getObjectById( id ) );

	},

	clear: function () {

		this.history.clear();
		this.storage.clear();
		this.freecapcutAnims = [];
		this.activeFreecapcutAnim = createEmptyAnim( 'Animation', 30 );

		this.setCameraType( 'perspective' );
		this.camera.copy( _DEFAULT_CAMERA );
		this.signals.cameraResetted.dispatch();

		this.scene.name = 'Scene';
		this.scene.userData = {};
		this.scene.background = null;
		this.scene.environment = null;
		this.scene.fog = null;

		var objects = this.scene.children;

		this.signals.sceneGraphChanged.active = false;

		while ( objects.length > 0 ) {

			this.removeObject( objects[ 0 ] );

		}

		this.signals.sceneGraphChanged.active = true;

		this.geometries = {};
		this.materials = {};
		this.textures = {};
		this.scripts = {};

		this.materialsRefCounter.clear();

		this.animations = {};
	this.freecapcutAnims = [];
	this.activeFreecapcutAnim = null;
		this.mixer.stopAllAction();

		this.deselect();

		this.backgroundType = 'Default';
		this.environmentType = 'Default';

		// FreeFilmCut: drop previous project's settings before UI refresh
		this._resetProjectSettingsToDefaults();

		this.signals.editorCleared.dispatch();

	},

	//


	/**
	 * FreeFilmCut: editor.camera must never share a UUID with a scene camera.
	 * Older saves wrote viewportCamera (often a scene cam) into project.camera,
	 * which made outliner show one cam "outside" Scene and one inside with the same id.
	 */
	ensureEditorCameraUnique: function () {

		const editorCam = this.camera;
		if ( ! editorCam ) return false;

		// Editor nav camera should not carry a post-process stack
		if ( editorCam.userData && editorCam.userData.postProcessStack ) {

			delete editorCam.userData.postProcessStack;

		}

		let sceneCamWithSameUuid = null;
		this.scene.traverse( ( obj ) => {

			if ( obj.isCamera && obj !== editorCam && obj.uuid === editorCam.uuid ) {

				sceneCamWithSameUuid = obj;

			}

		} );

		if ( sceneCamWithSameUuid === null ) {

			// Keep map entry pointing at the editor camera
			this.cameras[ editorCam.uuid ] = editorCam;
			return false;

		}

		const oldUuid = editorCam.uuid;
		const newUuid = THREE.MathUtils.generateUUID();
		editorCam.uuid = newUuid;

		// Scene camera owns the old uuid in the registry
		this.cameras[ oldUuid ] = sceneCamWithSameUuid;
		this.cameras[ newUuid ] = editorCam;

		if ( this.viewportCamera === editorCam || this.viewportCamera === sceneCamWithSameUuid ) {

			// Prefer staying on editor nav after load repair; user can switch back via menu
			this.viewportCamera = editorCam;

		}

		console.warn( '[FreeFilmCut] Editor camera UUID collided with scene camera; minted new editor uuid', oldUuid, '->', newUuid );
		this.signals.cameraResetted.dispatch();
		return true;

	},


	/**
	 * FreeFilmCut: project-scoped settings live in Config (localStorage) for live UI,
	 * but must also round-trip through project.json. Otherwise opening project B
	 * keeps A's pack type / cover / resolution / etc.
	 */
	_projectSettingDefaults: function () {

		return {
			'project/title': '',
			'project/editable': false,
			'project/vr': false,
			'project/camera': 'perspective',
			'project/resolution/width': 1920,
			'project/resolution/height': 1080,
			'project/resolution/showFrame': true,
			'project/vfxpack/type': 'effect',
			'project/vfxpack/stickerAnimPhase': 'in',
			'project/vfxpack/previewPoster': '',
			'project/vfxpack/previewPosterName': '',
			'project/vfxpack/previewHover': '',
			'project/vfxpack/previewHoverName': '',
			'project/previewExport/width': 256,
			'project/previewExport/height': 256,
			'project/previewExport/fps': 10,
			'project/previewExport/maxKB': 800,
			'project/previewExport/speed': 1,
			'project/previewExport/pingpong': false,
			'project/renderer/type': 'WebGLRenderer',
			'project/renderer/antialias': true,
			'project/renderer/shadows': true,
			'project/renderer/shadowType': 1,
			'project/renderer/toneMapping': 7,
			'project/renderer/toneMappingExposure': 1
		};

	},

	_resetProjectSettingsToDefaults: function () {

		const defaults = this._projectSettingDefaults();
		const args = [];
		for ( const key in defaults ) {

			args.push( key, defaults[ key ] );

		}

		this.config.setKey.apply( this.config, args );

	},

	_collectProjectSettings: function () {

		const c = this.config;
		const g = ( key, fallback ) => {

			const v = c.getKey( key );
			return v === undefined || v === null ? fallback : v;

		};

		return {
			title: g( 'project/title', '' ),
			name: g( 'project/title', '' ),
			editable: !! g( 'project/editable', false ),
			vr: !! g( 'project/vr', false ),
			camera: g( 'project/camera', 'perspective' ) || 'perspective',
			renderer: g( 'project/renderer/type', 'WebGLRenderer' ) || 'WebGLRenderer',
			antialias: g( 'project/renderer/antialias', true ) !== false,
			shadows: g( 'project/renderer/shadows', true ) !== false,
			shadowType: g( 'project/renderer/shadowType', 1 ),
			toneMapping: g( 'project/renderer/toneMapping', 7 ),
			toneMappingExposure: g( 'project/renderer/toneMappingExposure', 1 ),
			resolution: {
				width: parseInt( g( 'project/resolution/width', 1920 ), 10 ) || 1920,
				height: parseInt( g( 'project/resolution/height', 1080 ), 10 ) || 1080,
				showFrame: g( 'project/resolution/showFrame', true ) !== false
			},
			vfxpack: {
				type: g( 'project/vfxpack/type', 'effect' ) || 'effect',
				stickerAnimPhase: g( 'project/vfxpack/stickerAnimPhase', 'in' ) || 'in',
				previewPoster: g( 'project/vfxpack/previewPoster', '' ) || '',
				previewPosterName: g( 'project/vfxpack/previewPosterName', '' ) || '',
				previewHover: g( 'project/vfxpack/previewHover', '' ) || '',
				previewHoverName: g( 'project/vfxpack/previewHoverName', '' ) || ''
			},
			previewExport: {
				width: parseInt( g( 'project/previewExport/width', 256 ), 10 ) || 256,
				height: parseInt( g( 'project/previewExport/height', 256 ), 10 ) || 256,
				fps: parseInt( g( 'project/previewExport/fps', 10 ), 10 ) || 10,
				maxKB: parseInt( g( 'project/previewExport/maxKB', 800 ), 10 ) || 800,
				speed: Number( g( 'project/previewExport/speed', 1 ) ) || 1,
				pingpong: g( 'project/previewExport/pingpong', false ) === true
			},
			// Animation panel playhead. A wipe at progress 0 hides the whole
			// line, so reopening a project at t=0 reads as "the effect broke".
			animPreviewTime: typeof this.getAnimPreviewTime === 'function' ? this.getAnimPreviewTime() : 0
		};

	},

	_applyProjectSettingsFromJSON: function ( json ) {

		const p = ( json && json.project ) || {};
		const meta = ( json && json.metadata ) || {};
		const defaults = this._projectSettingDefaults();
		const res = p.resolution && typeof p.resolution === 'object' ? p.resolution : {};
		const vfx = p.vfxpack && typeof p.vfxpack === 'object' ? p.vfxpack : {};
		const pe = p.previewExport && typeof p.previewExport === 'object' ? p.previewExport : {};

		const rawTitle = p.title || p.name || meta.title;
		const title = ( typeof rawTitle === 'string' && rawTitle.trim() )
			? rawTitle.trim()
			: ( this.config.getKey( 'project/title' ) || defaults[ 'project/title' ] );
		const pick = ( value, fallback ) => ( value === undefined || value === null ? fallback : value );

		// Always start from defaults so a field missing in an older project.json
		// does not leak the previous project's Config / localStorage values.
		const next = {
			'project/title': typeof title === 'string' ? title : '',
			'project/editable': !! pick( p.editable, defaults[ 'project/editable' ] ),
			'project/vr': !! pick( p.vr, defaults[ 'project/vr' ] ),
			'project/camera': pick( p.camera, defaults[ 'project/camera' ] ) || 'perspective',
			'project/renderer/type': pick( p.renderer, defaults[ 'project/renderer/type' ] ) || 'WebGLRenderer',
			'project/renderer/antialias': pick( p.antialias, defaults[ 'project/renderer/antialias' ] ) !== false,
			'project/renderer/shadows': pick( p.shadows, defaults[ 'project/renderer/shadows' ] ) !== false,
			'project/renderer/shadowType': pick( p.shadowType, defaults[ 'project/renderer/shadowType' ] ),
			'project/renderer/toneMapping': pick( p.toneMapping, defaults[ 'project/renderer/toneMapping' ] ),
			'project/renderer/toneMappingExposure': ( () => {

				const exp = Number( pick( p.toneMappingExposure, defaults[ 'project/renderer/toneMappingExposure' ] ) );
				return Number.isFinite( exp ) && exp > 0 ? exp : 1;

			} )(),
			'project/resolution/width': parseInt( pick( res.width, defaults[ 'project/resolution/width' ] ), 10 ) || 1920,
			'project/resolution/height': parseInt( pick( res.height, defaults[ 'project/resolution/height' ] ), 10 ) || 1080,
			'project/resolution/showFrame': pick( res.showFrame, defaults[ 'project/resolution/showFrame' ] ) !== false,
			'project/vfxpack/type': pick( vfx.type, defaults[ 'project/vfxpack/type' ] ) || 'effect',
			'project/vfxpack/stickerAnimPhase': pick( vfx.stickerAnimPhase, defaults[ 'project/vfxpack/stickerAnimPhase' ] ) || 'in',
			'project/vfxpack/previewPoster': pick( vfx.previewPoster, defaults[ 'project/vfxpack/previewPoster' ] ) || '',
			'project/vfxpack/previewPosterName': pick( vfx.previewPosterName, defaults[ 'project/vfxpack/previewPosterName' ] ) || '',
			'project/vfxpack/previewHover': pick( vfx.previewHover, defaults[ 'project/vfxpack/previewHover' ] ) || '',
			'project/vfxpack/previewHoverName': pick( vfx.previewHoverName, defaults[ 'project/vfxpack/previewHoverName' ] ) || '',
			'project/previewExport/width': parseInt( pick( pe.width, defaults[ 'project/previewExport/width' ] ), 10 ) || 256,
			'project/previewExport/height': parseInt( pick( pe.height, defaults[ 'project/previewExport/height' ] ), 10 ) || 256,
			'project/previewExport/fps': parseInt( pick( pe.fps, defaults[ 'project/previewExport/fps' ] ), 10 ) || 10,
			'project/previewExport/maxKB': parseInt( pick( pe.maxKB, defaults[ 'project/previewExport/maxKB' ] ), 10 ) || 800,
			'project/previewExport/speed': Number( pick( pe.speed, defaults[ 'project/previewExport/speed' ] ) ) || 1,
			'project/previewExport/pingpong': pick( pe.pingpong, defaults[ 'project/previewExport/pingpong' ] ) === true
		};

		const args = [];
		for ( const key in next ) {

			args.push( key, next[ key ] );

		}

		this.config.setKey.apply( this.config, args );

		if ( this.signals.projectTitleChanged ) {

			this.signals.projectTitleChanged.dispatch( this.config.getKey( 'project/title' ) || '' );

		}

		if ( this.signals.projectSettingsChanged ) {

			this.signals.projectSettingsChanged.dispatch();

		}

		if ( this.signals.resolutionChanged ) {

			this.signals.resolutionChanged.dispatch();

		}

		if ( this.signals.vfxpackChanged ) {

			this.signals.vfxpackChanged.dispatch();

		}

	},

	fromJSON: async function ( json ) {

		this.isLoadingState = true;

		try {

			// FreeFilmCut: restore ALL project-scoped settings from project.json
			// (pack type, cover, hover GIF, resolution, renderer, ...).
			// Missing fields use defaults - never leave the previous project's Config.
			this._applyProjectSettingsFromJSON( json );

			var loader = new THREE.ObjectLoader();
			var camera = await loader.parseAsync( json.camera );

			this.setCameraType( camera.isOrthographicCamera ? 'orthographic' : 'perspective' );

			const existingUuid = this.camera.uuid;
			const incomingUuid = camera.uuid;

			// copy all properties, including uuid
			this.camera.copy( camera );
			this.camera.uuid = incomingUuid;

			// Editor nav camera must not inherit a scene camera's post-process stack
			if ( this.camera.userData && this.camera.userData.postProcessStack ) {

				delete this.camera.userData.postProcessStack;

			}

			delete this.cameras[ existingUuid ]; // remove old entry [existingUuid, this.camera]
			this.cameras[ incomingUuid ] = this.camera; // add new entry [incomingUuid, this.camera]

			if ( json.controls !== undefined ) {

				this.controls.fromJSON( json.controls );

			}

			this.signals.cameraResetted.dispatch();

			this.history.fromJSON( json.history );
			this.scripts = json.scripts;

			const scene = await loader.parseAsync( json.scene );

			this.backgroundType = json.backgroundType || 'Default';
			this.environmentType = json.environmentType || 'Default';

			// Hydrate assets/flower/… from the bound folder before setScene so the
			// first Troika sync hits `_fccTexCache` instead of failing HTTP loads.
			try {

				await restoreFlowerTexturesFromProject( this, scene );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] restoreFlowerTextures before setScene', e );

			}

			this.setScene( scene );

			// Detach editor.camera if project.camera UUID collided with a scene camera
			this.ensureEditorCameraUnique();

			// Animation panel playhead saved by toJSON(); Animation.js consumes it
			// when the restored clips arrive (freecapcutAnimsChanged).
			{
				const p = json.project || {};
				// textAnimPreviewTime: pre-keyframe projects (same seconds after migration).
				const t = p.animPreviewTime != null ? p.animPreviewTime : p.textAnimPreviewTime;
				this.pendingAnimPreviewTime = ( typeof t === 'number' && Number.isFinite( t ) && t > 0 ) ? t : 0;
			}

			// Restore Editor-only uInput / belowInput preview textures from userData
			try {

				await restoreEditorBelowPreviewsInScene( this.scene );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] restoreEditorBelowPreviewsInScene failed', e );

			}

			// FreeFilmCut: restore .anim clips from project.json
			try {

				const fc = json.freecapcut || null;
				const n = applyProjectAnimPayload( this, fc || { animations: [] } );
				// Merge on-disk .anim — but when project.json already carried a
				// freecapcut.animations list, only load paths listed in index so
				// removed controllers/clips are not resurrected from orphan files.
				let onlyPaths = null;
				if ( fc && Array.isArray( fc.animations ) ) {

					onlyPaths = new Set();
					for ( const item of ( fc.index || [] ) ) {

						if ( item && item.path ) onlyPaths.add( String( item.path ) );

					}
					// No index entries ⇒ trust inlined animations only (skip disk).

				}
				await loadFreecapcutAnimsFromProjectFolder( this, { onlyPaths } );
				if ( this.signals.freecapcutAnimsChanged ) {

					this.signals.freecapcutAnimsChanged.dispatch( n );

				}

			} catch ( e ) {

				console.warn( '[FreeFilmCut] restore freecapcut anims failed', e );

			}

		} catch ( err ) {

			console.error( 'Editor.fromJSON failed:', err );
			throw err;

		} finally {

			this.isLoadingState = false;

			// Project JSON keeps blob: font URLs that die after refresh / reopen.
			// projectFolderChanged often fired restore on an empty scene *before*
			// fromJSON; re-run now that the scene exists so Troika can fetch live fonts.
			try {

				await restoreUITextFontsFromProject( this );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] restoreUITextFonts after fromJSON', e );

			}

			// FlowerStyle texture.path values like assets/flower/<id>/x.png live in the
			// bound project folder — TextureLoader cannot see them; hydrate then rebuild.
			try {

				await restoreFlowerTexturesFromProject( this );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] restoreFlowerTextures after fromJSON', e );

			}

			// MediaFramePlayer: userData keeps projectPath/kind but __fccVideo / __fccGif
			// live only in memory — re-attach from the bound project folder (same as
			// sidebar re-pick). Must run after setScene, with folder already bound.
			try {

				await restoreFccVideosFromProject( this );

			} catch ( e ) {

				console.warn( '[FreeFilmCut] restoreFccVideos after fromJSON', e );

			}

			// The only paint triggered while loading (setScene → sceneGraphChanged)
			// happens while isLoadingState is still true, and UIOverlay skips UI in
			// that state — so a loaded project would show no text layer at all (and
			// any wipeReveal pass would sample an empty RT) until the user nudged the
			// view. Request one paint now that loading has finished.
			const schedule = ( typeof requestAnimationFrame === 'function' )
				? requestAnimationFrame
				: function ( fn ) {

					return setTimeout( fn, 16 );

				};

			schedule( () => {

				if ( this.signals && this.signals.windowResize ) this.signals.windowResize.dispatch();

				// Post-process only runs on viewportCamera. After reload the nav cam
				// is active — jump to the first scene camera that has an enabled stack
				// so checked effects are visible without an extra click.
				try {

					let ppCam = null;
					this.scene.traverse( ( obj ) => {

						if ( ppCam || ! obj.isCamera ) return;
						const stack = obj.userData && obj.userData.postProcessStack;
						if ( ! stack || stack.enabled === false ) return;
						if ( ( stack.effects || [] ).some( ( e ) => e && e.enabled !== false ) ) ppCam = obj;

					} );
					if ( ppCam && this.viewportCamera !== ppCam ) this.setViewportCamera( ppCam.uuid );

				} catch ( e ) { /* ignore */ }

			} );

		}

	},


	setProjectTitle: function ( title ) {

		const untitled = ( this.strings && this.strings.getKey( 'prompt/file/untitledProject' ) ) || 'Untitled Project';
		let t = ( title == null ) ? '' : String( title ).trim();
		if ( ! t ) t = untitled;
		this.config.setKey( 'project/title', t );
		try {

			document.title = 'FreeFilmCut — ' + t;

		} catch ( e ) { /* ignore */ }

		if ( this.signals.projectTitleChanged ) this.signals.projectTitleChanged.dispatch( t );
		return t;

	},

	
	restoreUITextFonts: async function () {

		try {

			await restoreUITextFontsFromProject( this );

		} catch ( e ) {

			console.warn( '[FreeFilmCut] restoreUITextFonts', e );

		}

		try {

			await restoreFlowerTexturesFromProject( this );

		} catch ( e ) {

			console.warn( '[FreeFilmCut] restoreFlowerTextures', e );

		}

	},

	flushAnimsToProjectFolder: async function () {

		try {

			return await flushFreecapcutAnimsToProject( this );

		} catch ( e ) {

			console.warn( '[FreeFilmCut] flushAnimsToProjectFolder', e );
			return { saved: 0, paths: [] };

		}

	},

	getProjectTitle: function () {

		const untitled = ( this.strings && this.strings.getKey( 'prompt/file/untitledProject' ) ) || 'Untitled Project';
		const t = this.config.getKey( 'project/title' );
		return ( t && String( t ).trim() ) ? String( t ).trim() : untitled;

	},

	toJSON: function () {

		// scripts clean up

		var scene = this.scene;
		var scripts = this.scripts;

		for ( var key in scripts ) {

			var script = scripts[ key ];

			if ( script.length === 0 || scene.getObjectByProperty( 'uuid', key ) === undefined ) {

				delete scripts[ key ];

			}

		}

		return {

			metadata: {
				title: this.config.getKey( 'project/title' ) || ''
			},
			project: this._collectProjectSettings(),
			camera: ( function () {

				// Always the dedicated editor nav camera — never a scene camera
				// (viewportCamera may be a scene PerspectiveCamera for bloom preview).
				const camJSON = this.camera.toJSON();
				if ( camJSON.object && camJSON.object.userData ) {
					delete camJSON.object.userData.postProcessStack;
					if ( Object.keys( camJSON.object.userData ).length === 0 ) {
						delete camJSON.object.userData;
					}
				}
				return camJSON;

			} ).call( this ),
			controls: this.controls.toJSON(),
			scene: ( function () {

				const sceneJSON = this.scene.toJSON();
				// FreeFilmCut: ShaderMaterial UI bridge sets .color/.map for sidebar;
				// strip duplicates so ObjectLoader keeps uniforms-only (avoids corrupt reloads).
				if ( sceneJSON.materials ) {

					for ( const mat of Object.values( sceneJSON.materials ) ) {

						if ( mat.type === 'ShaderMaterial' || mat.type === 'RawShaderMaterial' ) {

							delete mat.color;
							delete mat.map;
							// Keep editorPreviewInputs in userData; null below-input uniforms so
							// ObjectLoader does not embed the Editor-only preview as a real map.
							if ( mat.uniforms ) {

								for ( const n of BELOW_INPUT_UNIFORM_NAMES ) {

									if ( mat.uniforms[ n ] ) mat.uniforms[ n ] = { type: 't', value: null };

								}

							}

						}

					}

				}

				return sceneJSON;

			} ).call( this ),
			scripts: this.scripts,
			freecapcut: buildProjectAnimPayload( this ),
			history: this.history.toJSON(),
			backgroundType: this.backgroundType,
			environmentType: this.environmentType

		};

	},

	objectByUuid: function ( uuid ) {

		return this.scene.getObjectByProperty( 'uuid', uuid, true );

	},

	execute: function ( cmd, optionalName ) {

		this.history.execute( cmd, optionalName );

	},

	undo: function () {

		this.history.undo();

	},

	redo: function () {

		this.history.redo();

	},

	utils: {

		save: save,
		saveArrayBuffer: saveArrayBuffer,
		saveString: saveString,
		formatNumber: formatNumber

	}

};

const link = document.createElement( 'a' );

function save( blob, filename ) {

	if ( link.href ) {

		URL.revokeObjectURL( link.href );

	}

	link.href = URL.createObjectURL( blob );
	link.download = filename || 'data.json';
	link.dispatchEvent( new MouseEvent( 'click' ) );

}

function saveArrayBuffer( buffer, filename ) {

	save( new Blob( [ buffer ], { type: 'application/octet-stream' } ), filename );

}

function saveString( text, filename ) {

	save( new Blob( [ text ], { type: 'text/plain' } ), filename );

}

function formatNumber( number ) {

	return new Intl.NumberFormat( 'en-us', { useGrouping: true } ).format( number );

}

export { Editor };
