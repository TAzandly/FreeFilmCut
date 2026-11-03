from pathlib import Path
import sys
sys.stdout.reconfigure(encoding="utf-8", errors="replace")
comp = Path(r"D:\GrokbotWork\FreeFilmCut\freefilmcut\apps\web\src\vfxpack\postprocess\composer.ts")
t = comp.read_text(encoding="utf-8", errors="replace")

# Fix imports: replace TexturePass with Pass, FullScreenQuad
t = t.replace(
	'import { TexturePass } from "three/addons/postprocessing/TexturePass.js";',
	'import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";',
)

start = t.find("export type BuiltTextureFx")
if start < 0:
    raise SystemExit('BuiltTextureFx missing')

new_tail = r'''export type BuiltTextureFx = {
	composer: EffectComposer;
	bindings: Array<{ entryId: string; type: string; passes: Pass[] }>;
	signature: string;
	inputPass: TextFxInputPass;
	getOutputTexture: () => THREE.Texture | null;
	dispose: () => void;
};

/** Straight-alpha input copy (no TexturePass premultipliedAlpha). */
class TextFxInputPass extends Pass {
	map: THREE.Texture | null;
	uniforms: { tDiffuse: { value: THREE.Texture | null } };
	material: THREE.ShaderMaterial;
	private _fsQuad: FullScreenQuad;

	constructor(map: THREE.Texture) {
		super();
		this.map = map;
		this.needsSwap = false;
		this.clear = true;
		this.uniforms = { tDiffuse: { value: null } };
		this.material = new THREE.ShaderMaterial({
			name: "TextFxInputPass",
			uniforms: this.uniforms,
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4( position.xy, 0.0, 1.0 );
				}
			`,
			fragmentShader: /* glsl */ `
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
		});
		this._fsQuad = new FullScreenQuad(this.material);
	}

	render(
		renderer: THREE.WebGLRenderer,
		_writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget,
	) {
		this.uniforms.tDiffuse.value = this.map;
		renderer.setRenderTarget(this.renderToScreen ? null : readBuffer);
		if (this.clear) {
			renderer.setClearColor(0x000000, 0);
			renderer.clear(true, true, true);
		}
		this._fsQuad.render(renderer);
	}

	dispose() {
		this.material.dispose();
		this._fsQuad.dispose();
	}
}

function textureFxSignature(stack: PostProcessStackData, w: number, h: number): string {
	return JSON.stringify({
		w,
		h,
		enabled: stack.enabled,
		effects: (stack.effects || []).map((e) => ({
			id: e.id,
			type: e.type,
			enabled: e.enabled !== false,
		})),
	});
}

/**
 * Shared-registry FX on a texture (Text → RT → Fx → blit).
 * Raw NoColorSpace through passes; mark output sRGB for compositing.
 */
export function buildTextureFxComposer({
	renderer,
	inputTexture,
	width,
	height,
	stack,
}: {
	renderer: THREE.WebGLRenderer;
	inputTexture: THREE.Texture;
	width: number;
	height: number;
	stack: PostProcessStackData;
}): BuiltTextureFx | null {
	registerBuiltinPostEffects();
	const normalized = normalizeEffectStack(stack);
	if (!stackHasEnabledEffects(normalized)) return null;

	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));

	const rt = new THREE.WebGLRenderTarget(w, h, {
		type: THREE.UnsignedByteType,
		format: THREE.RGBAFormat,
		minFilter: THREE.LinearFilter,
		magFilter: THREE.LinearFilter,
		depthBuffer: false,
		stencilBuffer: false,
	});
	rt.texture.colorSpace = THREE.NoColorSpace;
	rt.texture.flipY = false;
	rt.texture.generateMipmaps = false;
	rt.texture.name = "FreeFilmCut.TextFxComposer";

	const composer = new EffectComposer(renderer, rt);
	composer.setSize(w, h);
	composer.setPixelRatio(1);
	if (composer.renderTarget2?.texture) {
		composer.renderTarget2.texture.colorSpace = THREE.NoColorSpace;
		composer.renderTarget2.texture.flipY = false;
		composer.renderTarget2.texture.generateMipmaps = false;
	}

	const inputPass = new TextFxInputPass(inputTexture);
	composer.addPass(inputPass);

	const bindings: BuiltTextureFx["bindings"] = [];
	const ctx = { width: w, height: h };

	for (const entry of normalized.effects) {
		if (!entry || entry.enabled === false) continue;
		const desc = getEffectDescriptor(entry.type);
		if (!desc) continue;
		const params = { ...desc.createDefaultParams(), ...(entry.params || {}) };
		const passes = desc.createPasses(ctx) || [];
		desc.applyParams(passes, params);
		bindings.push({ entryId: entry.id, type: entry.type, passes });
		for (const pass of passes) {
			pass.enabled = true;
			const mat = (pass as { material?: THREE.Material }).material;
			if (mat) (mat as THREE.Material & { toneMapped?: boolean }).toneMapped = false;
			composer.addPass(pass);
		}
	}

	for (const pass of composer.passes) {
		pass.renderToScreen = false;
	}

	return {
		composer,
		bindings,
		signature: textureFxSignature(normalized, w, h),
		inputPass,
		getOutputTexture: () => {
			const tex = composer.readBuffer?.texture ?? null;
			if (tex) {
				tex.colorSpace = THREE.SRGBColorSpace;
				tex.flipY = false;
			}
			return tex;
		},
		dispose: () => {
			try {
				composer.dispose();
			} catch {
				/* ignore */
			}
			try {
				rt.dispose();
			} catch {
				/* ignore */
			}
			try {
				inputPass.dispose();
			} catch {
				/* ignore */
			}
		},
	};
}

export type TextureFxCache = { built: BuiltTextureFx | null };

/** Run shared-registry texture FX; returns output or input if none. */
export function renderTextureFx({
	renderer,
	inputTexture,
	width,
	height,
	stack,
	cache,
}: {
	renderer: THREE.WebGLRenderer;
	inputTexture: THREE.Texture;
	width: number;
	height: number;
	stack: PostProcessStackData | null | undefined;
	cache?: TextureFxCache;
}): THREE.Texture {
	registerBuiltinPostEffects();
	const normalized = normalizeEffectStack(stack ?? null);
	if (!stackHasEnabledEffects(normalized)) return inputTexture;

	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));
	const nextSig = textureFxSignature(normalized, w, h);
	let built = cache?.built ?? null;
	const prevInputCS = inputTexture.colorSpace;

	if (!built || built.signature !== nextSig) {
		built?.dispose();
		built = buildTextureFxComposer({
			renderer,
			inputTexture,
			width: w,
			height: h,
			stack: normalized,
		});
		if (cache) cache.built = built;
	} else {
		built.inputPass.map = inputTexture;
		for (const binding of built.bindings) {
			const entry = (normalized.effects || []).find((e) => e && e.id === binding.entryId);
			if (!entry || entry.enabled === false) continue;
			const desc = getEffectDescriptor(binding.type);
			if (!desc) continue;
			const params = { ...desc.createDefaultParams(), ...(entry.params || {}) };
			desc.applyParams(binding.passes, params);
		}
	}

	if (!built) return inputTexture;

	inputTexture.colorSpace = THREE.NoColorSpace;
	const prevTM = renderer.toneMapping;
	const prevAuto = renderer.autoClear;
	const prevClear = new THREE.Color();
	renderer.getClearColor(prevClear);
	const prevAlpha = renderer.getClearAlpha();
	renderer.toneMapping = THREE.NoToneMapping;
	renderer.autoClear = false;
	renderer.setClearColor(0x000000, 0);
	built.composer.render();
	renderer.toneMapping = prevTM;
	renderer.autoClear = prevAuto;
	renderer.setClearColor(prevClear, prevAlpha);
	inputTexture.colorSpace = prevInputCS;

	return built.getOutputTexture() ?? inputTexture;
}
'''

comp.write_text(t[:start] + new_tail, encoding='utf-8')
print('OpenCut composer texture FX rewritten', comp.stat().st_size)
