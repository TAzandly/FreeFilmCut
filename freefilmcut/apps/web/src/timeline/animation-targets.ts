import type {
	AnimationInterpolation,
	AnimationPath,
	NumericSpec,
} from "@/animation/types";
import {
	parseEffectParamPath,
} from "@/animation/effect-param-channel";
import {
	parseGraphicParamPath,
} from "@/animation/graphic-param-channel";
import { effectsRegistry, registerDefaultEffects } from "@/effects";
import { getGraphicDefinition } from "@/graphics";
import {
	coerceParamValue,
	getParamDefaultInterpolation,
	getParamChannelLayout,
	getParamNumericRange,
	type ParamChannelLayout,
	type ParamDefinition,
	type ParamValue,
	type ParamValues,
} from "@/params";
import {
	getCanvasTransformParams,
	getElementParam,
} from "@/params/registry";
import { isStickerPackEffectElement } from "@/vfxpack/sticker-canvas";
import type { TimelineElement } from "@/timeline";
import { isVisualElement } from "@/timeline/element-utils";
import {
	isVfxPackEffectType,
	parseVfxPackIdFromEffectType,
} from "@/vfxpack/effect-id";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import {
	normalizeExposedParams,
	exposedParamsToParamDefinitions,
} from "@/vfxpack/exposed-params";

export interface AnimationPathDescriptor {
	channelLayout: ParamChannelLayout;
	defaultInterpolation: AnimationInterpolation;
	numericRanges?: Partial<Record<string, NumericSpec>>;
	coerceValue: ({ value }: { value: ParamValue }) => ParamValue | null;
	getBaseValue: () => ParamValue | null;
	setBaseValue: ({ value }: { value: ParamValue }) => TimelineElement;
}

// Leaf params expose a single component named "value". Composite params don't
// carry numeric ranges yet — revisit when one does.
function paramNumericRanges({
	param,
}: {
	param: ParamDefinition;
}): Partial<Record<string, NumericSpec>> | undefined {
	const range = getParamNumericRange({ param });
	return range ? { value: range } : undefined;
}

function buildParamDescriptor({
	param,
	baseParams,
	setParams,
}: {
	param: ParamDefinition;
	baseParams: ParamValues;
	setParams: (params: ParamValues) => TimelineElement;
}): AnimationPathDescriptor | null {
	if (param.keyframable === false) {
		return null;
	}

	return {
		channelLayout: getParamChannelLayout({ param }),
		defaultInterpolation: getParamDefaultInterpolation({ param }),
		numericRanges: paramNumericRanges({ param }),
		coerceValue: ({ value }) => coerceParamValue({ param, value }),
		getBaseValue: () => baseParams[param.key] ?? param.default,
		setBaseValue: ({ value }) => {
			const coercedValue = coerceParamValue({ param, value });
			if (coercedValue === null) {
				return setParams(baseParams);
			}

			return setParams({
				...baseParams,
				[param.key]: coercedValue,
			});
		},
	};
}

function buildElementParamDescriptor({
	element,
	paramKey,
}: {
	element: TimelineElement;
	paramKey: string;
}): AnimationPathDescriptor | null {
	const param = getElementParam({ element, key: paramKey });
	if (!param) {
		return null;
	}

	return buildParamDescriptor({
		param,
		baseParams: element.params,
		setParams: (params) => ({
			...element,
			params,
		}),
	});
}

function buildGraphicParamDescriptor({
	element,
	paramKey,
}: {
	element: TimelineElement;
	paramKey: string;
}): AnimationPathDescriptor | null {
	if (element.type !== "graphic") {
		return null;
	}

	const definition = getGraphicDefinition({
		definitionId: element.definitionId,
	});
	const param = definition.params.find((candidate) => candidate.key === paramKey);
	if (!param) {
		return null;
	}

	return buildParamDescriptor({
		param,
		baseParams: element.params,
		setParams: (params) => ({
			...element,
			params,
		}),
	});
}


