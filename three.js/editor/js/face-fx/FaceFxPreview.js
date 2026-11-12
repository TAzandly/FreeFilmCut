/**
 * Face FX preview controller.
 *
 * Sources (priority):
 * 1. MediaFramePlayer → RenderTexture (live video/gif) — detect from video/canvas element
 * 2. Mesh sampling uInput / belowInput / iChannel0 — detect from that texture (NLE parity)
 *
 * Anchors pose on the plane that displays the same source.
 */

import * as THREE from 'three';
import {
	isFccVideoPlayer,
	isFccRenderTexture,
	ensureRenderTarget
} from '../media/FccVideo.js?v=fcc-ui-207';
import { readEditorFaceFx } from './FaceFxConfig.js?v=fcc-ui-240';
import { detectFacesFromImage } from './FaceFxLandmarks.js?v=fcc-ui-240';
import { FaceFxGpuPass } from './FaceFxGpuPass.js?v=fcc-ui-240';
import { FaceFxAnchors } from './FaceFxAnchors.js?v=fcc-ui-240';
import {
	findBelowInputMesh,
	snapshotTextureForDetect,
	texturePixelSize
} from './FaceFxTextureSnapshot.js?v=fcc-ui-252';

const VP_KEY = 'fccVideoPlayer';
const THROTTLE_MS = 50;

function packTypeIsFaceFx( editor ) {

	const t = editor && editor.config && editor.config.getKey( 'project/vfxpack/type' );
	return String( t || '' ).trim().toLowerCase() === 'face-fx';

}

function findMediaPlayers( scene ) {

	const list = [];
	if ( ! scene ) return list;
	scene.traverse( ( object ) => {

		if ( isFccVideoPlayer( object ) ) list.push( object );

	} );
	return list;

}

function findPlaneSamplingRt( scene, rtUuid ) {

	let found = null;
	scene.traverse( ( object ) => {

		if ( found || ! object.isMesh || ! object.material ) return;
		const mats = Array.isArray( object.material ) ? object.material : [ object.material ];
		for ( const mat of mats ) {

			if ( ! mat ) continue;
			const map = mat.map;
			if ( map && map.userData && map.userData.fccRenderTextureUuid === rtUuid ) {

				found = object;
				return;

			}
			if ( mat.uniforms ) {

				for ( const name in mat.uniforms ) {

					const tex = mat.uniforms[ name ] && mat.uniforms[ name ].value;
					if ( tex && tex.isTexture && tex.userData && tex.userData.fccRenderTextureUuid === rtUuid ) {

						found = object;
						return;

					}

				}

			}

		}

	} );
	return found;

}

function projectResolution( editor ) {

	const w = editor && editor.config && editor.config.getKey( 'project/resolution/width' );
	const h = editor && editor.config && editor.config.getKey( 'project/resolution/height' );
	return {
		width: ( typeof w === 'number' && w > 0 ) ? w : 1080,
		height: ( typeof h === 'number' && h > 0 ) ? h : 1920
	};

}

function FaceFxPreview( editor ) {

	this.editor = editor;
	this.enabled = false;
	this.gpu = new FaceFxGpuPass();
	this.anchors = new FaceFxAnchors( editor );
	this.lastFaces = [];
	this.lastDetectAt = 0;
	this.detectInflight = false;
	this.status = { phase: 'idle', message: '' };
	this._time = 0;
	this._workRt = null;
	this._blitMat = new THREE.MeshBasicMaterial( {
		map: null,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		transparent: true,
		blending: THREE.NoBlending
	} );
	this._blitMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), this._blitMat );
	this._blitMesh.frustumCulled = false;
	this._blitScene = new THREE.Scene();
	this._blitScene.add( this._blitMesh );
	this._blitCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}

FaceFxPreview.prototype.setEnabled = function ( on ) {

	this.enabled = !! on;
	if ( ! this.enabled ) {

		this.anchors.clear();
		this.lastFaces = [];
		this.status = { phase: 'idle', message: '' };

	}
	if ( this.editor.signals && this.editor.signals.sceneGraphChanged ) {

		this.editor.signals.sceneGraphChanged.dispatch();

	}

};

FaceFxPreview.prototype.getStatus = function () {

	return this.status;

};

FaceFxPreview.prototype._setStatus = function ( phase, message ) {

	this.status = { phase, message: message || '' };
	if ( this.editor.signals && this.editor.signals.faceFxPreviewStatus ) {

		this.editor.signals.faceFxPreviewStatus.dispatch( this.status );

	}

};

