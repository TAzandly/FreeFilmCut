/** Clip-side textanim: engine + char split + wipe/bend geom fx. */
export {
	normalizeTextAnim,
	ensureTextAnimOnUI,
	sampleTextAnim,
	textAnimNeedsCharSplit,
	sampleWipeRevealProgress,
	sampleBendProgress,
} from "./TextAnim.js";
export {
	applyTextAnim,
	applyTextAnimsInScene,
	clearTextAnimPreview,
	ensureTextAnimPreview,
	assertTextAnimOriginalsHidden,
	FCC_TEXTANIM_ROOT,
	FCC_TEXTANIM_PARK,
} from "./TextAnimRuntime.js";
export { applyTextGeomFxInScene } from "./TextGeomFx.js";
export {
	applyActiveTextAnimPack,
	resolveActiveTextAnimPack,
	sampleUiOnlyPose,
	applyTextPoseToFlowerProps,
} from "./apply-pack";
import "./TextAnimBuiltins.js";
