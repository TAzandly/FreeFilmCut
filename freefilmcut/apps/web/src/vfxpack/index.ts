import "@/vfxpack/troika-preconfig";
export type {
	LoadedVfxPack,
	VfxManifest,
	VfxSceneFile,
	VfxPackType,
	VfxPackScope,
	PrimaryVfxPackType,
} from "@/vfxpack/types";
export { loadVfxPackFromFile, revokePackObjectUrls } from "@/vfxpack/load-pack";
export { importVfxPackFiles } from "@/vfxpack/import-vfxpack-files";
export {
	persistUserVfxPackFile,
	loadPersistedUserVfxPacks,
	removePersistedUserVfxPack,
} from "@/vfxpack/persisted-user-packs";
export {
	usePackRegistry,
	getPackRegistrySnapshot,
	subscribePackRegistry,
	onPackRegistered,
} from "@/vfxpack/pack-registry";
export {
	buildPackScene,
	disposeBuiltPackScene,
	ensureBuiltPackDefaultEnvironment,
	PACK_SCENE_BUILD_REV,
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
	TRANSITION_FROM_UNIFORM_NAMES,
	TRANSITION_TO_UNIFORM_NAMES,
	TRANSITION_FROM_PREFERRED,
	TRANSITION_TO_PREFERRED,
	isTransitionFromUniformName,
	isTransitionToUniformName,
	listTransitionFromUniforms,
	listTransitionToUniforms,
	bindTransitionInputTextures,
	materialWantsSamplerUvFlip,
} from "@/vfxpack/transition-input";

export {
	normalizeTransitionFitMode,
	authoredAspectFromResolution,
	type TransitionFitMode,
} from "@/vfxpack/transition-fit-mode";

export {
	normalizeExposedParams,
	exposedParamsToParamDefinitions,
	buildDefaultExposedParamValues,
	type ExposedParam,
} from "@/vfxpack/exposed-params";
export {
	buildPackComposer,
	packComposerSignature,
	applyPackComposerParams,
	buildTextureFxComposer,
	renderTextureFx,
	applyExposedMaterialParams,
	applyExposedTextParams,
	stackHasEnabledEffects,
	effectContributes,
	stackHasContributingEffects,
	normalizeEffectStack,
	ensureTextFxStack,
	type PostProcessStackData,
	type BuiltPostProcess,
	type BuiltTextureFx,
	type TextureFxCache,
} from "@/vfxpack/postprocess";

export {
	GLOBAL_SCREEN_UNIFORM_NAMES,
	ensureGlobalScreenUniforms,
	applyGlobalScreenParams,
	applyGlobalScreenParamsToObject3D,
} from "@/vfxpack/global-screen-params";

export {
	getVfxPackElementDuration,
	resolveVfxPackDurationSeconds,
} from "@/vfxpack/duration";

export {
	samplePackTimeline,
	timelineAssetHasVideoTracks,
	TIMELINE_FORMAT,
	type TimelineAsset,
	type TimelineTrack,
	type TimelineTrackClip,
	type SeekPackTimelineVideo,
} from "@/vfxpack/timeline";

export {
	applyAnimToRoot,
	mapAnimTime,
	normalizeAnim,
	sampleKeys,
	type FreecapcutAnimClip,
	type ApplyAnimOptions,
} from "@/vfxpack/freecapcut-anim";


export {
	FLOWER_PRESETS,
	FLOWER_STYLE_VERSION,
	JIANYING_7645_PACK_ID,
	createJianying7645FlowerStyle,
	createDefaultFlowerStyle,
	getEffectiveFlowerStyle,
	normalizeFlowerStyle,
	normalizeFillContent,
	normalizeUvMode,
	uvModeToPerCharUniform,
	remapFlowerStyleTexturePathsForOpenCut,
	getFlowerPreset,
	type FlowerStyle,
	type FillContent,
	type FccUvMode,
} from "@/vfxpack/flower-style";

export {
	listBuiltinTextTemplates,
	applyFlowerPresetToTextElement,
	FLOWER_EFFECT_DEFAULT_CONTENT,
	FLOWER_EFFECT_DEFAULT_FONT_SIZE,
	FLOWER_STROKE_LOG_PREFIX,
	isFlowerStrokeDebugEnabled,
	logFlowerStyleStrokes,
	applyFlowerPresetToTextParams,
	resolveTimelineFlowerTextProps,
	buildSyntheticFlowerTextPack,
	TIMELINE_FLOWER_TEXT_PACK_PREFIX,
} from "@/vfxpack/timeline-flower-text";

export {
	loadFlowerPackCatalog,
	getFlowerPackPresetsSnapshot,
	getFlowerPackPreset,
	invalidateFlowerPackCatalog,
	bindStyleToPackDir,
	extractFlowerStyleFromVfxpackBytes,
	FLOWER_CATALOG_REV,
} from "@/vfxpack/flower-pack-catalog";

export {
	buildTextTemplateApply,
	ensureEmbeddedTextAnimFromTemplatePack,
	describeTextTemplateApply,
	resolveTextTemplatePayload,
	synthesizeTextTemplateFromScene,
	isTextTemplateClip,
	type TextTemplateApplyResult,
} from "@/vfxpack/apply-text-template";

export {
	prepareTextTemplateMediaOnRoot,
	driveTextTemplateMedia,
	driveTextTemplateMediaForExport,
	bindLiveMediaToStickers,
	disposeTextTemplateMedia,
	type TextTemplateMediaPlayerSpec,
} from "@/vfxpack/text-template-media";
export {
	applyTextStickersInScene,
	applyTextStickers,
	sceneHasFrontTextStickers,
	normalizeTextSticker,
	stickerPoseXform,
	setTextStickerPackLookup,
	resolveStickerPoseXform,
	setTextStickerFrontRootsVisible,
	withTextContentHiddenExceptFrontStickers,
	FCC_TEXT_STICKERS_ROOT_BEHIND,
	FCC_TEXT_STICKERS_ROOT_FRONT,
} from "@/vfxpack/text-stickers.js";
