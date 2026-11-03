from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
root = Path(r"D:\GrokbotWork\FreeFilmCut")
path = root/"three.js/editor/js/postprocessing/PostProcessStack.js"
t = path.read_text(encoding="utf-8", errors="replace")

# Replace TexturePass import with Pass/FullScreenQuad for custom copy
old_imp = """import { TexturePass } from 'three/addons/postprocessing/TexturePass.js';

export { stackHasEnabledEffects, stackDataHasEnabledEffects };"""

new_imp = """import { Pass, FullScreenQuad } from 'three/addons/postprocessing/Pass.js';

export { stackHasEnabledEffects, stackDataHasEnabledEffects };

/**
 * Straight-alpha copy into EffectComposer readBuffer (no TexturePass premultipliedAlpha).
 * Text RT must keep transparent padding as a=0.
 */
class TextFxInputPass extends Pass {

	constructor( map ) {

		super();
		this.map = map;
		this.needsSwap = false;
		this.clear = true;
		this.uniforms = {
			tDiffuse: { value: null },
		};
		this.material = new THREE.ShaderMaterial( {
			name: 'TextFxInputPass',
			uniforms: this.uniforms,
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
			transparent: false,
			blending: THREE.NoBlending,
		} );
		this._fsQuad = new FullScreenQuad( this.material );

	}

	render( renderer, writeBuffer, readBuffer ) {

		this.uniforms.tDiffuse.value = this.map;
		renderer.setRenderTarget( this.renderToScreen ? null : readBuffer );
		if ( this.clear ) {

			renderer.setClearColor( 0x000000, 0 );
			renderer.clear( true, true, true );

		}

		this._fsQuad.render( renderer );

	}

	dispose() {

		this.material.dispose();
		this._fsQuad.dispose();

	}

}
"""

if old_imp not in t:
    raise SystemExit('TexturePass import block missing')
t = t.replace(old_imp, new_imp, 1)

# Replace entire buildTextureFxComposer + renderTextureFx
start = t.find("export function buildTextureFxComposer")
if start < 0:
    raise SystemExit('buildTextureFxComposer missing')
