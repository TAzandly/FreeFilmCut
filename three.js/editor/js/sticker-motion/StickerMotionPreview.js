/**
 * Draws the open sticker scene on a checkerboard, then applies one sticker-motion pose.
 * The scene render target stays free of the checkerboard.
 */

import * as THREE from 'three';

let target = null;
const checkerMat = new THREE.ShaderMaterial( {
	uniforms: { uRepeat: { value: 16 } },
	vertexShader: 'varying vec2 vUv; void main() { vUv = uv; gl_Position = vec4( position.xy, 0.0, 1.0 ); }',
	fragmentShader: `
		varying vec2 vUv;
		uniform float uRepeat;
		void main() {
			float cx = floor( vUv.x * uRepeat );
			float cy = floor( vUv.y * uRepeat );
			float on = mod( cx + cy, 2.0 );
			gl_FragColor = mix( vec4( 0.16, 0.16, 0.16, 1.0 ), vec4( 0.28, 0.28, 0.28, 1.0 ), on );
		}
	`,
	depthTest: false,
	depthWrite: false,
} );
const blitMat = new THREE.ShaderMaterial( {
	uniforms: {
		tDiffuse: { value: null },
		uOpacity: { value: 1 },
		uScale: { value: 1 },
		uRotate: { value: 0 },
		uOffset: { value: new THREE.Vector2() },
	},
	vertexShader: `
		uniform float uScale;
		uniform float uRotate;
		uniform vec2 uOffset;
		varying vec2 vUv;
		void main() {
			vUv = uv;
			vec2 p = position.xy * uScale;
			float c = cos( uRotate );
			float s = sin( uRotate );
			p = vec2( c * p.x - s * p.y, s * p.x + c * p.y );
			p += uOffset;
			gl_Position = vec4( p, 0.0, 1.0 );
		}
	`,
	fragmentShader: `
		uniform sampler2D tDiffuse;
		uniform float uOpacity;
		varying vec2 vUv;
		void main() {
			gl_FragColor = linearToOutputTexel( texture2D( tDiffuse, vUv ) ) * uOpacity;
		}
	`,
	depthTest: false,
	depthWrite: false,
	transparent: true,
} );
const quadGeo = new THREE.PlaneGeometry( 2, 2 );
const checkerMesh = new THREE.Mesh( quadGeo, checkerMat );
const blitMesh = new THREE.Mesh( quadGeo, blitMat );
const previewScene = new THREE.Scene();
const previewCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

function ensureTarget( w, h ) {

	if ( target && target.width === w && target.height === h ) return target;
	if ( target ) target.dispose();
	target = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.HalfFloatType,
		depthBuffer: true,
	} );
	target.texture.colorSpace = THREE.NoColorSpace;
	target.texture.name = 'StickerMotion.preview';
	return target;

}

/**
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.Scene} args.scene
 * @param {THREE.Camera} args.camera
 * @param {{x:number,y:number,w:number,h:number}} args.rect CSS pixels, GL y-up
 * @param {{opacity:number,scale:number,rotate:number,positionX:number,positionY:number}} args.pose
 * @param {{render?: function}|null} args.overlay
 * @param {{width:number,height:number}} args.projectRes
 */
function renderStickerMotionPreview( args ) {

	const renderer = args.renderer;
	const scene = args.scene;
	const camera = args.camera;
	const rect = args.rect;
	const pose = args.pose;
	const pr = renderer.getPixelRatio ? renderer.getPixelRatio() : 1;
	const tw = Math.max( 1, Math.round( rect.w * pr ) );
	const th = Math.max( 1, Math.round( rect.h * pr ) );
	const rt = ensureTarget( tw, th );

	const prevBackground = scene.background;
	const prevAutoClear = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	scene.background = null;
	renderer.setRenderTarget( rt );
	renderer.setViewport( 0, 0, tw, th );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.autoClear = true;
	renderer.clear( true, true, true );
	renderer.render( scene, camera );
	if ( args.overlay && args.overlay.render ) {

		args.overlay.render( renderer, { x: 0, y: 0, w: tw, h: th }, args.projectRes.width, args.projectRes.height );

	}
	scene.background = prevBackground;
	renderer.autoClear = prevAutoClear;
	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( null );

	renderer.setViewport( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissor( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissorTest( true );

	const repeats = Math.max( 2, Math.round( rect.w / 16 ) );
	checkerMat.uniforms.uRepeat.value = repeats;
	previewScene.clear();
	previewScene.add( checkerMesh );
	renderer.render( previewScene, previewCam );

	const scale = Number.isFinite( pose.scale ) ? pose.scale : 1;
	const rot = ( Number( pose.rotate ) || 0 ) * Math.PI / 180;
	blitMat.uniforms.tDiffuse.value = rt.texture;
	blitMat.uniforms.uOpacity.value = Number.isFinite( pose.opacity ) ? pose.opacity : 1;
	blitMat.uniforms.uScale.value = scale;
	blitMat.uniforms.uRotate.value = rot;
	// Offset is a fraction of the preview frame, in NDC (2 = full width).
	blitMat.uniforms.uOffset.value.set(
		( Number( pose.positionX ) || 0 ) * 2,
		( Number( pose.positionY ) || 0 ) * 2,
	);
	blitMat.transparent = true;
	previewScene.clear();
	previewScene.add( blitMesh );
	renderer.autoClear = false;
	renderer.render( previewScene, previewCam );
	renderer.autoClear = prevAutoClear;
	blitMat.uniforms.tDiffuse.value = null;
	previewScene.clear();

}

export { renderStickerMotionPreview };
