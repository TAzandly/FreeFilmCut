import { generateUUID } from "@/utils/id";
import { buildDefaultParamValues } from "@/params/registry";
import { effectsRegistry } from "./registry";
import type { ParamValues } from "@/params";
import type { Effect, EffectDefinition, EffectPass } from "@/effects/types";
import { VISUAL_ELEMENT_TYPES } from "@/timeline";
import {
	isVfxPackEffectType,
	VFXPACK_SCENE_SHADER,
} from "@/vfxpack/effect-id";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import {
	normalizeExposedParams,
	buildDefaultExposedParamValues,
} from "@/vfxpack/exposed-params";

export { effectsRegistry } from "./registry";
export { registerDefaultEffects } from "./definitions";

export function resolveEffectPasses({
	definition,
	effectParams,
	width,
	height,
}: {
	definition: EffectDefinition;
	effectParams: ParamValues;
	width: number;
	height: number;
}): EffectPass[] {
	if (definition.renderer.buildPasses) {
		return definition.renderer.buildPasses({ effectParams, width, height });
	}
	return definition.renderer.passes.map((pass) => ({
		shader: pass.shader,
		uniforms: pass.uniforms({ effectParams, width, height }),
	}));
}

export const EFFECT_TARGET_ELEMENT_TYPES = VISUAL_ELEMENT_TYPES;

export function buildDefaultEffectInstance({
	effectType,
}: {
	effectType: string;
}): Effect {
	if (isVfxPackEffectType({ effectType })) {
		const packId = effectType.slice("vfxpack:".length);
		const pack = getPackRegistrySnapshot().packs.find((p) => p.id === packId);
		const exposed = normalizeExposedParams({
			manifest: pack?.manifest,
			scene: pack?.scene ?? null,
		});
		return {
			id: generateUUID(),
			type: effectType,
			params: buildDefaultExposedParamValues({ exposed }),
			enabled: true,
		};
	}

	const definition = effectsRegistry.get(effectType);
	const params: ParamValues = buildDefaultParamValues(definition.params);

	return {
		id: generateUUID(),
		type: effectType,
		params,
		enabled: true,
	};
}

/** Sentinel pass so FrameDescriptor keeps the effect slot for Three compositor. */
export function buildVfxPackEffectPasses(): EffectPass[] {
	return [{ shader: VFXPACK_SCENE_SHADER, uniforms: {} }];
}