FaceFxPreview.prototype._blitToRt = function ( renderer, texture, rt ) {

	const prev = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	const prevTone = renderer.toneMapping;
	this._blitMat.map = texture;
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.autoClear = false;
	renderer.setRenderTarget( rt );
	renderer.setViewport( 0, 0, rt.width, rt.height );
	renderer.clear( true, true, true );
	renderer.render( this._blitScene, this._blitCam );
	this._blitMat.map = null;
	renderer.setRenderTarget( prev );
	renderer.autoClear = prevAuto;
	renderer.toneMapping = prevTone;

};

FaceFxPreview.prototype._ensureWorkRt = function ( width, height ) {

	const w = Math.max( 1, width | 0 );
	const h = Math.max( 1, height | 0 );
	if ( this._workRt && this._workRt.width === w && this._workRt.height === h ) return this._workRt;
	if ( this._workRt ) this._workRt.dispose();
	this._workRt = new THREE.WebGLRenderTarget( w, h, {
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		depthBuffer: false,
		stencilBuffer: false
	} );
	return this._workRt;

};

FaceFxPreview.prototype._kickDetect = function ( source, config ) {

	if ( this.detectInflight ) return;
	const now = performance.now();
	if ( now - this.lastDetectAt < THROTTLE_MS ) return;
	this.detectInflight = true;
	this.lastDetectAt = now;
	this._setStatus( 'detecting', 'Detecting faces…' );
	detectFacesFromImage( source, {
		transformationMatrix: config.driver && config.driver.transformationMatrix !== false
	} ).then( ( faces ) => {

		this.lastFaces = faces || [];
		this._setStatus(
			faces && faces.length ? 'ready' : 'noface',
			faces && faces.length ? ( faces.length + ' face(s)' ) : 'No face'
		);
		if ( this.editor.signals && this.editor.signals.sceneGraphChanged ) {

			this.editor.signals.sceneGraphChanged.dispatch();

		}

	} ).catch( ( err ) => {

		console.warn( '[FaceFx] detect failed', err );
		this._setStatus( 'error', err && err.message ? err.message : 'Detect failed' );

	} ).finally( () => {

		this.detectInflight = false;

	} );

};

/**
 * Resolve preview input: MediaPlayer RT first, else uInput mesh.
 * @returns {{
 *   mode: 'media'|'uinput',
 *   inputTexture: THREE.Texture,
 *   planeMesh: THREE.Mesh|null,
 *   workRt: THREE.WebGLRenderTarget|null,
 *   detectElement: HTMLElement|ImageBitmap|null,
 *   width: number,
 *   height: number
 * }|null}
 */
FaceFxPreview.prototype._resolveSource = function ( renderer, scene ) {

	const players = findMediaPlayers( scene );
	for ( const p of players ) {

		const vp = p.userData[ VP_KEY ];
		if ( ! vp || ! vp.targetUuid ) continue;
		const target = scene.getObjectByProperty( 'uuid', vp.targetUuid );
		if ( ! target || ! isFccRenderTexture( target ) ) continue;
		const rt = ensureRenderTarget( target );
		if ( ! rt ) continue;
		const detectElement = p.__fccVideo || p.__fccFrameCanvas || null;
		const plane = findPlaneSamplingRt( scene, target.uuid );
		return {
			mode: 'media',
			inputTexture: rt.texture,
			planeMesh: plane,
			workRt: rt,
			detectElement,
			width: rt.width,
			height: rt.height,
			writeBack: true
		};

	}

	const below = findBelowInputMesh( scene );
	if ( ! below ) return null;

	const size = texturePixelSize( below.texture );
	const fallback = projectResolution( this.editor );
	const width = size.width || fallback.width;
	const height = size.height || fallback.height;
	const workRt = this._ensureWorkRt( width, height );
	return {
		mode: 'uinput',
		inputTexture: below.texture,
		planeMesh: below.mesh,
		workRt,
		detectElement: null, // async snapshot
		textureForSnapshot: below.texture,
		width,
		height,
		writeBack: false, // keep author's uInput; warp writes into workRt only if needed
		belowMaterial: below.material,
		belowUniformName: below.uniformName
	};

};

