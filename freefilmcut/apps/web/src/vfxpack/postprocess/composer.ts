/**
 * Pack EffectComposer builder.
 *
 * HDR/LDR contract (same as Editor PostProcessStack / Viewport):
 * - Capture project/pack toneMapping at build time for OutputPass.
 * - Caller MUST set renderer.toneMapping = NoToneMapping for the full
 *   composer.render() (see three-compositor renderPackWithPostProcess).
 * - OutputPass wrap temporarily restores captured tone mapping.
 * - Bloom materials use toneMapped=false (registry) so they stay linear.
 * - When OutputPass is NoToneMapping (pack/project "none"), insert LDR clamp
 *   before bloom/deepGlow so wipe edgeIntensity spikes do not explode bloom.
 *   Neutral/ACES keep HDR bloom. Bloom does NOT require tonemap if beauty is LDR.
 * - Clip NLE present shows accum bytes as-is (MeshBasic round-trip). Overlay UI
 *   writes working-space values with no OutputPass. For NoToneMapping, OutputPass
 *   must NOT apply sRGB transfer (use LinearSRGBColorSpace for OutputPass) or strength=0 PP reads brighter than overlay.
 *   Neutral/ACES still sRGB-encode so tonemapped display codes present correctly.
 * - Bloom strength~=0 stays in the stack (no skip); color-space contract above
 *   is what keeps strength=0 matching overlay / editor none look.
 */
import * as THREE from "three";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import type { ParamValues } from "@/params";
import type { ExposedParam } from "@/vfxpack/exposed-params";
import {
	getEffectDescriptor,
	registerBuiltinPostEffects,
	registerCustomEffectsFromStack,
	stackHasEnabledEffects,
	normalizeEffectStack,
	type PostProcessStackData,
} from "./registry";
import { Pass, FullScreenQuad } from "three/addons/postprocessing/Pass.js";
import { isCompositorAntialiasEnabled } from "@/services/renderer/compositor/antialias-setting";


/**
 * Clamp beauty RGB to [0,1] before UnrealBloom / DeepGlow when OutputPass is NoToneMapping.
 * Parity with editor PostProcessStack LdrPreBloomClampPass.
 */
class LdrPreBloomClampPass extends Pass {
	uniforms: { tDiffuse: { value: THREE.Texture | null } };
	material: THREE.ShaderMaterial;
	_fsQuad: FullScreenQuad;

