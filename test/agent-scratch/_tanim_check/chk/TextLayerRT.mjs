/**
 * Editor Text layer → WebGLRenderTarget → shared Registry Fx → blit.
 * Aligns with OpenCut vfxpack/text-layer-rt (same registry types as camera PP).
 *
 * Step-1: RT + composite.
 * Step-2: TextFxStack (fccUI.textFxStack) runs via buildTextureFxComposer /
 * renderTextureFx AFTER full Troika/Flower stencil composite.
 * Do NOT put per-text FX on camera.postProcessStack.
 *
 * wipeReveal: textanim channel. Fragment wipe; AABB from **text-RT alpha**
 * scan (not caret/project). mask 1 at wipe-start (LTR left=white) + edge glint (刃光) on the text RT BEFORE TextFx so Bloom/Deep Glow can pick up
 * overbright edge pixels. Respects source alpha.
 */

import * as THREE from 'three';
import {
	renderTextureFx,
	stackDataHasEnabledEffects,
} from '../postprocessing/PostProcessStack.js?v=fcc-ui-101';
import { registerBuiltinEffects } from '../postprocessing/BuiltinEffects.js?v=fcc-ui-101';

registerBuiltinEffects();

/** @type {THREE.WebGLRenderTarget|null} */
let pooledTarget = null;

/** @type {THREE.ShaderMaterial|null} */
let blitMat = null;
/** @type {THREE.Mesh|null} */
let blitMesh = null;
/** @type {THREE.OrthographicCamera|null} */
let blitCam = null;
/** @type {THREE.Scene|null} */
let blitScene = null;

/** Mutable cache for renderTextureFx composer. */
const fxCache = { built: null };

/** wipeReveal pass resources */
/** @type {THREE.WebGLRenderTarget|null} */
let wipeOutRT = null;
/** @type {THREE.ShaderMaterial|null} */
let wipeMat = null;
/** @type {THREE.Mesh|null} */
let wipeMesh = null;
/** @type {THREE.Scene|null} */
let wipeScene = null;
/** @type {THREE.OrthographicCamera|null} */
let wipeCam = null;

/** Alpha-AABB downsample (wipe bounds from actual RT ink). */
/** @type {THREE.WebGLRenderTarget|null} */
let alphaBoundsRT = null;
/** @type {THREE.ShaderMaterial|null} */
let alphaBoundsMat = null;
/** @type {THREE.Mesh|null} */
let alphaBoundsMesh = null;
/** @type {THREE.Scene|null} */
let alphaBoundsScene = null;
/** @type {THREE.OrthographicCamera|null} */
let alphaBoundsCam = null;
/** @type {Uint8Array|null} */
let alphaBoundsBuf = null;


/**
 * @param {number} width
 * @param {number} height
 * @returns {THREE.WebGLRenderTarget}
 */
export function ensureTextLayerRenderTarget( width, height ) {

	const w = Math.max( 1, Math.round( width ) );
	const h = Math.max( 1, Math.round( height ) );
	if ( pooledTarget && pooledTarget.width === w && pooledTarget.height === h ) {

		return pooledTarget;

	}

	if ( pooledTarget ) pooledTarget.dispose();

	pooledTarget = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.UnsignedByteType,
		format: THREE.RGBAFormat,
		depthBuffer: true,
		stencilBuffer: true,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	} );
	pooledTarget.texture.colorSpace = THREE.SRGBColorSpace;
	pooledTarget.texture.flipY = false;
	pooledTarget.texture.generateMipmaps = false;
	pooledTarget.texture.minFilter = THREE.LinearFilter;
	pooledTarget.texture.magFilter = THREE.LinearFilter;
	pooledTarget.texture.name = 'FreeFilmCut.TextLayerRT';
	return pooledTarget;

}

/**
 * Apply shared-registry Text Fx after RT rasterization.
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.WebGLRenderTarget} args.target
 * @param {object|null|undefined} args.stack fccUI.textFxStack
 * @returns {THREE.Texture}
 */
export function applyTextLayerFx( args ) {

	const renderer = args.renderer;
	const target = args.target;
	const stack = args.stack;
	const input = args.inputTexture || ( target ? target.texture : null );
	if ( ! renderer || ! input ) return input;
	const width = args.width || ( target ? target.width : 0 );
	const height = args.height || ( target ? target.height : 0 );
	if ( ! stackDataHasEnabledEffects( stack ) ) return input;
	if ( !( width > 0 ) || !( height > 0 ) ) return input;

	return renderTextureFx( {
		renderer,
		inputTexture: input,
		width,
		height,
		stack,
		cache: fxCache,
	} );

}

