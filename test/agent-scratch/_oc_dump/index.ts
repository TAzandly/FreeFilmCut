export type {
	LoadedVfxPack,
	VfxManifest,
	VfxSceneFile,
	VfxPackType,
	VfxPackScope,
	PrimaryVfxPackType,
} from "@/vfxpack/types";
export { loadVfxPackFromFile, revokePackObjectUrls } from "@/vfxpack/load-pack";
export {
	usePackRegistry,
	getPackRegistrySnapshot,
	subscribePackRegistry,
} from "@/vfxpack/pack-registry";
export {
	buildPackScene,
	disposeBuiltPackScene,
	type BuiltPackScene,
} from "@/vfxpack/scene-builder";
export {
	VFXPACK_EFFECT_PREFIX,
	VFXPACK_SCENE_SHADER,
	toVfxPackEffectType,
	isVfxPackEffectType,
	parseVfxPackIdFromEffectType,
} from "@/vfxpack/effect-id";
export {
	PRIMARY_VFX_PACK_TYPES,
	VFX_PACK_TYPE_LABELS,
	VFX_PACK_TYPE_ORDER,
	normalizeVfxPackType,
	getVfxPackPlacement,
	type VfxPackPlacement,
} from "@/vfxpack/pack-placement";
export {
	BELOW_INPUT_UNIFORM_NAMES,
	BELOW_INPUT_PREFERRED,
	isBelowInputUniformName,
	packNeedsBelowInput,
	detectBelowInputNamesInGlsl,
	ensureBelowInputUniforms,
} from "@/vfxpack/below-input";

export {
	normalizeExposedParams,
	exposedParamsToParamDefinitions,
	buildDefaultExposedParamValues,
	type ExposedParam,
} from "@/vfxpack/exposed-params";
export {
	buildPackComposer,
	applyExposedMaterialParams,
	stackHasEnabledEffects,
	type PostProcessStackData,
	type BuiltPostProcess,
} from "@/vfxpack/postprocess";

export {
	GLOBAL_SCREEN_UNIFORM_NAMES,
	ensureGlobalScreenUniforms,
	applyGlobalScreenParams,
	applyGlobalScreenParamsToObject3D,
} from "@/vfxpack/global-screen-params";

export {
	applyAnimToRoot,
	mapAnimTime,
	normalizeAnim,
	sampleKeys,
	type FreecapcutAnimClip,
	type ApplyAnimOptions,
} from "@/vfxpack/freecapcut-anim";
