import * as THREE from "three";
import { FilmPass } from "three/addons/postprocessing/FilmPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { FXAAShader } from "three/addons/shaders/FXAAShader.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { InvertColorPass } from "./invert-pass";
import { DeepGlowPass } from "./deep-glow-pass";
import { BokehGlowPass } from "./bokeh-glow-pass";
import {
	buildCustomEffectDescriptor,
	customEffectTypeId,
	definitionFingerprint,
	type CreatePassesCtx,
	type CustomEffectDefinition,
} from "./custom-pass";
import { BOKEH_GLOW_CUSTOM } from "./presets/bokeh-glow-custom";

const clamp01 = (value: unknown): number =>
	Math.min(1, Math.max(0, Number(value) || 0));
import type { Pass } from "three/addons/postprocessing/Pass.js";

export type CustomEffectTextureBindings = Record<
	string,
	{ rtUuid?: string }
>;

export type PostProcessEffectEntry = {
	id: string;
	type: string;
	enabled?: boolean;
	params?: Record<string, number | boolean | string | number[]>;
	exposed?: Record<string, boolean>;
	/** Custom effect definition (shaders inline). Present for type `custom:<id>`. */
	definition?: CustomEffectDefinition;
	/** Scene RT slots: texName → { rtUuid } (pack scene node uuid). */
	textureBindings?: CustomEffectTextureBindings;
};

export type PostProcessStackData = {
	enabled?: boolean;
	effects: PostProcessEffectEntry[];
};

export type EffectDescriptor = {
	type: string;
	createDefaultParams: () => Record<
		string,
		number | boolean | string | number[]
	>;
	createPasses: (ctx: CreatePassesCtx) => Pass[];
	applyParams: (
		passes: Pass[],
		params: Record<string, number | boolean | string | number[]>,
	) => void;
	paramSchema?: Array<Record<string, unknown>>;
	__customDefinition?: CustomEffectDefinition;
};

const registry = new Map<string, EffectDescriptor>();
const _customFingerprints = new Map<string, string>();

function patchUnrealBloomAlpha(pass: {
	__fccAlphaPatched?: boolean;
	separableBlurMaterials?: Array<{ fragmentShader?: string; needsUpdate?: boolean; toneMapped?: boolean }>;
	compositeMaterial?: { toneMapped?: boolean };
	materialHighPassFilter?: { toneMapped?: boolean };
	blendMaterial?: { toneMapped?: boolean };
	_basic?: { toneMapped?: boolean };
}) {
	if (!pass || pass.__fccAlphaPatched) return;
	pass.__fccAlphaPatched = true;
	const blurReplace = "gl_FragColor = vec4( diffuseSum, 1.0 );";
	const blurFixed = [
		"float srcA = texture2D( colorTexture, vUv ).a;",
		"gl_FragColor = vec4( diffuseSum, srcA );",
	].join("\n\t\t\t\t\t");
	if (pass.separableBlurMaterials) {
		for (const m of pass.separableBlurMaterials) {
			if (m.fragmentShader?.includes(blurReplace)) {
				m.fragmentShader = m.fragmentShader.replace(blurReplace, blurFixed);
				m.needsUpdate = true;
			}
			m.toneMapped = false;
		}
	}
	if (pass.compositeMaterial) pass.compositeMaterial.toneMapped = false;
	if (pass.materialHighPassFilter) pass.materialHighPassFilter.toneMapped = false;
	if (pass.blendMaterial) {
		pass.blendMaterial.toneMapped = false;
		// Additive over beauty: bloom composite already uses a=max(rgb) so empty
		// is (0,0,0,0) and does not lift dst alpha. Keep premul+additive (editor).
	}
	if (pass._basic) pass._basic.toneMapped = false;
}


let registered = false;

