# -*- coding: utf-8 -*-
from pathlib import Path
import re

p = Path(r"D:\GrokbotWork\FreeFilmCut\three.js\editor\js\ui\TextLayerRT.js")
s = p.read_text(encoding="utf-8")

# Update header comment
s = s.replace(
    " * wipeReveal: textanim animation channel (not TextFx PP). Applied after Fx as\n * an alpha-respecting linear scan on the text RT texture.",
    " * wipeReveal: textanim channel (not TextFx PP). Fragment linear wipe + edge\n * glint (刃光) on the text RT BEFORE TextFx so Bloom/Deep Glow can pick up\n * overbright edge pixels. Respects source alpha.",
)

# Update ensureWipePass uniforms + fragment shader
old_ensure = """function ensureWipePass() {

	if ( wipeMat ) return;
	wipeMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.wipeReveal',
		uniforms: {
			tDiffuse: { value: null },
			uProgress: { value: 1 },
			uSoft: { value: 0.12 },
			uDir: { value: 0 }, // 0 ltr, 1 rtl, 2 ttb, 3 btt
			// Text-local UV rect in the RT (xy=min, zw=max). Full-frame UV
			// makes the edge flash across a small glyph band in one tick.
			uBounds: { value: new THREE.Vector4( 0, 0, 1, 1 ) },
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
			uniform vec4 uBounds;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
				if ( c.a < 0.001 ) discard;
				// Remap UV into text-local 0..1 so progress sweeps the glyphs,
				// not the whole project frame (which looks like a one-frame flash).
				vec2 bmin = uBounds.xy;
				vec2 bmax = uBounds.zw;
				float u = ( vUv.x - bmin.x ) / max( bmax.x - bmin.x, 1e-5 );
				float v = ( vUv.y - bmin.y ) / max( bmax.y - bmin.y, 1e-5 );
				float axis = u;
				if ( uDir > 0.5 && uDir < 1.5 ) axis = 1.0 - u;
				else if ( uDir > 1.5 && uDir < 2.5 ) axis = 1.0 - v;
				else if ( uDir > 2.5 ) axis = v;
				float soft = max( uSoft, 1e-4 );
				// Expand so soft edge fully enters/exits over progress 0..1.
				float edge = uProgress * ( 1.0 + 2.0 * soft ) - soft;
				float mask = 1.0 - smoothstep( edge, edge + soft, axis );
				gl_FragColor = vec4( c.rgb, c.a * mask );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NormalBlending,
	} );
	wipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );
	wipeScene = new THREE.Scene();
	wipeScene.add( wipeMesh );
	wipeCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}"""

new_ensure = """function ensureWipePass() {

	if ( wipeMat ) return;
	wipeMat = new THREE.ShaderMaterial( {
		name: 'TextLayerRT.wipeReveal',
		uniforms: {
			tDiffuse: { value: null },
			uProgress: { value: 1 },
			uSoft: { value: 0.12 },
			uDir: { value: 0 }, // 0 ltr, 1 rtl, 2 ttb, 3 btt
			// Text-local UV rect in the RT (xy=min, zw=max).
			uBounds: { value: new THREE.Vector4( 0, 0, 1, 1 ) },
			// Edge glint (刃光): bright band along wipe frontier for Bloom/Deep Glow.
			uEdgeIntensity: { value: 2.5 },
			uEdgeWidth: { value: 0.04 },
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
			uniform vec4 uBounds;
			uniform float uEdgeIntensity;
			uniform float uEdgeWidth;
			varying vec2 vUv;
			void main() {
				vec4 c = texture2D( tDiffuse, vUv );
				// Empty stays empty — no reveal/glint on padding.
				if ( c.a < 0.001 ) discard;

				vec2 bmin = uBounds.xy;
				vec2 bmax = uBounds.zw;
				float u = ( vUv.x - bmin.x ) / max( bmax.x - bmin.x, 1e-5 );
				float v = ( vUv.y - bmin.y ) / max( bmax.y - bmin.y, 1e-5 );
				float axis = u;
				if ( uDir > 0.5 && uDir < 1.5 ) axis = 1.0 - u;
				else if ( uDir > 1.5 && uDir < 2.5 ) axis = 1.0 - v;
				else if ( uDir > 2.5 ) axis = v;

				float soft = max( uSoft, 1e-4 );
				// Expand progress so soft fully enters/exits over 0..1.
				float p = uProgress * ( 1.0 + 2.0 * soft ) - soft;
				// reveal: 0 hidden → 1 shown (JY LinearWipe feel).
				float reveal = smoothstep( axis - soft, axis + soft, p );

				// Edge band along the wipe frontier (narrower than soft).
				float ew = max( uEdgeWidth, 1e-4 );
				float edge = smoothstep( axis - ew, axis, p ) * ( 1.0 - smoothstep( axis, axis + ew, p ) );
				// Keep glint under glyph coverage.
				edge *= c.a;

				vec3 rgb = c.rgb + edge * uEdgeIntensity * vec3( 1.0 );
				gl_FragColor = vec4( rgb, c.a * reveal );
			}
		`,
		transparent: true,
		depthTest: false,
		depthWrite: false,
		toneMapped: false,
		premultipliedAlpha: false,
		blending: THREE.NormalBlending,
	} );
	wipeMesh = new THREE.Mesh( new THREE.PlaneGeometry( 2, 2 ), wipeMat );
	wipeScene = new THREE.Scene();
	wipeScene.add( wipeMesh );
	wipeCam = new THREE.OrthographicCamera( - 1, 1, 1, - 1, 0, 1 );

}"""