# from start to end of file
new_tail = r'''export function buildTextureFxComposer( {
	renderer,
	inputTexture,
	width,
	height,
	stack,
	includeOutputPass = false,
} ) {

	if ( ! renderer || ! inputTexture ) return null;
	const normalized = normalizeEffectStack( stack );
	if ( ! stackDataHasEnabledEffects( normalized ) ) return null;

	const w = Math.max( 1, Math.floor( width ) );
	const h = Math.max( 1, Math.floor( height ) );

	migrateBloomParamsOnce( normalized );

	// Raw bytes through the chain — avoid sRGB decode/encode on every pass (washes Invert).
	const rtParams = {
		type: THREE.UnsignedByteType,
		format: THREE.RGBAFormat,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		depthBuffer: false,
		stencilBuffer: false,
	};
	const rt = new THREE.WebGLRenderTarget( w, h, rtParams );
	rt.texture.colorSpace = THREE.NoColorSpace;
	rt.texture.flipY = false;
	rt.texture.generateMipmaps = false;
	rt.texture.name = 'FreeFilmCut.TextFxComposer';

	const composer = new EffectComposer( renderer, rt );
	composer.setSize( w, h );
	composer.setPixelRatio( 1 );
	// clone() may not keep NoColorSpace on some three versions
	if ( composer.renderTarget2 && composer.renderTarget2.texture ) {

		composer.renderTarget2.texture.colorSpace = THREE.NoColorSpace;
		composer.renderTarget2.texture.flipY = false;
		composer.renderTarget2.texture.generateMipmaps = false;

	}

	const inputPass = new TextFxInputPass( inputTexture );
	composer.addPass( inputPass );

	const latePasses = [];
	const bindings = [];
	const ctx = {
		THREE,
		width: w,
		height: h,
		renderer,
		input: 'texture',
		scene: null,
		camera: null,
	};

	for ( const entry of normalized.effects ) {

		if ( ! entry || entry.enabled === false ) continue;
		const desc = getEffectDescriptor( entry.type );
		if ( ! desc ) continue;
		if ( desc.inputs && desc.inputs.indexOf( 'texture' ) === - 1 ) continue;

		const params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
		const passes = desc.createPasses( ctx ) || [];
		if ( typeof desc.applyParams === 'function' ) {

			desc.applyParams( passes, params );

		}

		bindings.push( { entryId: entry.id, type: entry.type, passes } );

		for ( const pass of passes ) {

			pass.enabled = true;
			// Force shader materials off tone-map for text LDR path
			if ( pass.material ) pass.material.toneMapped = false;
			if ( entry.type === 'fxaa' && includeOutputPass ) {

				latePasses.push( pass );

			} else {

				composer.addPass( pass );

			}

		}

	}

	if ( includeOutputPass ) {

		const outputPass = new OutputPass();
		composer.addPass( outputPass );
		for ( const pass of latePasses ) composer.addPass( pass );

	}

	for ( const pass of composer.passes ) {

		pass.renderToScreen = false;

	}

	const signature = structureSignature( normalized, w, h, - 1, - 1 );

	return {
		composer,
		signature,
		bindings,
		inputPass,
		stack: normalized,
		getOutputTexture() {

			const tex = composer.readBuffer && composer.readBuffer.texture
				? composer.readBuffer.texture
				: null;
			if ( tex ) {

				// Blit path expects one sRGB decode onto the canvas.
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.flipY = false;

			}

			return tex;

		},
		dispose() {

			try {

				composer.dispose();

			} catch ( e ) {

				/* ignore */

			}

			try {

				rt.dispose();

			} catch ( e ) {

				/* ignore */

			}

			try {

				inputPass.dispose();

			} catch ( e ) {

				/* ignore */

			}

		},
	};

}

/**
 * Run texture FX once; returns output texture or inputTexture if no FX.
 */
export function renderTextureFx( args ) {

	const renderer = args.renderer;
	const inputTexture = args.inputTexture;
	const stack = args.stack;
	const w = args.width;
	const h = args.height;
	if ( ! renderer || ! inputTexture ) return inputTexture;
	if ( ! stackDataHasEnabledEffects( stack ) ) return inputTexture;

	const nextSig = structureSignature( normalizeEffectStack( stack ), Math.floor( w ), Math.floor( h ), - 1, - 1 );
	let built = args.cache && args.cache.built;

	const prevInputCS = inputTexture.colorSpace;

	if ( ! built || built.signature !== nextSig ) {

		if ( built && typeof built.dispose === 'function' ) built.dispose();
		built = buildTextureFxComposer( {
			renderer,
			inputTexture,
			width: w,
			height: h,
			stack,
			includeOutputPass: false,
		} );
		if ( args.cache ) args.cache.built = built;

	} else {

		built.inputPass.map = inputTexture;
		for ( const binding of built.bindings || [] ) {

			const entry = ( stack.effects || [] ).find( ( e ) => e && e.id === binding.entryId );
			if ( ! entry || entry.enabled === false ) continue;
			const desc = getEffectDescriptor( binding.type );
			if ( ! desc || typeof desc.applyParams !== 'function' ) continue;
			const params = { ...desc.createDefaultParams(), ...( entry.params || {} ) };
			desc.applyParams( binding.passes, params );

		}

	}

	if ( ! built ) return inputTexture;

	// Sample text RT as raw bytes (already encoded for display).
	inputTexture.colorSpace = THREE.NoColorSpace;

	const prevTM = renderer.toneMapping;
	const prevAuto = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor( prevClear );
	const prevAlpha = renderer.getClearAlpha();
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.autoClear = false;
	renderer.setClearColor( 0x000000, 0 );

	built.composer.render();

	renderer.toneMapping = prevTM;
	renderer.autoClear = prevAuto;
	renderer.setClearColor( prevClear, prevAlpha );
	inputTexture.colorSpace = prevInputCS;

	const out = built.getOutputTexture();
	return out || inputTexture;

}
'''

t = t[:start] + new_tail
path.write_text(t, encoding='utf-8')
print('PostProcessStack.js texture FX rewritten', path.stat().st_size)