export function registerBuiltinPostEffects() {
	if (registered) return;
	registered = true;

	registry.set("bloom", {
		type: "bloom",
		createDefaultParams: () => ({
			strength: 2.0,
			radius: 0.5,
			threshold: 0.0,
		}),
		createPasses: ({ width, height }) => {
			const pass = new UnrealBloomPass(
				new THREE.Vector2(Math.max(1, width), Math.max(1, height)),
				2.0,
				0.5,
				0.0,
			);
			(pass as unknown as { needsSwap: boolean }).needsSwap = false;
			// Keep bloom stages linear (Editor HDR contract); ignore double tone-map.
			const bloom = pass as unknown as {
				materialHighPassFilter?: THREE.ShaderMaterial;
				compositeMaterial?: THREE.ShaderMaterial;
				blendMaterial?: THREE.ShaderMaterial;
				_basic?: THREE.MeshBasicMaterial;
				separableBlurMaterials?: THREE.ShaderMaterial[];
			};
			patchUnrealBloomAlpha(bloom);
			return [pass as unknown as Pass];
		},
		applyParams: (passes, params) => {
			const pass = passes[0] as unknown as {
				strength: number;
				radius: number;
				threshold: number;
			};
			if (!pass) return;
			// strength / radius / threshold only — ignore stale blurIterations from old packs
			if (params.strength !== undefined) pass.strength = Number(params.strength);
			if (params.radius !== undefined) pass.radius = Number(params.radius);
			if (params.threshold !== undefined) pass.threshold = Number(params.threshold);
		},
	});

	registry.set("deepGlow", {
		type: "deepGlow",
		createDefaultParams: () => ({
			intensity: 1.2,
			threshold: 0.0,
			radius: 1.0,
			color: "#ffffff",
		}),
		createPasses: ({ width, height }) => {
			const pass = new DeepGlowPass(
				new THREE.Vector2(Math.max(1, width), Math.max(1, height)),
				1.2,
				0.0,
				1.0,
			);
			return [pass as unknown as Pass];
		},
		applyParams: (passes, params) => {
			const pass = passes[0] as DeepGlowPass;
			if (!pass) return;
			if (params.intensity !== undefined) pass.intensity = Number(params.intensity);
			if (params.threshold !== undefined) pass.threshold = Number(params.threshold);
			if (params.radius !== undefined) pass.radius = Number(params.radius);
			if (params.color !== undefined && pass.glowColor) {
				const v = params.color as string | number[] | { r?: number; g?: number; b?: number };
				if (typeof v === "string") {
					let hex = v.trim();
					if (hex.startsWith("#")) hex = hex.slice(1);
					if (hex.length === 3) {
						hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2];
					}
					const n = parseInt(hex, 16);
					if (Number.isFinite(n)) {
						pass.glowColor.set(
							((n >> 16) & 255) / 255,
							((n >> 8) & 255) / 255,
							(n & 255) / 255,
						);
					}
				} else if (Array.isArray(v) && v.length >= 3) {
					pass.glowColor.set(Number(v[0]) || 0, Number(v[1]) || 0, Number(v[2]) || 0);
				} else if (v && typeof v === "object" && !Array.isArray(v)) {
					const o = v as {
						r?: number;
						g?: number;
						b?: number;
						x?: number;
						y?: number;
						z?: number;
					};
					const r = o.r != null ? o.r : o.x;
					const g = o.g != null ? o.g : o.y;
					const b = o.b != null ? o.b : o.z;
					if (r != null && g != null && b != null) {
						pass.glowColor.set(Number(r), Number(g), Number(b));
					}
				}
			}
		},
	});

	registry.set("bokehGlow", {
		type: "bokehGlow",
		createDefaultParams: () => ({
			size: 1.0,
			number: 0.1,
			intensity: 0.6,
			filter: 0.2,
			timeIntensity: 1.0,
		}),
		createPasses: ({ width, height }) => {
			const pass = new BokehGlowPass(
				new THREE.Vector2(Math.max(1, width), Math.max(1, height)),
			);
			return [pass as unknown as Pass];
		},
		applyParams: (passes, params) => {
			const pass = passes[0] as BokehGlowPass;
			if (!pass) return;
			// Pack slider semantics (ImageBusinessSlider.lua), clamped to 0..1:
			// size→blurIntensity/numIntensity, number→noiseIns/blurIns/horzR,
			// intensity→lightIns(×1.25), filter→filterIns.
			// timeIntensity = CapCut SeekModeScript envelope (0=无光斑, 1=满).
			if (params.size !== undefined) pass.size = clamp01(params.size);
			if (params.number !== undefined) pass.number = clamp01(params.number);
			if (params.intensity !== undefined) {
				pass.intensity = clamp01(params.intensity);
			}
			if (params.filter !== undefined) pass.filter = clamp01(params.filter);
			if (params.timeIntensity !== undefined) {
				pass.timeIntensity = clamp01(params.timeIntensity);
			}
		},
	});

	registry.set("film", {
		type: "film",
		createDefaultParams: () => ({ intensity: 0.35, grayscale: false }),
		createPasses: () => [new FilmPass(0.35, false) as unknown as Pass],
		applyParams: (passes, params) => {
			const pass = passes[0] as unknown as {
				uniforms?: {
					intensity?: { value: number };
					grayscale?: { value: boolean };
				};
			};
			if (!pass?.uniforms) return;
			if (params.intensity !== undefined && pass.uniforms.intensity) {
				pass.uniforms.intensity.value = Number(params.intensity);
			}
			if (params.grayscale !== undefined && pass.uniforms.grayscale) {
				pass.uniforms.grayscale.value = !!params.grayscale;
			}
		},
	});

	registry.set("invert", {
		type: "invert",
		createDefaultParams: () => ({ intensity: 1.0 }),
		createPasses: () => [new InvertColorPass(1.0) as unknown as Pass],
		applyParams: (passes, params) => {
			const pass = passes[0] as InvertColorPass;
			if (!pass?.uniforms) return;
			if (params.intensity !== undefined) {
				pass.uniforms.intensity.value = Math.max(
					0,
					Math.min(1, Number(params.intensity)),
				);
			}
		},
	});

	registry.set("fxaa", {
		type: "fxaa",
		createDefaultParams: () => ({}),
		createPasses: ({ width, height }) => {
			const pass = new ShaderPass(FXAAShader) as unknown as Pass & {
				material: { uniforms: { resolution: { value: THREE.Vector2 } } };
			};
			const res = pass.material?.uniforms?.resolution?.value;
			if (res) res.set(1 / Math.max(1, width), 1 / Math.max(1, height));
			return [pass];
		},
		applyParams: () => {},
	});

	// P4 acceptance: config twin of handwritten `bokehGlow` (keep both for A/B).
	registerCustomEffect(BOKEH_GLOW_CUSTOM);
}

