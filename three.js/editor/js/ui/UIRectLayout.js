/**
 * Unity-like RectTransform layout.
 * Overlay: screen pixels, ortho camera after PP.
 * Camera: same pixel layout, then place Canvas as a plane in front of the
 * target camera at planeDistance (Unity Screen Space — Camera).
 */

import * as THREE from 'three';

import {
	getFccUI,
	isUICanvas,
	UI_LAYER,
	UI_CAMERA_LAYER,
	RENDER_MODE_CAMERA,
	RENDER_MODE_OVERLAY,
	getCanvasRenderMode,
	getOwningCanvasRenderMode,
	DEFAULT_PLANE_DISTANCE,
	readLocalEulerDegrees,
	readLocalScale,
	FCC_IMAGE_MESH,
} from './UIConstants.js?v=fcc-ui-108';
import { applyTextTransform, applyTextTransformNested } from './UIText.js?v=fcc-ui-234';

/**
 * Apply fccUI localEulerAngles (deg) + localScale only.
 * Do NOT bake rect size into scale — non-uniform size×scale warps X/Y rotation
 * (Z in-plane looked fine; small X/Y values looked huge). Size belongs on PlaneGeometry.
 * @param {THREE.Object3D} node
 * @param {object} ui
 */
export function applyLocalRotScale( node, ui ) {

	let [ sx, sy, sz ] = readLocalScale( ui );
	// Old bugs / mistaken edits may bake pixel size into localScale (>10).
	// That re-introduces non-uniform scale and warps X/Y rotation.
	if ( Math.abs( sx ) > 10 || Math.abs( sy ) > 10 || Math.abs( sz ) > 10 ) {

		console.warn( '[FreeFilmCut] UI localScale looks like pixel size; clamping to 1,1,1', sx, sy, sz );
		sx = 1;
		sy = 1;
		sz = 1;
		if ( ui ) ui.localScale = [ 1, 1, 1 ];

	}

	const [ ex, ey, ez ] = readLocalEulerDegrees( ui );
	node.matrixAutoUpdate = true;
	node.scale.set( sx, sy, sz );
	// Unity UI commonly uses ZXY; keep XYZ to match Three defaults but apply in one Euler.
	node.rotation.order = 'YXZ'; // Y then X then Z — closer to typical camera/UI tilt feel
	node.rotation.set(
		THREE.MathUtils.degToRad( ex ),
		THREE.MathUtils.degToRad( ey ),
		THREE.MathUtils.degToRad( ez ),
	);

}

/**
 * Keep Image mesh PlaneGeometry sized to the layout rect (pixel W×H).
 * @param {THREE.Object3D} node
 * @param {number} w
 * @param {number} h
 */
export function syncImageGeometrySize( node, w, h ) {

	if ( ! node || ! node.isMesh ) return;
	const width = Math.max( 0.0001, w );
	const height = Math.max( 0.0001, h );
	const g = node.geometry;
	if ( g && g.type === 'PlaneGeometry' && g.parameters ) {

		if ( Math.abs( g.parameters.width - width ) < 0.05
			&& Math.abs( g.parameters.height - height ) < 0.05 ) {

			return;

		}

		g.dispose();

	} else if ( g ) {

		g.dispose();

	}

	node.geometry = new THREE.PlaneGeometry( width, height );

}

/**
 * @param {object} ui fccUI data
 * @param {{x:number,y:number,w:number,h:number}} parentRect
 * @returns {{x:number,y:number,w:number,h:number}} rect in parent/canvas space
 */
export function computeAnchoredRect( ui, parentRect ) {

	const aMin = ui.anchorMin || [ 0.5, 0.5 ];
	const aMax = ui.anchorMax || [ 0.5, 0.5 ];
	const pivot = ui.pivot || [ 0.5, 0.5 ];
	const pos = ui.anchoredPosition || [ 0, 0 ];
	const size = ui.sizeDelta || [ 100, 100 ];

	const anchorMinX = parentRect.x + parentRect.w * aMin[ 0 ];
	const anchorMinY = parentRect.y + parentRect.h * aMin[ 1 ];
	const anchorMaxX = parentRect.x + parentRect.w * aMax[ 0 ];
	const anchorMaxY = parentRect.y + parentRect.h * aMax[ 1 ];

	const width = ( anchorMaxX - anchorMinX ) + size[ 0 ];
	const height = ( anchorMaxY - anchorMinY ) + size[ 1 ];

	const pivotX = anchorMinX + ( anchorMaxX - anchorMinX ) * pivot[ 0 ] + pos[ 0 ];
	const pivotY = anchorMinY + ( anchorMaxY - anchorMinY ) * pivot[ 1 ] + pos[ 1 ];

	const x = pivotX - width * pivot[ 0 ];
	const y = pivotY - height * pivot[ 1 ];

	return { x, y, w: Math.max( 0.0001, width ), h: Math.max( 0.0001, height ) };

}

