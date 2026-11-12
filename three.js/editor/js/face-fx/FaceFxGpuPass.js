/**
 * Face FX GPU pass for editor preview (warp / eyeRay / procedural ears).
 */

import * as THREE from 'three';
import {
	packEarAnchors,
	packEyeRays,
	packWarpFaces
} from './FaceFxLandmarks.js?v=fcc-ui-240';

const MAX_FACES = 4;

const VERT = /* glsl */ `
varying vec2 vUv;
void main() {
	vUv = uv;
	gl_Position = vec4(position.xy, 0.0, 1.0);
}
`;

const WARP_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform int uFaceCount;
uniform int uPreset;
uniform float uTime;
uniform vec4 uFaces[4];
varying vec2 vUv;
float falloff(float dist, float radius) {
	if (radius <= 1e-6) return 0.0;
	float t = clamp(dist / radius, 0.0, 1.0);
	float s = 1.0 - t;
	return s * s * (3.0 - 2.0 * s);
}
vec2 warpOne(vec2 uv, vec4 face) {
	vec2 c = face.xy;
	float radius = face.z;
	float strength = clamp(face.w, 0.0, 2.0);
	if (strength <= 1e-6) return uv;
	vec2 d = uv - c;
	float dist = length(d);
	float w = falloff(dist, radius);
	if (w <= 1e-6) return uv;
	float amp = strength * w;
	if (uPreset == 1) {
		float scale = max(0.15, 1.0 - amp * 0.35);
		return c + d / scale;
	}
	if (uPreset == 2) {
		float scaleY = max(0.2, 1.0 - amp * 0.4);
		return vec2(uv.x, c.y + d.y / scaleY);
	}
	if (uPreset == 3) {
		float phase = dist * 18.0 - uTime * 6.0;
		float ripple = sin(phase) * amp * 0.04;
		float ang = atan(d.y, d.x);
		return uv + vec2(cos(ang), sin(ang)) * ripple;
	}
	float push = 1.0 + amp * 0.45;
	return c + d / push;
}
void main() {
	vec2 uv = vUv;
	for (int i = 0; i < 4; i++) {
		if (i >= uFaceCount) break;
		uv = warpOne(uv, uFaces[i]);
	}
	gl_FragColor = texture2D(tInput, clamp(uv, 0.0, 1.0));
}
`;

const RAY_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform int uRayCount;
uniform vec4 uRays[8];
uniform vec3 uColor;
uniform float uLength;
uniform float uWidth;
varying vec2 vUv;
float beam(vec2 p, vec2 o, vec2 dir, float len, float width) {
	vec2 d = normalize(dir);
	vec2 v = p - o;
	float along = dot(v, d);
	if (along < 0.0 || along > len) return 0.0;
	float across = length(v - d * along);
	float core = 1.0 - smoothstep(0.0, width, across);
	float tip = 1.0 - smoothstep(len * 0.7, len, along);
	return core * tip;
}
void main() {
	vec4 base = texture2D(tInput, vUv);
	float glow = 0.0;
	for (int i = 0; i < 8; i++) {
		if (i >= uRayCount) break;
		vec4 r = uRays[i];
		glow += beam(vUv, r.xy, r.zw, uLength, uWidth);
	}
	glow = clamp(glow, 0.0, 1.0);
	gl_FragColor = vec4(base.rgb + uColor * glow, base.a);
}
`;