export function getEffectDescriptor(type: string) {
	registerBuiltinPostEffects();
	return registry.get(type) || null;
}

/**
 * Register (or refresh) a custom effect as `custom:<id>`.
 * Idempotent when definition fingerprint is unchanged.
 */
export function registerCustomEffect(
	def: CustomEffectDefinition,
): { ok: boolean; type?: string; error?: string } {
	registerBuiltinPostEffects();
	if (!def?.id) return { ok: false, error: "missing id" };
	const desc = buildCustomEffectDescriptor(def);
	if (!desc) return { ok: false, error: "invalid definition" };
	const fp = definitionFingerprint(def);
	const type = customEffectTypeId(def);
	const prev = _customFingerprints.get(def.id);
	if (prev === fp && registry.has(type)) {
		return { ok: true, type };
	}
	_customFingerprints.set(def.id, fp);
	registry.set(type, desc);
	return { ok: true, type };
}

export function unregisterCustomEffect(id: string) {
	const type = customEffectTypeId(id);
	registry.delete(type);
	_customFingerprints.delete(id);
}

/** Register every definition from pack manifest.customEffects. */
export function loadCustomDefinitions(
	defs: CustomEffectDefinition[] | null | undefined,
): number {
	if (!Array.isArray(defs) || defs.length === 0) return 0;
	let n = 0;
	for (const def of defs) {
		const r = registerCustomEffect(def);
		if (r.ok) n++;
	}
	return n;
}

/** Register custom defs embedded on stack entries (scene postProcess). */
export function registerCustomEffectsFromStack(
	stack: PostProcessStackData | null | undefined,
): number {
	if (!stack || !Array.isArray(stack.effects)) return 0;
	let n = 0;
	for (const entry of stack.effects) {
		if (!entry?.definition || typeof entry.definition !== "object") continue;
		const r = registerCustomEffect(entry.definition);
		if (r.ok) n++;
	}
	return n;
}

export type { CustomEffectDefinition, CreatePassesCtx };

export function stackHasEnabledEffects(
	stack: PostProcessStackData | null | undefined,
) {
	registerBuiltinPostEffects();
	if (!stack || stack.enabled === false) return false;
	return (stack.effects || []).some(
		(e) => e && e.enabled !== false && registry.has(e.type),
	);
}

/**
 * @deprecated Alias of enabled+registered check. Kept so older imports compile.
 * Do NOT gate Bloom on strength~=0 — keep the pass in the stack; fix color-space instead.
 */
export function effectContributes(
	entry: PostProcessEffectEntry | null | undefined,
): boolean {
	if (!entry || entry.enabled === false) return false;
	registerBuiltinPostEffects();
	return registry.has(entry.type);
}

/** @deprecated Use stackHasEnabledEffects. */
export function stackHasContributingEffects(
	stack: PostProcessStackData | null | undefined,
) {
	return stackHasEnabledEffects(stack);
}

export function normalizeEffectStack(
	stack: PostProcessStackData | null | undefined,
): PostProcessStackData {
	if (!stack || typeof stack !== "object") {
		return { enabled: true, effects: [] };
	}
	const effects = Array.isArray(stack.effects) ? stack.effects : [];
	return {
		enabled: stack.enabled !== false,
		effects,
	};
}

/** Text Fx uses the same stack shape; store on fccUI.textFxStack / timeline props. */
export function ensureTextFxStack(
	stack: PostProcessStackData | null | undefined,
): PostProcessStackData {
	return normalizeEffectStack(stack ?? { enabled: true, effects: [] });
}

export function listEffectTypes(): string[] {
	registerBuiltinPostEffects();
	return Array.from(registry.keys());
}