function applyNodeTransform( node, rect, ui = null ) {

	const data = ui || getFccUI( node ) || {};
	node.position.set( rect.x + rect.w * 0.5, rect.y + rect.h * 0.5, node.position.z || 0 );

	// Prefer Group + __fccImageMesh: Euler/localScale on group ONLY.
	// Pixel size MUST live in PlaneGeometry — never in scale. Non-uniform scale
	// anywhere in the rotation chain makes X/Y tilt look stretched by W/H.
	const sizeMesh = node.getObjectByName && node.getObjectByName( FCC_IMAGE_MESH );
	if ( sizeMesh && sizeMesh.isMesh ) {

		applyLocalRotScale( node, data );
		sizeMesh.position.set( 0, 0, 0 );
		sizeMesh.rotation.set( 0, 0, 0 );
		sizeMesh.scale.set( 1, 1, 1 );
		syncImageGeometrySize( sizeMesh, rect.w, rect.h );
		return;

	}

	// Legacy single Mesh: size on geometry, Euler/localScale on the mesh itself.
	syncImageGeometrySize( node, rect.w, rect.h );
	applyLocalRotScale( node, data );

}

function layoutNested( parent, parentRect ) {

	for ( const child of parent.children ) {

		const ui = getFccUI( child );
		if ( ! ui ) continue;

		const rect = computeAnchoredRect( ui, parentRect );
		// Parent Image uses pixel-sized PlaneGeometry + localScale— , so child
		// offsets are in pixels (not fractions of a unit-plane parent).
		const offsetX = ( rect.x + rect.w * 0.5 ) - ( parentRect.x + parentRect.w * 0.5 );
		const offsetY = ( rect.y + rect.h * 0.5 ) - ( parentRect.y + parentRect.h * 0.5 );

		if ( ui.type === 'text' ) {

			applyTextTransformNested( child, rect, parentRect );

		} else {

			// Nested: pixel offsets relative to parent center (not absolute canvas pos).
			const sizeMesh = child.getObjectByName && child.getObjectByName( FCC_IMAGE_MESH );
			applyLocalRotScale( child, ui );
			if ( sizeMesh && sizeMesh.isMesh ) {

				sizeMesh.position.set( 0, 0, 0 );
				sizeMesh.rotation.set( 0, 0, 0 );
				sizeMesh.scale.set( 1, 1, 1 );
				syncImageGeometrySize( sizeMesh, rect.w, rect.h );

			} else {

				syncImageGeometrySize( child, rect.w, rect.h );

			}

			child.position.set( offsetX, offsetY, child.position.z || 0 );

		}

		if ( child.children && child.children.length > 0 && ui.type !== 'text' ) {

			layoutNested( child, rect );

		}

	}

}

function layoutChildren( parent, parentRect ) {

	for ( const child of parent.children ) {

		const ui = getFccUI( child );
		if ( ! ui ) continue;

		const rect = computeAnchoredRect( ui, parentRect );

		if ( ui.type === 'text' ) {

			applyTextTransform( child, rect );

		} else if ( ui.type === 'image' || ui.type === 'canvas' ) {

			applyNodeTransform( child, rect, ui );

		}

		if ( child.children && child.children.length > 0 && ui.type !== 'text' ) {

			layoutNested( child, rect );

		}

	}

}

const _right = new THREE.Vector3();
const _up = new THREE.Vector3();
const _fwd = new THREE.Vector3();
const _center = new THREE.Vector3();
const _bl = new THREE.Vector3();
const _camPos = new THREE.Vector3();

/**
 * Place a canvas (children already in pixel space, origin bottom-left) as a
 * plane filling the camera frustum at planeDistance.
 */
export function placeCanvasInFrontOfCamera( canvas, camera, resW, resH, planeDistance ) {

	if ( ! canvas || ! camera ) return;

	camera.updateMatrixWorld( true );

	const dist = Math.max( 0.01, Number( planeDistance ) || DEFAULT_PLANE_DISTANCE );
	const aspect = ( camera.isPerspectiveCamera && camera.aspect > 0 )
		? camera.aspect
		: ( resW / Math.max( resH, 1 ) );

	let fw;
	let fh;

	if ( camera.isPerspectiveCamera ) {

		const fovRad = THREE.MathUtils.degToRad( camera.fov );
		fh = 2 * dist * Math.tan( fovRad * 0.5 );
		fw = fh * aspect;

	} else if ( camera.isOrthographicCamera ) {

		const zoom = camera.zoom || 1;
		fh = ( camera.top - camera.bottom ) / zoom;
		fw = ( camera.right - camera.left ) / zoom;

	} else {

		fh = Math.max( resH, 1 ) * 0.01;
		fw = fh * aspect;

	}

	_right.set( 1, 0, 0 ).applyQuaternion( camera.quaternion );
	_up.set( 0, 1, 0 ).applyQuaternion( camera.quaternion );
	_fwd.set( 0, 0, - 1 ).applyQuaternion( camera.quaternion );

	camera.getWorldPosition( _camPos );
	_center.copy( _camPos ).addScaledVector( _fwd, dist );

	// Uniform on X, Y AND Z. XY map pixels→world (often ~0.01) while Z=1
	// amplifies any child X/Y tilt by 1/uni (a 0.74° tilt can look like tens of degrees).
	// In-plane Z rotation is unaffected, which is why Z=90° always looked right.
	const sx = fw / Math.max( resW, 1 );
	const sy = fh / Math.max( resH, 1 );
	const uni = Math.min( sx, sy );
	const usedW = resW * uni;
	const usedH = resH * uni;
	const padX = ( fw - usedW ) * 0.5;
	const padY = ( fh - usedH ) * 0.5;

	_bl.copy( _center )
		.addScaledVector( _right, - fw * 0.5 + padX )
		.addScaledVector( _up, - fh * 0.5 + padY );

	canvas.position.copy( _bl );
	canvas.quaternion.copy( camera.quaternion );
	canvas.scale.set( uni, uni, uni );
	canvas.updateMatrixWorld( true );

}