/** @deprecated use applyTextLayerFx — kept as Step-2 hook name from audit */
export function applyTextLayerFxPlaceholder( target ) {

	return null;

}

/**
 * @param {THREE.WebGLRenderTarget} target
 * @param {object} [opts]
 * @param {THREE.WebGLRenderer} [opts.renderer]
 * @param {object|null} [opts.stack]
 * @returns {THREE.Texture}
 */
export function textLayerCompositeSource( target, opts ) {

	if ( opts && opts.renderer && opts.stack ) {

		return applyTextLayerFx( {
			renderer: opts.renderer,
			target,
			stack: opts.stack,
		} );

	}

	const fx = applyTextLayerFxPlaceholder( target );
	return fx || target.texture;

}

export { stackDataHasEnabledEffects };

function ensureWipePass() {

	if ( wipeMat && ( ! wipeMat.uniforms.uDebug || wipeMat.blending !== THREE.NoBlending || ! wipeMat.uniforms.uWorldBounds || wipeMat.userData.__fccWipeV !== 20 ) ) {
		wipeMat.dispose();
		wipeMat = null;
		if ( wipeMesh ) { wipeMesh.geometry.dispose(); wipeMesh = null; }
		wipeScene = null;
		wipeCam = null;
	}
	if ( wipeMat ) return;
	wipeMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.wipeReveal',
		uniforms: {
			tDiffuse: { value: null },
			uProgress: { value: 1 },
			uSoft: { value: 0.12 },
			uDir: { value: 0 }, // 0 ltr, 1 rtl, 2 ttb, 3 btt
			uRes: { value: new THREE.Vector2( 1, 1 ) },
			// World/overlay pixel AABB (xy=min, zw=max) — same space as vUv*uRes.
			uWorldBounds: { value: new THREE.Vector4( 0, 0, 1, 1 ) },
			uEdgeIntensity: { value: 2.5 },
			uEdgeWidth: { value: 0.04 },
			uDebug: { value: 0 },
		},
		vertexShader: /* glsl */`
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			uniform float uProgress;
			uniform float uSoft;
			uniform float uDir;
			uniform vec2 uRes;
			uniform vec4 uWorldBounds;
			uniform float uEdgeIntensity;
			uniform float uEdgeWidth;
			uniform float uDebug;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );

				// RT UV → overlay/RT pixels (UI ortho bottom-left).
				vec2 world = vUv * uRes;
				float u = ( world.x - uWorldBounds.x ) / max( uWorldBounds.z - uWorldBounds.x, 1e-5 );
				float v = ( world.y - uWorldBounds.y ) / max( uWorldBounds.w - uWorldBounds.y, 1e-5 );

				// Static mask: 1 at wipe-start … 0 at end (LTR left white → right black).
				float mask = 1.0 - u;
				if ( uDir > 0.5 && uDir < 1.5 ) mask = u;
				else if ( uDir > 1.5 && uDir < 2.5 ) mask = v;
				else if ( uDir > 2.5 ) mask = 1.0 - v;

				float soft = max( uSoft, 1e-4 );
				float pExp = uProgress * ( 1.0 + 2.0 * soft ) - soft;
				float thresh = 1.0 - pExp;
				float reveal = smoothstep( thresh - soft, thresh + soft, mask );

				float ew = max( uEdgeWidth, 1e-4 );
				float edge = smoothstep( thresh - ew, thresh, mask )
					* ( 1.0 - smoothstep( thresh, thresh + ew, mask ) );

				if ( uDebug > 0.5 ) {
					// Show masked text composite so Duo can see if mask hits glyphs.
					// Outside layout: dark red. Edge frontier: cyan tint on top.
					float inBox = step( 0.0, u ) * step( u, 1.0 ) * step( 0.0, v ) * step( v, 1.0 );
					vec3 base = c.rgb * reveal;
					float a = c.a * reveal;
					// Dim checker behind empty so frame is visible.
					float chk = mod( floor( vUv.x * 32.0 ) + floor( vUv.y * 32.0 ), 2.0 );
					vec3 bg = vec3( 0.08 + chk * 0.04 );
					vec3 col = mix( bg, base, clamp( a * 4.0, 0.0, 1.0 ) );
					col = mix( col, vec3( 0.0, 1.0, 1.0 ), clamp( edge * c.a * 2.5, 0.0, 1.0 ) );
					col = mix( vec3( 0.35, 0.0, 0.05 ), col, inBox );
					gl_FragColor = vec4( col, 1.0 );
					return;
				}

				if ( c.a < 0.001 ) discard;
				edge *= c.a;
				vec3 rgb = c.rgb * reveal + edge * uEdgeIntensity * vec3( 1.0 );
				float a = max( c.a * reveal, edge * c.a );
				gl_FragColor = vec4( rgb, a );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NoBlending,
	} );
	wipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );
	wipeScene = new THREE.Scene();
	wipeScene.add( wipeMesh );
	wipeCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );
	// Stamp the schema version — without this the guard above sees `undefined`
	// and disposes/recompiles the shader on every frame.
	wipeMat.userData.__fccWipeV = 20;

}

function ensureWipeOutRT( width, height ) {

	const w = Math.max( 1, Math.round( width ) );
	const h = Math.max( 1, Math.round( height ) );
	if ( wipeOutRT && wipeOutRT.width === w && wipeOutRT.height === h ) return wipeOutRT;
	if ( wipeOutRT ) wipeOutRT.dispose();
	// HalfFloat so edge glint can exceed 1.0 for TextFx Bloom / Deep Glow.
	wipeOutRT = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.HalfFloatType,
		format: THREE.RGBAFormat,
		depthBuffer: false,
		stencilBuffer: false,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	} );
	// Linear: keep edge glint >1.0 for TextFx Bloom/Deep Glow (not sRGB-encoded).
	wipeOutRT.texture.colorSpace = THREE.LinearSRGBColorSpace;
	wipeOutRT.texture.flipY = false;
	wipeOutRT.texture.generateMipmaps = false;
	wipeOutRT.texture.name = 'FreeFilmCut.TextWipeReveal';
	return wipeOutRT;

}

function dirToIndex( direction ) {

	switch ( direction ) {
		case 'rtl': return 1;
		case 'ttb': return 2;
		case 'btt': return 3;
		case 'ltr':
		default: return 0;
	}

}

/**
 * Textanim wipeReveal channel: linear scan/reveal on text-layer texture.
 * Respects source alpha (mask multiplies a). Not a TextFx registry effect.
 *
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.Texture} args.inputTexture
 * @param {number} args.width
 * @param {number} args.height
 * @param {number} args.progress 0..1 (0 hidden, 1 fully revealed)
 * @param {string} [args.direction] ltr|rtl|ttb|btt
 * @param {number} [args.soft] soft edge in text-local UV (0..0.5)
 * @param {number} [args.edgeIntensity] edge glint strength (刃光)
 * @param {number} [args.edgeWidth] edge band width in layout-normalized units
 * @param {object} [args.layout] from collectWipeLayoutMetrics (caret local axis)
 * @param {boolean} [args.debugMask] visualize axis/reveal/edge (full RT)
 * @returns {THREE.Texture}
 */

/**
 * @deprecated Prefer collectWipeLayoutMetrics (caret layout axis).
 * Map object Box3 into RT UV — wrong for flower-expanded bounds.
 * @param {THREE.Object3D} object
 * @param {number} resW
 * @param {number} resH
 * @returns {{u0:number,v0:number,u1:number,v1:number}|null}
 */
export function computeWipeUvBounds( object, resW, resH ) {

	if ( ! object || !( resW > 0 ) || !( resH > 0 ) ) return null;
	const box = new THREE.Box3();
	try {

		box.setFromObject( object );

	} catch ( e ) {

		return null;

	}

	if ( box.isEmpty() ) return null;
	const w = box.max.x - box.min.x;
	const h = box.max.y - box.min.y;
	if ( !( w > 0.5 ) || !( h > 0.5 ) ) return null;
	// Pad ~6% so soft edge has room outside glyphs.
	const padX = Math.max( 4, w * 0.06 );
	const padY = Math.max( 4, h * 0.06 );
	let u0 = ( box.min.x - padX ) / resW;
	let u1 = ( box.max.x + padX ) / resW;
	let v0 = ( box.min.y - padY ) / resH;
	let v1 = ( box.max.y + padY ) / resH;
	u0 = Math.max( 0, Math.min( 1, u0 ) );
	u1 = Math.max( 0, Math.min( 1, u1 ) );
	v0 = Math.max( 0, Math.min( 1, v0 ) );
	v1 = Math.max( 0, Math.min( 1, v1 ) );
	if ( ( u1 - u0 ) < 1e-3 || ( v1 - v0 ) < 1e-3 ) return null;
	return { u0, v0, u1, v1 };

}


function ensureAlphaBoundsPass() {

	if ( alphaBoundsMat ) return;
	alphaBoundsMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.alphaBoundsCopy',
		uniforms: { tDiffuse: { value: null } },
		vertexShader: /* glsl */`
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			varying vec2 vUv;
			void main() {
				gl_FragColor = texture2D( tDiffuse, vUv );
			}
		`,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		blending: THREE.NoBlending,
	} );
	alphaBoundsMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), alphaBoundsMat );
	alphaBoundsScene = new THREE.Scene();
	alphaBoundsScene.add( alphaBoundsMesh );
	alphaBoundsCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}

function ensureAlphaBoundsRT( w, h ) {

	if ( alphaBoundsRT && alphaBoundsRT.width === w && alphaBoundsRT.height === h ) return alphaBoundsRT;
	if ( alphaBoundsRT ) alphaBoundsRT.dispose();
	alphaBoundsRT = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.UnsignedByteType,
		format: THREE.RGBAFormat,
		depthBuffer: false,
		stencilBuffer: false,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	} );
	alphaBoundsRT.texture.generateMipmaps = false;
	alphaBoundsRT.texture.flipY = false;
	alphaBoundsRT.texture.colorSpace = THREE.NoColorSpace;
	alphaBoundsRT.texture.name = 'FreeFilmCut.WipeAlphaBounds';
	return alphaBoundsRT;

}

/**
 * Wipe AABB from **actual text-RT alpha** (same space as shader `world = vUv * res`).
 * Downsamples then CPU-scans a>eps. Guarantees bounds sit on drawn ink.
 *
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.Texture} args.inputTexture text RT color
 * @param {number} args.width
 * @param {number} args.height
 * @param {number} [args.maxSide=128]
 * @param {number} [args.alphaEps=10] 0..255
 * @param {number} [args.padFrac=0.06]
 * @param {boolean} [args.debug]
 * @returns {{minX:number,maxX:number,minY:number,maxY:number,space:string}|null}
 */
export function computeWipeAlphaBounds( args ) {

	const renderer = args.renderer;
	const inputTexture = args.inputTexture;
	const width = Math.max( 1, Math.round( Number( args.width ) || 1 ) );
	const height = Math.max( 1, Math.round( Number( args.height ) || 1 ) );
	if ( ! renderer || ! inputTexture ) return null;

	const maxSide = Math.max( 32, Math.min( 256, Number( args.maxSide ) || 128 ) );
	const scale = Math.min( 1, maxSide / Math.max( width, height ) );
	const dw = Math.max( 1, Math.round( width * scale ) );
	const dh = Math.max( 1, Math.round( height * scale ) );
	const alphaEps = Math.max( 1, Math.min( 255, Number( args.alphaEps ) || 10 ) );
	const padFrac = Math.max( 0, Number( args.padFrac ) || 0.06 );

	ensureAlphaBoundsPass();
	const small = ensureAlphaBoundsRT( dw, dh );

	alphaBoundsMat.uniforms.tDiffuse.value = inputTexture;

	const prevTarget = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget( small );
	renderer.setViewport( 0, 0, dw, dh );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, true, true );
	renderer.autoClear = false;
	renderer.render( alphaBoundsScene, alphaBoundsCam );

	const need = dw * dh * 4;
	if ( ! alphaBoundsBuf || alphaBoundsBuf.length < need ) {

		alphaBoundsBuf = new Uint8Array( need );

	}
	renderer.readRenderTargetPixels( small, 0, 0, dw, dh, alphaBoundsBuf );

	renderer.autoClear = prevAuto;
	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );
	alphaBoundsMat.uniforms.tDiffuse.value = null;

	// readPixels: row 0 = bottom (matches flipY=false RT / vUv.y=0 bottom).
	let minC = dw;
	let maxC = - 1;
	let minR = dh;
	let maxR = - 1;
	const buf = alphaBoundsBuf;
	for ( let y = 0; y < dh; y ++ ) {

		for ( let x = 0; x < dw; x ++ ) {

			const a = buf[ ( y * dw + x ) * 4 + 3 ];
			if ( a <= alphaEps ) continue;
			if ( x < minC ) minC = x;
			if ( x > maxC ) maxC = x;
			if ( y < minR ) minR = y;
			if ( y > maxR ) maxR = y;

		}

	}

	if ( maxC < minC || maxR < minR ) {

		if ( args.debug ) {

			console.warn( '[FreeFilmCut wipe] no alpha in text RT; skip wipe bounds' );

		}
		return null;

	}

	// Map small-tex texel spans → full RT pixels (inclusive max texel → +1).
	let minX = ( minC / dw ) * width;
	let maxX = ( ( maxC + 1 ) / dw ) * width;
	let minY = ( minR / dh ) * height;
	let maxY = ( ( maxR + 1 ) / dh ) * height;

	const padX = Math.max( 2, ( maxX - minX ) * padFrac );
	const padY = Math.max( 2, ( maxY - minY ) * padFrac );
	minX = Math.max( 0, minX - padX );
	maxX = Math.min( width, maxX + padX );
	minY = Math.max( 0, minY - padY );
	maxY = Math.min( height, maxY + padY );

	if ( ! ( maxX - minX > 2 && maxY - minY > 2 ) ) return null;

	if ( args.debug ) {

		console.log( '[FreeFilmCut wipe] alpha-AABB', {
			minX, maxX, minY, maxY, dw, dh, width, height,
			texels: [ minC, maxC, minR, maxR ],
		} );

	}

	return { minX, maxX, minY, maxY, space: 'rt-alpha' };

}


export function applyWipeReveal( args ) {

	const renderer = args.renderer;
	const inputTexture = args.inputTexture;
	const width = args.width;
	const height = args.height;
	if ( ! renderer || ! inputTexture ) return inputTexture || null;

	const progress = Math.max( 0, Math.min( 1, Number( args.progress ) ) );
	const soft = Math.max( 0.02, Math.min( 0.5, Number( args.soft ) || 0.12 ) );
	const edgeIntensity = Math.max( 0, Number( args.edgeIntensity ) || 0 );
	const edgeWidth = Math.max( 0.005, Math.min( 0.25, Number( args.edgeWidth ) || 0.04 ) );
	// Fully revealed with no soft leftover — skip (identity). Mid-progress always runs for edge.
	if ( ! args.debugMask && progress >= 0.999 && soft <= 0.021 && edgeIntensity <= 1e-4 ) {

		return inputTexture;

	}

	ensureWipePass();
	const out = ensureWipeOutRT( width, height );
	wipeMat.uniforms.tDiffuse.value = inputTexture;
	wipeMat.uniforms.uProgress.value = progress;
	wipeMat.uniforms.uSoft.value = soft;
	wipeMat.uniforms.uEdgeIntensity.value = edgeIntensity;
	wipeMat.uniforms.uEdgeWidth.value = edgeWidth;
	wipeMat.uniforms.uDebug.value = args.debugMask ? 1 : 0;
	wipeMat.uniforms.uDir.value = dirToIndex( args.direction );
	wipeMat.uniforms.uRes.value.set(
		Math.max( 1, Number( width ) || 1 ),
		Math.max( 1, Number( height ) || 1 ),
	);
	const layout = args.layout || null;
	if ( layout
		&& Number.isFinite( layout.minX ) && Number.isFinite( layout.maxX )
		&& Number.isFinite( layout.minY ) && Number.isFinite( layout.maxY )
		&& ( layout.maxX - layout.minX ) > 1e-4
		&& ( layout.maxY - layout.minY ) > 1e-4 ) {

		wipeMat.uniforms.uWorldBounds.value.set(
			layout.minX, layout.minY, layout.maxX, layout.maxY,
		);

	} else {

		wipeMat.uniforms.uWorldBounds.value.set( 0, 0, width, height );

	}

	if ( args.debugMask && args.debugLog && typeof console !== 'undefined' ) {

		const b = wipeMat.uniforms.uWorldBounds.value;
		console.log( '[FreeFilmCut wipe]', {
			progress,
			bounds: [ b.x, b.y, b.z, b.w ],
			res: [ width, height ],
			direction: args.direction,
		} );

	}

	const prevTarget = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget( out );
	renderer.setViewport( 0, 0, out.width, out.height );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, true, true );
	renderer.autoClear = false;
	renderer.render( wipeScene, wipeCam );

	renderer.autoClear = prevAuto;
	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );
	wipeMat.uniforms.tDiffuse.value = null;

	return out.texture;

}

function ensureBlit() {

	if ( blitMat ) return;
	blitMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.blit',
		uniforms: {
			tDiffuse: { value: null },
			uOpacity: { value: 1 },
		},
		vertexShader: /* glsl */`
			varying vec2 vUv;
			void main() {
				vUv = uv;
				gl_Position = vec4( position.xy, 0.0, 1.0 );
			}
		`,
		fragmentShader: /* glsl */`
			uniform sampler2D tDiffuse;
			uniform float uOpacity;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
				// Straight alpha; skip empty padding so 3D/letterbox shows through.
				if ( c.a < 0.001 ) discard;
				gl_FragColor = vec4( c.rgb, c.a * uOpacity );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NormalBlending,
	} );
	blitMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), blitMat );
	blitScene = new THREE.Scene();
	blitScene.add( blitMesh );
	blitCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}

