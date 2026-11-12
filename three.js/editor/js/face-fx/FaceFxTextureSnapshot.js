/**
 * Snapshot a THREE.Texture to ImageBitmap/canvas for MediaPipe (editor Face FX).
 * Mirrors freefilmcut face-fx-analysis.snapshotTextureForFaceFx.
 */

import * as THREE from 'three';

const MAX_EDGE = 960;

const BELOW_INPUT_NAMES = [ 'uInput', 'belowInput', 'iChannel0' ];

function isCpuImageSource( image ) {

	if ( ! image ) return false;
	if ( typeof HTMLImageElement !== 'undefined' && image instanceof HTMLImageElement ) return true;
	if ( typeof HTMLCanvasElement !== 'undefined' && image instanceof HTMLCanvasElement ) return true;
	if ( typeof HTMLVideoElement !== 'undefined' && image instanceof HTMLVideoElement ) return true;
	if ( typeof ImageBitmap !== 'undefined' && image instanceof ImageBitmap ) return true;
	if ( typeof OffscreenCanvas !== 'undefined' && image instanceof OffscreenCanvas ) return true;
	return false;

}

function texturePixelSize( texture ) {

	const img = texture && texture.image;
	if ( img ) {

		const w = img.videoWidth || img.naturalWidth || img.width || 0;
		const h = img.videoHeight || img.naturalHeight || img.height || 0;
		if ( w > 0 && h > 0 ) return { width: w, height: h };

	}
	if ( texture && texture.isFramebufferTexture && texture.image ) {

		const w = texture.image.width || 0;
		const h = texture.image.height || 0;
		if ( w > 0 && h > 0 ) return { width: w, height: h };

	}
	return { width: 0, height: 0 };

}

/**
 * Prefer direct CPU image on the texture; otherwise blit+readPixels.
 * @returns {Promise<ImageBitmap|HTMLCanvasElement|HTMLImageElement|HTMLVideoElement|null>}
 */
async function snapshotTextureForDetect( renderer, texture, opts = {} ) {

	if ( ! texture ) return null;
	const maxEdge = opts.maxEdge || MAX_EDGE;

	if ( isCpuImageSource( texture.image ) ) return texture.image;

	if ( ! renderer || typeof renderer.readRenderTargetPixels !== 'function' ) return null;

	const size = texturePixelSize( texture );
	let width = size.width;
	let height = size.height;
	if ( ! ( width > 0 && height > 0 ) ) {

		// Last resort: assume project resolution or 1080p
		width = opts.width || 1080;
		height = opts.height || 1920;

	}

	const scale = Math.min( 1, maxEdge / Math.max( width, height ) );
	const w = Math.max( 1, Math.round( width * scale ) );
	const h = Math.max( 1, Math.round( height * scale ) );

	const rt = new THREE.WebGLRenderTarget( w, h, {
		format: THREE.RGBAFormat,
		type: THREE.UnsignedByteType,
		depthBuffer: false,
		stencilBuffer: false
	} );

	const prev = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	const prevTone = renderer.toneMapping;
	const scene = new THREE.Scene();
	const cam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
	const mat = new THREE.MeshBasicMaterial( {
		map: texture,
		depthTest: false,
		depthWrite: false,
		toneMapped: false
	} );
	const mesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), mat );
	mesh.frustumCulled = false;
	scene.add( mesh );

	try {

		renderer.toneMapping = THREE.NoToneMapping;
		renderer.autoClear = true;
		renderer.setRenderTarget( rt );
		renderer.clear();
		renderer.render( scene, cam );

		const pixels = new Uint8Array( w * h * 4 );
		renderer.readRenderTargetPixels( rt, 0, 0, w, h, pixels );
		const flipped = new Uint8ClampedArray( w * h * 4 );
		const row = w * 4;
		for ( let y = 0; y < h; y ++ ) {

			const src = ( h - 1 - y ) * row;
			flipped.set( pixels.subarray( src, src + row ), y * row );

		}
		const imageData = new ImageData( flipped, w, h );
		if ( typeof createImageBitmap === 'function' ) {

			return await createImageBitmap( imageData );

		}
		const canvas = document.createElement( 'canvas' );
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext( '2d' );
		if ( ! ctx ) return null;
		ctx.putImageData( imageData, 0, 0 );
		return canvas;

	} catch ( e ) {

		console.warn( '[FaceFx] snapshotTextureForDetect failed', e );
		return null;

	} finally {

		mat.dispose();
		mesh.geometry.dispose();
		rt.dispose();
		renderer.setRenderTarget( prev );
		renderer.autoClear = prevAuto;
		renderer.toneMapping = prevTone;

	}

}

/**
 * Find first mesh whose material samples below-input (uInput / belowInput / iChannel0).
 * @returns {{ mesh: THREE.Mesh, texture: THREE.Texture, uniformName: string }|null}
 */
function findBelowInputMesh( scene ) {

	let found = null;
	if ( ! scene ) return null;
	scene.traverse( ( object ) => {

		if ( found || ! object.isMesh || ! object.material ) return;
		const mats = Array.isArray( object.material ) ? object.material : [ object.material ];
		for ( const mat of mats ) {

			if ( ! mat || ! mat.uniforms ) continue;
			for ( const name of BELOW_INPUT_NAMES ) {

				const u = mat.uniforms[ name ];
				const tex = u && u.value;
				if ( tex && tex.isTexture ) {

					found = { mesh: object, texture: tex, uniformName: name, material: mat };
					return;

				}

			}

		}

	} );
	return found;

}

export {
	BELOW_INPUT_NAMES,
	isCpuImageSource,
	texturePixelSize,
	snapshotTextureForDetect,
	findBelowInputMesh
};