/**
 * @param {THREE.Object3D} scene
 * @param {number} resW
 * @param {number} resH
 * @param {{
 *   forMode?: 'overlay'|'camera'|'all',
 *   resolveCamera?: (uuid: string|null) => THREE.Camera|null,
 * }} [options]
 */
export function layoutAllCanvases( scene, resW, resH, options = {} ) {

	const forMode = options.forMode || 'all';
	const resolveCamera = options.resolveCamera || null;
	const screenRect = { x: 0, y: 0, w: resW, h: resH };

	scene.traverse( function ( obj ) {

		if ( ! isUICanvas( obj ) ) return;

		let p = obj.parent;
		let underCanvas = false;
		while ( p ) {

			if ( isUICanvas( p ) ) {

				underCanvas = true;
				break;

			}

			p = p.parent;

		}

		if ( underCanvas ) return;

		const ui = getFccUI( obj );
		if ( ! ui ) return;

		const mode = getCanvasRenderMode( obj );
		if ( forMode !== 'all' && mode !== forMode ) return;

		const canvasRect = computeAnchoredRect( ui, screenRect );

		// Layout children in pixel space with canvas identity first.
		obj.position.set( 0, 0, 0 );
		obj.scale.set( 1, 1, 1 );
		obj.rotation.set( 0, 0, 0 );
		obj.quaternion.identity();

		ui._resolved = { w: canvasRect.w, h: canvasRect.h };

		layoutChildren( obj, canvasRect );

		if ( mode === RENDER_MODE_CAMERA ) {

			const cam = resolveCamera
				? resolveCamera( ui.cameraUuid || null )
				: null;
			if ( cam ) {

				placeCanvasInFrontOfCamera(
					obj,
					cam,
					resW,
					resH,
					ui.planeDistance ?? DEFAULT_PLANE_DISTANCE,
				);

			}

		}

	} );

}

/**
 * Ensure UI layer + render flags on an object (and optional traverse).
 */
export function applyUIObjectFlags( object, traverseChildren = true ) {

	function markMeshFlags( mesh, mode ) {

		if ( ! mesh || ! mesh.isMesh || ! mesh.material ) return;
		mesh.layers.set( mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER );
		mesh.frustumCulled = false;
		const mats = Array.isArray( mesh.material ) ? mesh.material : [ mesh.material ];
		for ( const m of mats ) {

			if ( ! m ) continue;
			// Camera mode sits in the beauty pass at planeDistance — depth test on.
			// Overlay is drawn after PP with clearDepth — no depth test.
			m.depthTest = mode === RENDER_MODE_CAMERA;
			m.depthWrite = false;
			m.toneMapped = false;

		}

	}

	function mark( o ) {

		if ( ! getFccUI( o ) ) return;

		const own = getFccUI( o );
		const mode = ( own && own.type === 'canvas' )
			? ( own.renderMode === RENDER_MODE_CAMERA ? RENDER_MODE_CAMERA : RENDER_MODE_OVERLAY )
			: getOwningCanvasRenderMode( o );

		o.layers.set( mode === RENDER_MODE_CAMERA ? UI_CAMERA_LAYER : UI_LAYER );
		o.frustumCulled = false;

		if ( o.isMesh ) {

			markMeshFlags( o, mode );

		} else if ( own && own.type === 'image' ) {

			// Image Group: flags live on the child size mesh.
			const sizeMesh = o.getObjectByName && o.getObjectByName( FCC_IMAGE_MESH );
			markMeshFlags( sizeMesh, mode );

		} else if ( own && own.type === 'text' ) {

			// Troika / flower meshes are not fccUI nodes; stamp the same layer
			// mask as the text group so Camera-mode UI_CAMERA_LAYER capture sees them.
			const mask = o.layers.mask;
			for ( let i = 0; i < o.children.length; i ++ ) {

				const c = o.children[ i ];
				if ( ! c ) continue;
				c.layers.mask = mask;
				c.traverse( ( n ) => {

					n.layers.mask = mask;

				} );

			}

		}

	}

	if ( traverseChildren ) {

		object.traverse( mark );

	} else {

		mark( object );

	}

}

/**
 * Re-apply flags for an entire canvas subtree (after renderMode change).
 */
export function rebindCanvasSubtree( canvas ) {

	if ( ! canvas ) return;
	canvas.traverse( function ( o ) {

		if ( getFccUI( o ) ) applyUIObjectFlags( o, false );

	} );

}