/**
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {THREE.Texture} args.texture
 * @param {{x:number,y:number,w:number,h:number}} args.rect
 * @param {number} [args.opacity]
 */
export function blitTextLayerToLetterbox( args ) {

	const renderer = args.renderer;
	const texture = args.texture;
	const rect = args.rect;
	const opacity = args.opacity !== undefined ? args.opacity : 1;
	if ( ! renderer || ! texture || ! rect ) return;

	ensureBlit();
	blitMat.uniforms.tDiffuse.value = texture;
	blitMat.uniforms.uOpacity.value = opacity;

	const prevTarget = renderer.getRenderTarget();
	const prevAuto = renderer.autoClear;
	renderer.setRenderTarget( null );
	renderer.autoClear = false;
	renderer.setViewport( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissor( rect.x, rect.y, rect.w, rect.h );
	renderer.setScissorTest( true );
	renderer.render( blitScene, blitCam );
	renderer.autoClear = prevAuto;
	renderer.setRenderTarget( prevTarget );
	blitMat.uniforms.tDiffuse.value = null;

}

/**
 * @param {object} args
 * @param {THREE.WebGLRenderer} args.renderer
 * @param {{render: Function}} args.uiOverlay
 * @param {number} args.resW
 * @param {number} args.resH
 * @param {THREE.WebGLRenderTarget} args.target
 */
export function renderOverlayTextLayerToRT( args ) {

	const renderer = args.renderer;
	const uiOverlay = args.uiOverlay;
	const resW = args.resW;
	const resH = args.resH;
	const target = args.target;
	if ( ! renderer || ! uiOverlay || ! target ) return;

	const prevTarget = renderer.getRenderTarget();
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();

	renderer.setRenderTarget( target );
	renderer.setViewport( 0, 0, target.width, target.height );
	renderer.setScissorTest( false );
	renderer.setClearColor( 0x000000, 0 );
	renderer.clear( true, true, true );

	uiOverlay.render(
		renderer,
		{ x: 0, y: 0, w: target.width, h: target.height },
		resW,
		resH,
		target,
	);

	renderer.setClearColor( prevClear, prevAlpha );
	renderer.setRenderTarget( prevTarget );

}

export function disposeTextLayerRT() {

	if ( fxCache.built && typeof fxCache.built.dispose === 'function' ) {

		fxCache.built.dispose();
		fxCache.built = null;

	}

	if ( pooledTarget ) {

		pooledTarget.dispose();
		pooledTarget = null;

	}

	if ( wipeOutRT ) {

		wipeOutRT.dispose();
		wipeOutRT = null;

	}

	if ( wipeMat ) {

		wipeMat.dispose();
		wipeMat = null;

	}

	if ( wipeMesh ) {

		wipeMesh.geometry.dispose();
		wipeMesh = null;

	}

	wipeScene = null;
	wipeCam = null;

	if ( blitMat ) {

		blitMat.dispose();
		blitMat = null;

	}

	if ( blitMesh ) {

		blitMesh.geometry.dispose();
		blitMesh = null;

	}

	blitScene = null;
	blitCam = null;

}