FaceFxPreview.prototype._kickDetectFromTexture = function ( renderer, texture, config, width, height ) {

	if ( this.detectInflight ) return;
	const now = performance.now();
	if ( now - this.lastDetectAt < THROTTLE_MS ) return;
	this.detectInflight = true;
	this.lastDetectAt = now;
	this._setStatus( 'detecting', 'Detecting faces from uInput…' );

	snapshotTextureForDetect( renderer, texture, { width, height } ).then( ( source ) => {

		if ( ! source ) {

			this._setStatus( 'error', 'Could not read uInput texture' );
			this.detectInflight = false;
			return;
		}

		return detectFacesFromImage( source, {
			transformationMatrix: config.driver && config.driver.transformationMatrix !== false
		} ).then( ( faces ) => {

			this.lastFaces = faces || [];
			this._setStatus(
				faces && faces.length ? 'ready' : 'noface',
				faces && faces.length
					? ( faces.length + ' face(s) · uInput' )
					: 'No face in uInput'
			);
			if ( this.editor.signals && this.editor.signals.sceneGraphChanged ) {

				this.editor.signals.sceneGraphChanged.dispatch();

			}

		} );

	} ).catch( ( err ) => {

		console.warn( '[FaceFx] uInput detect failed', err );
		this._setStatus( 'error', err && err.message ? err.message : 'uInput detect failed' );

	} ).finally( () => {

		this.detectInflight = false;

	} );

};

/**
 * Call each viewport frame after updateFccVideos.
 * @returns {boolean} true if the viewport should keep animating
 */
FaceFxPreview.prototype.update = function ( renderer, scene, delta ) {

	if ( ! this.enabled || ! renderer || ! scene ) return false;
	if ( ! packTypeIsFaceFx( this.editor ) ) {

		this._setStatus( 'needtype', 'Set Pack type to Face FX' );
		this.anchors.clear();
		return false;

	}

	const config = readEditorFaceFx( this.editor );
	if ( ! config.layers.length ) {

		this._setStatus( 'empty', 'No faceFx layers — pick a preset' );
		this.anchors.clear();
		return false;

	}

	const source = this._resolveSource( renderer, scene );
	if ( ! source ) {

		this._setStatus(
			'needmedia',
			'Add MediaFramePlayer+RT, or bind a uInput preview image on the effect plane'
		);
		this.anchors.clear();
		return false;

	}

	this._time += delta || 0;

	if ( source.mode === 'media' && source.detectElement ) {

		this._kickDetect( source.detectElement, config );

	} else if ( source.mode === 'uinput' && source.textureForSnapshot ) {

		this._kickDetectFromTexture(
			renderer,
			source.textureForSnapshot,
			config,
			source.width,
			source.height
		);

	}

	const faces = this.lastFaces;
	const hasGlb = config.layers.some( ( l ) => l.kind === 'anchor3d' && l.asset );
	void this.anchors.syncLayers( config.layers );

	if ( faces.length > 0 ) {

		if ( source.mode === 'media' && source.workRt ) {

			const out = this.gpu.apply( {
				renderer,
				inputTexture: source.inputTexture,
				width: source.width,
				height: source.height,
				faces,
				config,
				timeSec: this._time,
				skipProceduralEars: hasGlb
			} );
			if ( out && out !== source.workRt.texture ) {

				this._blitToRt( renderer, out, source.workRt );

			}

		} else if ( source.mode === 'uinput' && source.workRt ) {

			// Warp/ray into an offscreen RT. Do not overwrite the author's uInput
			// preview texture (export/NLE still bind null / accumBelow).
			this._blitToRt( renderer, source.inputTexture, source.workRt );
			const out = this.gpu.apply( {
				renderer,
				inputTexture: source.workRt.texture,
				width: source.width,
				height: source.height,
				faces,
				config,
				timeSec: this._time,
				skipProceduralEars: hasGlb
			} );
			if ( out && out !== source.workRt.texture ) {

				this._blitToRt( renderer, out, source.workRt );

			}

		}

		this.anchors.updatePoses( {
			faces,
			planeMesh: source.planeMesh,
			maxFaces: config.driver.maxFaces
		} );

	} else {

		this.anchors.updatePoses( { faces: [], planeMesh: null } );

	}

	return true;

};

FaceFxPreview.prototype.dispose = function () {

	this.gpu.dispose();
	this.anchors.dispose();
	this._blitMat.dispose();
	this._blitMesh.geometry.dispose();
	if ( this._workRt ) {

		this._workRt.dispose();
		this._workRt = null;

	}

};

export { FaceFxPreview, packTypeIsFaceFx };