function getVfxPackExposedParamDefinition({
	effectType,
	paramKey,
}: {
	effectType: string;
	paramKey: string;
}): ParamDefinition | null {
	if (!isVfxPackEffectType({ effectType })) {
		return null;
	}
	const packId = parseVfxPackIdFromEffectType({ effectType });
	if (!packId) {
		return null;
	}
	const pack = getPackRegistrySnapshot().packs.find((p) => p.id === packId);
	if (!pack) {
		return null;
	}
	const exposed = normalizeExposedParams({
		manifest: pack.manifest,
		scene: pack.scene ?? null,
	});
	const defs = exposedParamsToParamDefinitions({ exposed });
	return defs.find((candidate) => candidate.key === paramKey) ?? null;
}

function buildVfxPackStandaloneParamDescriptor({
	element,
	paramKey,
}: {
	element: TimelineElement;
	paramKey: string;
}): AnimationPathDescriptor | null {
	if (element.type !== "effect") {
		return null;
	}
	if (isStickerPackEffectElement(element)) {
		const transformParam =
			getCanvasTransformParams().find((candidate) => candidate.key === paramKey) ??
			null;
		if (transformParam) {
			return buildParamDescriptor({
				param: transformParam,
				baseParams: element.params,
				setParams: (params) => ({
					...element,
					params,
				}),
			});
		}
	}
	const param = getVfxPackExposedParamDefinition({
		effectType: element.effectType,
		paramKey,
	});
	if (param) {
		return buildParamDescriptor({
			param,
			baseParams: element.params,
			setParams: (params) => ({
				...element,
				params,
			}),
		});
	}
	return null;
}

function buildEffectParamDescriptor({
	element,
	effectId,
	paramKey,
}: {
	element: TimelineElement;
	effectId: string;
	paramKey: string;
}): AnimationPathDescriptor | null {
	if (!isVisualElement(element)) {
		return null;
	}

	const effect = element.effects?.find((candidate) => candidate.id === effectId);
	if (!effect) {
		return null;
	}

	let param: ParamDefinition | null = null;
	if (isVfxPackEffectType({ effectType: effect.type })) {
		param = getVfxPackExposedParamDefinition({
			effectType: effect.type,
			paramKey,
		});
	} else {
		registerDefaultEffects();
		const definition = effectsRegistry.get(effect.type);
		param =
			definition.params.find((candidate) => candidate.key === paramKey) ?? null;
	}
	if (!param) {
		return null;
	}

	return buildParamDescriptor({
		param,
		baseParams: effect.params,
		setParams: (params) => ({
			...element,
			effects:
				element.effects?.map((candidate) =>
					candidate.id !== effectId
						? candidate
						: {
								...candidate,
								params,
							},
				) ?? element.effects,
		}),
	});
}

export function resolveAnimationTarget({
	element,
	path,
}: {
	element: TimelineElement;
	path: AnimationPath;
}): AnimationPathDescriptor | null {
	const elementParamTarget = buildElementParamDescriptor({
		element,
		paramKey: path,
	});
	if (elementParamTarget) {
		return elementParamTarget;
	}

	const vfxStandaloneTarget = buildVfxPackStandaloneParamDescriptor({
		element,
		paramKey: path,
	});
	if (vfxStandaloneTarget) {
		return vfxStandaloneTarget;
	}

	const graphicParamTarget = parseGraphicParamPath({ propertyPath: path });
	if (graphicParamTarget) {
		return buildGraphicParamDescriptor({
			element,
			paramKey: graphicParamTarget.paramKey,
		});
	}

	const effectParamTarget = parseEffectParamPath({ propertyPath: path });
	if (effectParamTarget) {
		return buildEffectParamDescriptor({
			element,
			effectId: effectParamTarget.effectId,
			paramKey: effectParamTarget.paramKey,
		});
	}

	return null;
}