const EARS_FRAG = /* glsl */ `
precision highp float;
uniform sampler2D tInput;
uniform int uEarCount;
uniform vec4 uEars[4];
uniform vec3 uEarColor;
varying vec2 vUv;
float earMask(vec2 uv, vec2 tip, vec2 base, float halfW) {
	vec2 axis = tip - base;
	float len = length(axis);
	if (len < 1e-5) return 0.0;
	vec2 n = axis / len;
	vec2 t = vec2(-n.y, n.x);
	vec2 v = uv - base;
	float along = dot(v, n);
	float across = abs(dot(v, t));
	if (along < 0.0 || along > len) return 0.0;
	float taper = mix(halfW, halfW * 0.15, along / len);
	float edge = 1.0 - smoothstep(taper * 0.7, taper, across);
	float tipFade = 1.0 - smoothstep(len * 0.85, len, along);
	return edge * tipFade;
}
void main() {
	vec4 base = texture2D(tInput, vUv);
	float m = 0.0;
	for (int i = 0; i < 4; i++) {
		if (i >= uEarCount) break;
		vec4 e = uEars[i];
		vec2 forehead = e.xy;
		float fw = e.z;
		float fh = e.w;
		vec2 leftBase = forehead + vec2(-fw * 0.22, -fh * 0.02);
		vec2 rightBase = forehead + vec2(fw * 0.22, -fh * 0.02);
		vec2 leftTip = leftBase + vec2(-fw * 0.12, -fh * 0.55);
		vec2 rightTip = rightBase + vec2(fw * 0.12, -fh * 0.55);
		float halfW = fw * 0.14;
		m = max(m, earMask(vUv, leftTip, leftBase, halfW));
		m = max(m, earMask(vUv, rightTip, rightBase, halfW));
	}
	gl_FragColor = vec4(mix(base.rgb, uEarColor, clamp(m, 0.0, 1.0)), base.a);
}
`;

function presetId( preset ) {

	if ( preset === 'pinch' ) return 1;
	if ( preset === 'stretchY' ) return 2;
	if ( preset === 'wave' ) return 3;
	return 0;

}

function makeMaterial( frag, uniforms ) {

	return new THREE.ShaderMaterial( {
		uniforms,
		vertexShader: VERT,
		fragmentShader: frag,
		depthTest: false,
		depthWrite: false,
		blending: THREE.NoBlending,
		transparent: false,
		toneMapped: false
	} );

}

function FaceFxGpuPass() {

	this.scene = new THREE.Scene();
	this.camera = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
	this.mesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ) );
	this.mesh.frustumCulled = false;
	this.scene.add( this.mesh );
	this.warpMat = null;
	this.rayMat = null;
	this.earsMat = null;
	this.rtA = null;
	this.rtB = null;
	this._size = { w: 0, h: 0 };

}

FaceFxGpuPass.prototype._ensureRTs = function ( w, h ) {

	if ( this.rtA && this._size.w === w && this._size.h === h ) return;
	if ( this.rtA ) this.rtA.dispose();
	if ( this.rtB ) this.rtB.dispose();
	const opts = {
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		format: THREE.RGBAFormat,
		type: THREE.HalfFloatType,
		depthBuffer: false,
		stencilBuffer: false,
		generateMipmaps: false
	};
	this.rtA = new THREE.WebGLRenderTarget( w, h, opts );
	this.rtB = new THREE.WebGLRenderTarget( w, h, opts );
	this.rtA.texture.flipY = false;
	this.rtB.texture.flipY = false;
	this._size = { w, h };

};

