/**
 * Create Canvas / Image / Text objects for FreeFilmCut UGUI MVP.
 */

import * as THREE from 'three';

import {
	FCC_UI_KEY,
	FCC_IMAGE_MESH,
	UI_LAYER,
	RENDER_MODE_OVERLAY,
	DEFAULT_PLANE_DISTANCE,
	defaultRectData,
	defaultTextData,
	stretchFillRectData,
	isUICanvas,
	isUIText,
} from './UIConstants.js?v=fcc-ui-108';
import { applyUIObjectFlags } from './UIRectLayout.js?v=fcc-ui-150';
import { syncUITextContent } from './UIText.js?v=fcc-ui-234';

function createDefaultUIMaterial() {

	const mat = new THREE.MeshBasicMaterial( {
		color: 0x4fc3f7,
		transparent: true,
		opacity: 1,
		depthTest: false,
		depthWrite: false,
		side: THREE.DoubleSide,
		toneMapped: false,
	} );
	mat.name = 'UIImage';
	return mat;

}

/**
 * Screen Space Canvas (Group). Default: Overlay.
 */
export function createUICanvas( name = 'Canvas' ) {

	const group = new THREE.Group();
	group.name = name;
	group.userData[ FCC_UI_KEY ] = {
		type: 'canvas',
		renderMode: RENDER_MODE_OVERLAY,
		cameraUuid: null,
		planeDistance: DEFAULT_PLANE_DISTANCE,
		...stretchFillRectData(),
	};
	group.layers.set( UI_LAYER );
	group.frustumCulled = false;
	applyUIObjectFlags( group, false );
	return group;

}

/**
 * UI Image: Group holds fccUI + rotation/localScale; child mesh is unit-scaled
 * with PlaneGeometry(w,h). Size must never enter scale — that skews X/Y tilt.
 */
export function createUIImage( name = 'Image' ) {

	const group = new THREE.Group();
	group.name = name;
	group.userData[ FCC_UI_KEY ] = {
		type: 'image',
		...defaultRectData( {
			anchorMin: [ 0.5, 0.5 ],
			anchorMax: [ 0.5, 0.5 ],
			sizeDelta: [ 200, 200 ],
			anchoredPosition: [ 0, 0 ],
		} ),
	};
	group.layers.set( UI_LAYER );
	group.frustumCulled = false;

	const geometry = new THREE.PlaneGeometry( 1, 1 );
	const material = createDefaultUIMaterial();
	const mesh = new THREE.Mesh( geometry, material );
	mesh.name = FCC_IMAGE_MESH;
	mesh.layers.set( UI_LAYER );
	mesh.frustumCulled = false;
	mesh.castShadow = false;
	mesh.receiveShadow = false;
	group.add( mesh );

	applyUIObjectFlags( group, false );
	return group;

}

/**
 * UI Text (Group + Troika SDF children). Size box from RectTransform;
 * glyph size from fccUI.fontSize (not non-uniform scale).
 */
export function createUIText( name = 'Text' ) {

	const group = new THREE.Group();
	group.name = name;
	group.userData[ FCC_UI_KEY ] = defaultTextData();
	group.layers.set( UI_LAYER );
	group.frustumCulled = false;
	applyUIObjectFlags( group, false );
	try {

		syncUITextContent( group, {
			x: 0,
			y: 0,
			w: group.userData[ FCC_UI_KEY ].sizeDelta[ 0 ],
			h: group.userData[ FCC_UI_KEY ].sizeDelta[ 1 ],
		} );

	} catch ( e ) {

		console.warn( '[FreeFilmCut] createUIText Troika sync failed', e );

	}

	return group;

}

/**
 * Find a suitable Canvas parent for a new Image/Text.
 * Prefer selected object if it is / is under a Canvas; else first Canvas in scene.
 */
export function findCanvasParent( editor ) {

	const selected = editor.selected;
	if ( selected ) {

		if ( isUICanvas( selected ) ) return selected;
		let p = selected.parent;
		while ( p ) {

			if ( isUICanvas( p ) ) return p;
			p = p.parent;

		}

	}

	let found = null;
	editor.scene.traverse( function ( o ) {

		if ( ! found && isUICanvas( o ) ) found = o;

	} );
	return found;

}

/**
 * After ObjectLoader restore, re-apply layer / material flags and rebuild Troika text.
 */
export function rebindAllUI( scene ) {

	if ( ! scene ) return;
	scene.traverse( function ( o ) {

		if ( o.userData && o.userData[ FCC_UI_KEY ] ) {

			applyUIObjectFlags( o, false );
			if ( isUIText( o ) ) {

				try {

					// Always rebuild Troika after ObjectLoader (children lack .sync; fonts may be stale blob:).
					const ui = o.userData[ FCC_UI_KEY ];
					if ( o.userData ) delete o.userData.__fccTextSig;
					const w = ( ui.sizeDelta && ui.sizeDelta[ 0 ] ) || 400;
					const h = ( ui.sizeDelta && ui.sizeDelta[ 1 ] ) || 100;
					syncUITextContent( o, { x: 0, y: 0, w, h } );

				} catch ( e ) {

					console.warn( '[FreeFilmCut] rebind text', e );

				}

			}

		}

	} );

}