if old_ensure not in s:
    raise SystemExit('ensureWipePass block not found')
s = s.replace(old_ensure, new_ensure)

# HalfFloat wipe RT so overbright edge survives into TextFx Deep Glow
old_rt = """	wipeOutRT = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.UnsignedByteType,
		format: THREE.RGBAFormat,
		depthBuffer: false,
		stencilBuffer: false,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	} );"""

new_rt = """	// HalfFloat so edge glint can exceed 1.0 for TextFx Bloom / Deep Glow.
	wipeOutRT = new THREE.WebGLRenderTarget( w, h, {
		type: THREE.HalfFloatType,
		format: THREE.RGBAFormat,
		depthBuffer: false,
		stencilBuffer: false,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
	} );"""

if old_rt not in s:
    raise SystemExit('wipeOutRT alloc not found')
s = s.replace(old_rt, new_rt)

# applyTextLayerFx — accept optional inputTexture
old_fx = """export function applyTextLayerFx( args ) {

	const renderer = args.renderer;
	const target = args.target;
	const stack = args.stack;
	if ( ! renderer || ! target ) return target ? target.texture : null;
	if ( ! stackDataHasEnabledEffects( stack ) ) return target.texture;

	return renderTextureFx( {
		renderer,
		inputTexture: target.texture,
		width: target.width,
		height: target.height,
		stack,
		cache: fxCache,
	} );

}"""

new_fx = """export function applyTextLayerFx( args ) {

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

}"""

if old_fx not in s:
    raise SystemExit('applyTextLayerFx not found')
s = s.replace(old_fx, new_fx)

# applyWipeReveal — wire edge uniforms; don't skip when edge needed mid-way
# Update JSDoc and body for edgeIntensity/edgeWidth
old_apply_start = """export function applyWipeReveal( args ) {

	const renderer = args.renderer;
	const inputTexture = args.inputTexture;
	const width = args.width;
	const height = args.height;
	if ( ! renderer || ! inputTexture ) return inputTexture || null;

	const progress = Math.max( 0, Math.min( 1, Number( args.progress ) ) );
	// Fully revealed — skip pass (keep identity texture).
	if ( progress >= 0.999 && ( ! args.soft || Number( args.soft ) <= 0 ) ) {

		return inputTexture;

	}

	ensureWipePass();
	const out = ensureWipeOutRT( width, height );
	wipeMat.uniforms.tDiffuse.value = inputTexture;
	wipeMat.uniforms.uProgress.value = progress;
	wipeMat.uniforms.uSoft.value = Math.max( 0.02, Math.min( 0.5, Number( args.soft ) || 0.12 ) );
	wipeMat.uniforms.uDir.value = dirToIndex( args.direction );
	const b = args.bounds || null;"""

# The dash character might be special - let me find applyWipeReveal and replace more carefully
idx = s.find("export function applyWipeReveal( args )")
if idx < 0:
    raise SystemExit('applyWipeReveal not found')

# Find skip condition and uniforms set
# Replace soft skip: only skip when fully revealed AND no edge would show (progress near 1)
s2 = s
# Replace the skip + uniform setup portion
pat = re.compile(
    r"export function applyWipeReveal\( args \) \{.*?wipeMat\.uniforms\.uDir\.value = dirToIndex\( args\.direction \);",
    re.S,
)
m = pat.search(s)
if not m:
    raise SystemExit('applyWipeReveal head not found via regex')

new_head = """export function applyWipeReveal( args ) {

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
	if ( progress >= 0.999 && soft <= 0.021 && edgeIntensity <= 1e-4 ) {

		return inputTexture;

	}

	ensureWipePass();
	const out = ensureWipeOutRT( width, height );
	wipeMat.uniforms.tDiffuse.value = inputTexture;
	wipeMat.uniforms.uProgress.value = progress;
	wipeMat.uniforms.uSoft.value = soft;
	wipeMat.uniforms.uEdgeIntensity.value = edgeIntensity;
	wipeMat.uniforms.uEdgeWidth.value = edgeWidth;
	wipeMat.uniforms.uDir.value = dirToIndex( args.direction );"""

s = s[:m.start()] + new_head + s[m.end():]

# Update JSDoc above applyWipeReveal for edge params - find the comment block before computeWipeUvBounds / applyWipeReveal
s = s.replace(
    " * @param {number} [args.soft] soft edge in text-local UV (0..0.5)\n * @param {{u0:number,v0:number,u1:number,v1:number}} [args.bounds] text UV rect in RT\n * @returns {THREE.Texture}\n */",
    " * @param {number} [args.soft] soft edge in text-local UV (0..0.5)\n * @param {number} [args.edgeIntensity] edge glint strength (刃光)\n * @param {number} [args.edgeWidth] edge band width in text-local UV\n * @param {{u0:number,v0:number,u1:number,v1:number}} [args.bounds] text UV rect in RT\n * @returns {THREE.Texture}\n */",
)

p.write_text(s, encoding="utf-8")
print("TextLayerRT.js OK", "edgeIntensity" in s, "HalfFloatType" in s, "uEdgeWidth" in s)
