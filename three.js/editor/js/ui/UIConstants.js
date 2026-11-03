/**
 * FreeFilmCut UGUI-like UI — shared constants.
 * Layer 1: Screen Space Overlay (ortho after PP).
 * Layer 2: Screen Space Camera (beauty camera / before PP).
 */
export const UI_LAYER = 1;
export const UI_CAMERA_LAYER = 2;

export const FCC_UI_KEY = 'fccUI';

/** Child mesh name under Image Group — pixel size lives here, Euler on the Group. */
export const FCC_IMAGE_MESH = '__fccImageMesh';

/** @typedef {'overlay'|'camera'} FccUIRenderMode */

export const RENDER_MODE_OVERLAY = 'overlay';
export const RENDER_MODE_CAMERA = 'camera';

export const DEFAULT_PLANE_DISTANCE = 100;

/**
 * Default SDF font: Microsoft YaHei (local editor/fonts/msyh.ttf).
 * Offline: replace with a local TTF/OTF/WOFF under editor/fonts/ or pack fonts/.
 * Troika does not support WOFF2.
 */
export const DEFAULT_TEXT_FONT_URL =
	// Local Microsoft YaHei (from Windows Fonts msyh.ttc face 0). Compare CJK seams vs Noto.
	// Noto CDN fallback:
	// 'https://cdn.jsdelivr.net/fontsource/fonts/noto-sans-sc@5.2.5/chinese-simplified-400-normal.woff'
	'./fonts/msyh.ttf';

export function isFccUI( object ) {

	return !!( object && object.userData && object.userData[ FCC_UI_KEY ] );

}

export function getFccUI( object ) {

	return isFccUI( object ) ? object.userData[ FCC_UI_KEY ] : null;

}

export function isUICanvas( object ) {

	const ui = getFccUI( object );
	return !!( ui && ui.type === 'canvas' );

}

export function isUIImage( object ) {

	const ui = getFccUI( object );
	return !!( ui && ui.type === 'image' );

}

/**
 * Child plane that holds Image geometry + material (Group is transform-only).
 * @param {THREE.Object3D|null} object
 * @returns {THREE.Mesh|null}
 */
export function getUIImageMesh( object ) {

	if ( ! object ) return null;
	// Legacy: Image was a Mesh with fccUI on itself.
	if ( isUIImage( object ) && object.isMesh && object.material ) return object;
	if ( ! isUIImage( object ) ) return null;
	const mesh = object.getObjectByName && object.getObjectByName( FCC_IMAGE_MESH );
	return ( mesh && mesh.isMesh ) ? mesh : null;

}

/**
 * Object that owns .material / .geometry for sidebar Material + Geometry tabs.
 * UI Image Group → __fccImageMesh; otherwise the object itself.
 * @param {THREE.Object3D|null} object
 * @returns {THREE.Object3D|null}
 */
export function resolveSidebarMeshObject( object ) {

	if ( ! object ) return null;
	if ( object.material !== undefined || object.geometry !== undefined ) return object;
	const imgMesh = getUIImageMesh( object );
	return imgMesh || object;

}

export function isUIText( object ) {

	const ui = getFccUI( object );
	return !!( ui && ui.type === 'text' );

}

/**
 * Walk up to owning Canvas and return its renderMode (default overlay).
 */
export function getOwningCanvasRenderMode( object ) {

	let p = object;
	while ( p ) {

		if ( isUICanvas( p ) ) {

			const ui = getFccUI( p );
			return ( ui && ui.renderMode === RENDER_MODE_CAMERA )
				? RENDER_MODE_CAMERA
				: RENDER_MODE_OVERLAY;

		}

		p = p.parent;

	}

	return RENDER_MODE_OVERLAY;

}

export function getCanvasRenderMode( canvas ) {

	const ui = getFccUI( canvas );
	if ( ! ui || ui.type !== 'canvas' ) return RENDER_MODE_OVERLAY;
	return ui.renderMode === RENDER_MODE_CAMERA
		? RENDER_MODE_CAMERA
		: RENDER_MODE_OVERLAY;

}

export function defaultRectData( overrides = {} ) {

	return {
		anchorMin: [ 0.5, 0.5 ],
		anchorMax: [ 0.5, 0.5 ],
		pivot: [ 0.5, 0.5 ],
		anchoredPosition: [ 0, 0 ],
		sizeDelta: [ 200, 200 ],
		/** Unity-style local Euler degrees (X/Y/Z). */
		localEulerAngles: [ 0, 0, 0 ],
		/** Unity-style local scale (X/Y/Z). */
		localScale: [ 1, 1, 1 ],
		...overrides,
	};

}

/** @returns {[number, number, number]} degrees */
export function readLocalEulerDegrees( ui ) {

	const e = ui && ui.localEulerAngles;
	if ( Array.isArray( e ) && e.length >= 3 ) {

		return [ Number( e[ 0 ] ) || 0, Number( e[ 1 ] ) || 0, Number( e[ 2 ] ) || 0 ];

	}

	return [ 0, 0, 0 ];

}

/** @returns {[number, number, number]} */
export function readLocalScale( ui ) {

	const s = ui && ui.localScale;
	if ( Array.isArray( s ) && s.length >= 3 ) {

		const x = Number( s[ 0 ] );
		const y = Number( s[ 1 ] );
		const z = Number( s[ 2 ] );
		return [
			Number.isFinite( x ) && x !== 0 ? x : 1,
			Number.isFinite( y ) && y !== 0 ? y : 1,
			Number.isFinite( z ) && z !== 0 ? z : 1,
		];

	}

	return [ 1, 1, 1 ];

}

/** Stretch-to-fill parent (Unity stretch anchors). */
export function stretchFillRectData() {

	return defaultRectData( {
		anchorMin: [ 0, 0 ],
		anchorMax: [ 1, 1 ],
		pivot: [ 0.5, 0.5 ],
		anchoredPosition: [ 0, 0 ],
		sizeDelta: [ 0, 0 ],
	} );

}

/** Serializable defaults for UGUI Text (Troika SDF). */
export function defaultTextData( overrides = {} ) {

	return {
		type: 'text',
		text: '文本',
		font: '',
		fontBold: '',
		fontSize: 48,
		bold: false,
		italic: false,
		fontStyle: 'normal',
		color: '#ffffff',
		letterSpacing: 0,
		lineHeight: 1.2,
		align: 'center',
		verticalAlign: 'middle',
		outline: {
			enabled: false,
			width: 2,
			color: '#000000',
			opacity: 1,
		},
		shadow: {
			enabled: false,
			offsetX: 2,
			offsetY: -2,
			blur: 4,
			color: '#000000',
			opacity: 0.75,
		},
		/** @type {object|null} FlowerStyle Effect stack on this Text; null = synthesize from legacy outline/shadow */
		flowerStyle: null,
		...defaultRectData( {
			sizeDelta: [ 400, 100 ],
			anchoredPosition: [ 0, 0 ],
		} ),
		...overrides,
	};

}