	constructor() {
		super();
		this.needsSwap = true;
		this.uniforms = { tDiffuse: { value: null } };
		this.material = new THREE.ShaderMaterial({
			name: "LdrPreBloomClampPass",
			uniforms: this.uniforms,
			vertexShader: /* glsl */ `
				varying vec2 vUv;
				void main() {
					vUv = uv;
					gl_Position = vec4(position.xy, 0.0, 1.0);
				}
			`,
			fragmentShader: /* glsl */ `
				uniform sampler2D tDiffuse;
				varying vec2 vUv;
				void main() {
					vec4 c = texture2D(tDiffuse, vUv);
					gl_FragColor = vec4(clamp(c.rgb, 0.0, 1.0), c.a);
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
		writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget,
	) {
		this.uniforms.tDiffuse.value = readBuffer.texture;
		renderer.setRenderTarget(this.renderToScreen ? null : writeBuffer);
		this._fsQuad.render(renderer);
	}

	dispose() {
		this.material.dispose();
		this._fsQuad.dispose();
	}
}

export type BuiltPostProcess = {
	composer: EffectComposer;
	bindings: Array<{ entryId: string; type: string; passes: Pass[] }>;
	/** Structure+size+tone signature for rebuild-vs-reuse (P1 cache). */
	signature: string;
	/**
	 * Mutable createPasses ctx shared with custom effects — update
	 * `__fccBeautyTexture` each frame for `$camera` (below composite).
	 */
	customCtx?: import("./custom-pass").CreatePassesCtx;
	dispose: () => void;
};

/** Stable signature for pack PP composer cache. */
export function packComposerSignature({
	stack,
	width,
	height,
	outputToneMapping,
	outputExposure,
	transparentClear,
}: {
	stack: PostProcessStackData;
	width: number;
	height: number;
	outputToneMapping: THREE.ToneMapping;
	outputExposure: number;
	transparentClear?: boolean;
}): string {
	// Structure only - NOT live params. K-framed bloom strength/radius/threshold
	// must update uniforms in place (applyPackComposerParams); including params
	// here rebuilds EffectComposer every frame and stalls play/scrub.
	return JSON.stringify({
		w: Math.max(1, Math.floor(width)),
		h: Math.max(1, Math.floor(height)),
		tm: outputToneMapping,
		exp: outputExposure,
		tc: !!transparentClear,
		enabled: stack.enabled !== false,
		effects: (stack.effects || []).map((e) => ({
			id: e?.id,
			type: e?.type,
			enabled: e?.enabled !== false,
		})),
	});
}

registerBuiltinPostEffects();

/** Half-float MSAA is needed so Bloom still sees HDR. Probe once; RGBA16F multisample is not universal. */
let halfFloatMsaa: boolean | null = null;

function halfFloatMsaaSupported(
	renderer: THREE.WebGLRenderer,
	samples: number,
): boolean {
	if (halfFloatMsaa !== null) return halfFloatMsaa;
	const probe = new THREE.WebGLRenderTarget(4, 4, {
		type: THREE.HalfFloatType,
		samples,
	});
	renderer.initRenderTarget(probe);
	const gl = renderer.getContext() as WebGL2RenderingContext;
	const props = renderer.properties.get(probe) as {
		__webglMultisampledFramebuffer?: WebGLFramebuffer;
	};
	const fb = props.__webglMultisampledFramebuffer;
	let ok = false;
	if (fb) {
		const state = renderer.state as unknown as {
			bindFramebuffer: (
				target: number,
				framebuffer: WebGLFramebuffer | null,
			) => void;
		};
		state.bindFramebuffer(gl.FRAMEBUFFER, fb);
		ok = gl.checkFramebufferStatus(gl.FRAMEBUFFER) === gl.FRAMEBUFFER_COMPLETE;
		state.bindFramebuffer(gl.FRAMEBUFFER, null);
	}
	probe.dispose();
	halfFloatMsaa = ok;
	return ok;
}

function mergeLiveParams({
	stack,
	exposed,
	liveParams,
}: {
	stack: PostProcessStackData;
	exposed: ExposedParam[];
	liveParams?: ParamValues | null;
}): PostProcessStackData {
	const effects = (stack.effects || []).map((e) => ({
		...e,
		params: { ...(e.params || {}) },
	}));
	if (liveParams) {
		for (const exp of exposed) {
			if (exp.scope !== "postProcess" || !exp.effectId || !exp.key) continue;
			if (liveParams[exp.id] === undefined) continue;
			const entry = effects.find((x) => x.id === exp.effectId);
			if (!entry) continue;
			entry.params = entry.params || {};
			entry.params[exp.key] = liveParams[exp.id] as
				| number
				| boolean
				| string
				| number[];
		}
	}
	return { ...stack, effects };
}

export function buildPackComposer({
	renderer,
	scene,
	camera,
	width,
	height,
	stack,
	exposed,
	liveParams,
	outputToneMapping: optsOutputToneMapping,
	outputExposure: optsOutputExposure,
	transparentClear = false,
	resolveAssetUrl,
	beautyTexture = null,
}: {
	renderer: THREE.WebGLRenderer;
	scene: THREE.Scene;
	camera: THREE.Camera;
	width: number;
	height: number;
	stack: PostProcessStackData;
	exposed: ExposedParam[];
	liveParams?: ParamValues | null;
	/** Override OutputPass tone mapping (e.g. NoToneMapping for UI text packs). */
	outputToneMapping?: THREE.ToneMapping;
	outputExposure?: number;
	/** BeautyClear Default: RenderPass clear alpha 0 (keep empty see-through). */
	transparentClear?: boolean;
	/** Pack-relative path → blob/http URL for custom-effect textures. */
	resolveAssetUrl?: (path: string) => string | null;
	/**
	 * Seed for custom-effect `$camera` (filter/effect: below-track composite).
	 * Kept on BuiltPostProcess.customCtx so callers can refresh each frame.
	 */
	beautyTexture?: THREE.Texture | null;
}): BuiltPostProcess | null {
	registerCustomEffectsFromStack(stack);
	if (!stackHasEnabledEffects(stack)) return null;

		const liveStack = mergeLiveParams({ stack, exposed, liveParams });
	const w = Math.max(1, Math.floor(width));
	const h = Math.max(1, Math.floor(height));

	// Tone mapping ONLY in OutputPass, and only the caller's setting.
	// NoToneMapping stays NoToneMapping (sRGB encode still runs).
	// Never force ACESFilmic here — that washed text-anim bloom (惨白) vs editor.
	const outputToneMapping =
		optsOutputToneMapping !== undefined
			? optsOutputToneMapping
			: renderer.toneMapping;
	const outputExposure =
		optsOutputExposure !== undefined
			? optsOutputExposure
			: renderer.toneMappingExposure > 0
				? renderer.toneMappingExposure
				: 1;

	const maxSamples = isCompositorAntialiasEnabled()
		? (renderer.capabilities?.maxSamples ?? 0)
		: 0;
	const samples = maxSamples > 1 ? Math.min(4, maxSamples) : 0;
	let composer: EffectComposer;
	if (samples > 1 && halfFloatMsaaSupported(renderer, samples)) {
		const beauty = new THREE.WebGLRenderTarget(w, h, {
			type: THREE.HalfFloatType,
			samples,
		});
		composer = new EffectComposer(renderer, beauty);
		// Only the beauty pass needs MSAA. Later fullscreen passes stay single-sample.
		composer.renderTarget2.samples = 0;
	} else {
		composer = new EffectComposer(renderer);
	}
	composer.setSize(w, h);
	composer.setPixelRatio(1);
	composer.renderToScreen = false;

	composer.addPass(new RenderPass(scene, camera));
	const renderPass = composer.passes[0] as RenderPass;
	if (transparentClear) {
		renderPass.clearColor = new THREE.Color(0x000000);
		renderPass.clearAlpha = 0;
	}

	const latePasses: Pass[] = [];
	const bindings: BuiltPostProcess["bindings"] = [];
	const useLdrBloom = outputToneMapping === THREE.NoToneMapping;
	let ldrClampInserted = false;
	// Shared with custom-effect closures — mutate __fccBeautyTexture each frame.
	const customCtx: import("./custom-pass").CreatePassesCtx = {
		width: w,
		height: h,
		resolveAssetUrl,
		scene,
		__fccBeautyTexture: beautyTexture ?? null,
	};

	for (const entry of liveStack.effects || []) {
		if (!entry || entry.enabled === false) continue;
		const desc = getEffectDescriptor(entry.type);
		if (!desc) continue;
		const params = { ...desc.createDefaultParams(), ...(entry.params || {}) };
		const isCustom =
			typeof entry.type === "string" && entry.type.startsWith("custom:");
		// Keep textureBindings object identity — resolveInput closes over it.
		if (isCustom && !entry.textureBindings) entry.textureBindings = {};
		// Prototype-link to customCtx so per-frame `__fccBeautyTexture` updates
		// reach `$camera` closures, while each entry keeps its own textureBindings.
		const passCtx = Object.assign(Object.create(customCtx) as import("./custom-pass").CreatePassesCtx, {
			...(isCustom
				? { __fccTextureBindings: entry.textureBindings || {} }
				: {}),
		});
		const passes = desc.createPasses(passCtx) || [];
		desc.applyParams(passes, params);
		bindings.push({ entryId: entry.id, type: entry.type, passes });
		for (const pass of passes) {
			pass.enabled = true;
			if (entry.type === "fxaa") {
				latePasses.push(pass);
			} else {
				if (
					useLdrBloom &&
					!ldrClampInserted &&
					(entry.type === "bloom" || entry.type === "deepGlow")
				) {
					composer.addPass(new LdrPreBloomClampPass());
					ldrClampInserted = true;
				}
				composer.addPass(pass);
			}
		}
	}

	const outputPass = new OutputPass();
	// CRITICAL (Default / transparent beauty): stock OutputPass uses NormalBlending
	// and clear=false. Empty pixels (a=0) then leave the uncleared writeBuffer
	// (often opaque black) → full black plate after pack-PP. ShaderPass sets
	// NoBlending; OutputPass must too so tone-mapped texels replace the buffer.
	const outMat = outputPass.material as THREE.ShaderMaterial;
	outMat.blending = THREE.NoBlending;
	outMat.transparent = false;
	outMat.depthTest = false;
	outMat.depthWrite = false;
	const _outputRender = outputPass.render.bind(outputPass);
	outputPass.render = function (
		rendererArg: THREE.WebGLRenderer,
		writeBuffer: THREE.WebGLRenderTarget,
		readBuffer: THREE.WebGLRenderTarget,
		deltaTime: number,
		maskActive: boolean,
	) {
		const prevTM = rendererArg.toneMapping;
		const prevExp = rendererArg.toneMappingExposure;
		const prevCS = rendererArg.outputColorSpace;
		rendererArg.toneMapping = outputToneMapping;
		rendererArg.toneMappingExposure = outputExposure;
		// none: no tone-map AND no sRGB transfer — match overlay working-space bytes
		// that clip present shows as-is. Neutral/ACES keep renderer.outputColorSpace
		// (usually sRGB) so OutputPass still encodes after the filmic curve.
		if (outputToneMapping === THREE.NoToneMapping) {
			// LinearSRGB: no sRGB OETF in OutputPass, and safe for renderer
			// outputColorSpace setter (NoColorSpace is not in ColorManagement.spaces).
			rendererArg.outputColorSpace = THREE.LinearSRGBColorSpace;
		}
		_outputRender(rendererArg, writeBuffer, readBuffer, deltaTime, maskActive);
		rendererArg.toneMapping = prevTM;
		rendererArg.toneMappingExposure = prevExp;
		rendererArg.outputColorSpace = prevCS;
	};
	composer.addPass(outputPass);
	for (const late of latePasses) composer.addPass(late);

	const signature = packComposerSignature({
		stack: liveStack,
		width: w,
		height: h,
		outputToneMapping,
		outputExposure,
		transparentClear,
	});

	return {
		composer,
		bindings,
		signature,
		customCtx,
		dispose: () => {
			try {
				composer.dispose();
			} catch {
				/* ignore */
			}
		},
	};
}

/**
 * Update an existing pack PP composer in place: pass params + RenderPass scene/camera.
 * Call on cache hit when only bloom/param values changed (signature is structure-only).
 */
export function applyPackComposerParams({
	built,
	stack,
	exposed = [],
	liveParams,
	scene,
	camera,
	beautyTexture,
}: {
	built: BuiltPostProcess;
	stack: PostProcessStackData;
	exposed?: ExposedParam[];
	liveParams?: ParamValues | null;
	scene?: THREE.Object3D | THREE.Scene | null;
	camera?: THREE.Camera | null;
	/** Refresh `$camera` source (below composite) without rebuilding the composer. */
	beautyTexture?: THREE.Texture | null;
}) {
	if (built.customCtx && beautyTexture !== undefined) {
		built.customCtx.__fccBeautyTexture = beautyTexture;
	}
	const liveStack = mergeLiveParams({ stack, exposed, liveParams });
	for (const binding of built.bindings) {
		const entry = (liveStack.effects || []).find((e) => e && e.id === binding.entryId);
		if (!entry || entry.enabled === false) {
			for (const pass of binding.passes) pass.enabled = false;
			continue;
		}
		const desc = getEffectDescriptor(binding.type);
		if (!desc) continue;
		const params = { ...desc.createDefaultParams(), ...(entry.params || {}) };
		desc.applyParams(binding.passes, params);
		for (const pass of binding.passes) pass.enabled = true;
	}
	const rp = built.composer.passes[0] as RenderPass | undefined;
	if (rp) {
		if (scene) rp.scene = scene as THREE.Scene;
		if (camera) rp.camera = camera;
	}
}

/** Apply live exposed params onto materials (uniforms / color / opacity). */
export function applyExposedMaterialParams({
	materialsByUuid,
	exposed,
	liveParams,
}: {
	materialsByUuid: Map<string, THREE.Material>;
	exposed: ExposedParam[];
	liveParams?: ParamValues | null;
}) {
	if (!liveParams) return;
	for (const exp of exposed) {
		if (exp.scope !== "material") continue;
		if (liveParams[exp.id] === undefined) continue;
		const uuid = exp.materialUuid;
		if (!uuid) continue;
		const mat = materialsByUuid.get(uuid) as THREE.Material & {
			color?: THREE.Color;
			opacity?: number;
			uniforms?: Record<string, { value: unknown }>;
		};
		if (!mat) continue;
		const val = liveParams[exp.id];
		const key = exp.uniform || exp.key;
		if (!key) continue;
		if (mat.uniforms && key in mat.uniforms) {
			const u = mat.uniforms[key];
			if (u && typeof u === "object" && "value" in u) {
				if (typeof val === "string" && (u.value as THREE.Color)?.isColor) {
					(u.value as THREE.Color).set(val);
				} else {
					u.value = val;
				}
			}
			continue;
		}
		if (key === "color" && mat.color && typeof val === "string") {
			mat.color.set(val);
			continue;
		}
		if (key === "opacity" && typeof mat.opacity === "number" && typeof val === "number") {
			mat.opacity = val;
			mat.transparent = val < 1;
			continue;
		}
		if (key in mat) {
			(mat as unknown as Record<string, unknown>)[key] = val;
		}
	}
}

function writeTextKey(
	ui: Record<string, unknown>,
	key: string,
	val: number | boolean | string,
	_type?: string,
) {
	if (key === "color" && typeof val === "string") {
		ui.color = val;
		return;
	}
	if (key === "text" || key === "content") {
		ui.text = String(val);
		return;
	}
	if (key === "fontSize" && typeof val === "number") {
		ui.fontSize = val;
		return;
	}
	if (key === "opacity" && typeof val === "number") {
		ui.opacity = val;
		return;
	}
	ui[key] = val;
}

export function applyExposedTextParams({
	objectsByUuid,
	exposed,
	liveParams,
}: {
	objectsByUuid: Map<string, THREE.Object3D>;
	exposed: ExposedParam[];
	liveParams?: ParamValues | null;
}) {
	if (!liveParams) return;
	const touched = new Set<THREE.Object3D>();
	for (const exp of exposed) {
		if (exp.scope !== "text" || !exp.objectUuid || !exp.key) continue;
		if (liveParams[exp.id] === undefined) continue;
		const obj = objectsByUuid.get(exp.objectUuid);
		const ui = (obj?.userData as { fccUI?: Record<string, unknown> } | undefined)?.fccUI;
		if (!obj || !ui || ui.type !== "text") continue;
		writeTextKey(ui, exp.key, liveParams[exp.id] as number | boolean | string, exp.type);
		touched.add(obj);
	}
	for (const obj of touched) {
		const sync = (obj.userData as { __fccSyncText?: (r?: { w: number; h: number }) => void })
			.__fccSyncText;
		if (sync) sync();
	}
}

export type BuiltTextureFx = {
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
		rt: 'HalfFloat',
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
		resolveAssetUrl,
	}: {
		renderer: THREE.WebGLRenderer;
		inputTexture: THREE.Texture;
		width: number;
		height: number;
		stack: PostProcessStackData;
		resolveAssetUrl?: (path: string) => string | null;
	}): BuiltTextureFx | null {
		registerBuiltinPostEffects();
		registerCustomEffectsFromStack(stack);
		const normalized = normalizeEffectStack(stack);
		if (!stackHasEnabledEffects(normalized)) return null;

		const w = Math.max(1, Math.floor(width));
		const h = Math.max(1, Math.floor(height));

		// HalfFloat: UnrealBloom soft falloff bands hard in UnsignedByte ping-pong.
		const rt = new THREE.WebGLRenderTarget(w, h, {
			type: THREE.HalfFloatType,
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
		const ctx = { width: w, height: h, resolveAssetUrl };

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

	const signature = textureFxSignature(normalized, w, h);

	return {
		composer,
		bindings,
		signature,
		inputPass,
		getOutputTexture: () => {
			const tex = (
				composer as unknown as { readBuffer?: THREE.WebGLRenderTarget }
			).readBuffer?.texture;
			if (tex) tex.colorSpace = THREE.SRGBColorSpace;
			return tex ?? null;
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
		resolveAssetUrl,
	}: {
		renderer: THREE.WebGLRenderer;
		inputTexture: THREE.Texture;
		width: number;
		height: number;
		stack: PostProcessStackData | null | undefined;
		cache?: TextureFxCache;
		resolveAssetUrl?: (path: string) => string | null;
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
				resolveAssetUrl,
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