FaceFxGpuPass.prototype.apply = function ( {
	renderer,
	inputTexture,
	width,
	height,
	faces,
	config,
	timeSec = 0,
	skipProceduralEars = false
} ) {

	if ( ! renderer || ! inputTexture || ! faces || ! faces.length ) return null;
	const layers = ( config && config.layers ) || [];
	const warps = layers.filter( ( l ) => l.kind === 'warp2d' );
	const rays = layers.filter( ( l ) => l.kind === 'eyeRay' );
	const anchors = layers.filter( ( l ) => l.kind === 'anchor3d' );
	const needEars = ! skipProceduralEars && anchors.some( ( a ) => ! a.asset );
	if ( ! warps.length && ! rays.length && ! needEars ) return null;

	const w = Math.max( 1, width | 0 );
	const h = Math.max( 1, height | 0 );
	this._ensureRTs( w, h );

	const prevTarget = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	renderer.autoClear = false;

	let src = inputTexture;
	let dst = this.rtA;
	const run = ( mat ) => {

		mat.uniforms.tInput.value = src;
		mat.uniformsNeedUpdate = true;
		this.mesh.material = mat;
		renderer.setRenderTarget( dst );
		renderer.setViewport( 0, 0, w, h );
		renderer.render( this.scene, this.camera );
		src = dst.texture;
		dst = dst === this.rtA ? this.rtB : this.rtA;

	};

	const maxFaces = Math.min( MAX_FACES, Math.max( 1, ( config.driver && config.driver.maxFaces ) || 4 ) );

	try {

		for ( const layer of warps ) {

			const packed = packWarpFaces( faces, layer.strength, maxFaces );
			if ( ! packed.count ) continue;
			if ( ! this.warpMat ) {

				this.warpMat = makeMaterial( WARP_FRAG, {
					tInput: { value: null },
					uFaceCount: { value: 0 },
					uPreset: { value: 0 },
					uTime: { value: 0 },
					uFaces: { value: new Float32Array( MAX_FACES * 4 ) }
				} );

			}
			this.warpMat.uniforms.uFaceCount.value = packed.count;
			this.warpMat.uniforms.uPreset.value = presetId( layer.preset );
			this.warpMat.uniforms.uTime.value = timeSec;
			this.warpMat.uniforms.uFaces.value = packed.data;
			run( this.warpMat );

		}

		for ( const layer of rays ) {

			const packed = packEyeRays( faces, maxFaces );
			if ( ! packed.count ) continue;
			if ( ! this.rayMat ) {

				this.rayMat = makeMaterial( RAY_FRAG, {
					tInput: { value: null },
					uRayCount: { value: 0 },
					uRays: { value: new Float32Array( 8 * 4 ) },
					uColor: { value: new THREE.Color( '#ff0033' ) },
					uLength: { value: 0.35 },
					uWidth: { value: 0.012 }
				} );

			}
			this.rayMat.uniforms.uRayCount.value = packed.count;
			this.rayMat.uniforms.uRays.value = packed.data;
			this.rayMat.uniforms.uColor.value.set( layer.color || '#ff0033' );
			this.rayMat.uniforms.uLength.value = Math.max( 0.01, ( layer.length || 2 ) * 0.15 );
			this.rayMat.uniforms.uWidth.value = Math.max( 0.001, ( layer.width || 0.01 ) * 2.5 );
			run( this.rayMat );

		}

		if ( needEars ) {

			const packed = packEarAnchors( faces, maxFaces );
			if ( packed.count ) {

				if ( ! this.earsMat ) {

					this.earsMat = makeMaterial( EARS_FRAG, {
						tInput: { value: null },
						uEarCount: { value: 0 },
						uEars: { value: new Float32Array( MAX_FACES * 4 ) },
						uEarColor: { value: new THREE.Color( '#f2a6c8' ) }
					} );

				}
				this.earsMat.uniforms.uEarCount.value = packed.count;
				this.earsMat.uniforms.uEars.value = packed.data;
				run( this.earsMat );

			}

		}

	} finally {

		renderer.setRenderTarget( prevTarget );
		renderer.autoClear = prevAuto;
		if ( this.warpMat ) this.warpMat.uniforms.tInput.value = null;
		if ( this.rayMat ) this.rayMat.uniforms.tInput.value = null;
		if ( this.earsMat ) this.earsMat.uniforms.tInput.value = null;

	}

	return src;

};

FaceFxGpuPass.prototype.dispose = function () {

	if ( this.rtA ) this.rtA.dispose();
	if ( this.rtB ) this.rtB.dispose();
	this.rtA = this.rtB = null;
	if ( this.warpMat ) this.warpMat.dispose();
	if ( this.rayMat ) this.rayMat.dispose();
	if ( this.earsMat ) this.earsMat.dispose();
	this.warpMat = this.rayMat = this.earsMat = null;
	this.mesh.geometry.dispose();

};

export { FaceFxGpuPass };
