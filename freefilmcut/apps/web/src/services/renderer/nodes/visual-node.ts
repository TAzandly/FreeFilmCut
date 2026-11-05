import { BaseNode } from "./base-node";
import type { BackgroundFillSettings } from "@/background/fill";
import type { ChromaKeySettings } from "@/chroma-key";
import type {
	ColorCorrectionSettings,
	ResolvedColorCorrection,
} from "@/color-correction";
import type { ColorGradeSettings } from "@/color-grade";
import type { Effect, EffectPass } from "@/effects/types";
import type { Mask } from "@/masks/types";
import type { BlendMode, Transform } from "@/rendering";
import type { MediaAnimAssignment, RetimeConfig, VisualElement } from "@/timeline";

export interface VisualNodeParams {
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	/** When true, play trimmed source from end→start (orthogonal to retime). */
	reversed?: boolean;
	transform: Transform;
	animations?: VisualElement["animations"];
	opacity: number;
	blendMode?: BlendMode;
	effects?: Effect[];
	masks?: Mask[];
	/** Base (un-animated) keyer settings, sampled per frame in `resolve`. */
	chromaKey?: ChromaKeySettings;
	/** Base grade; sampled per frame in `resolve` (keyframes). */
	colorGrade?: ColorGradeSettings;
	/** Base correction; sampled per frame in `resolve` (intensity keyframes). */
	colorCorrection?: ColorCorrectionSettings;
	/** Clip-anim library assignment (image/video). */
	mediaAnims?: MediaAnimAssignment;
}

export interface ResolvedVisualNodeState {
	localTime: number;
	transform: Transform;
	opacity: number;
	effectPasses: EffectPass[][];
	/** Keyer sampled at `localTime`; null when the clip has no keyer. */
	chromaKey: ChromaKeySettings | null;
	/** Full grade at `localTime`; null when identity (skip shader). */
	colorGrade: ColorGradeSettings | null;
	/** Active correction at `localTime`; null when disabled or unanalyzed. */
	colorCorrection: ResolvedColorCorrection | null;
}

/**
 * One side of a cut, unpainted: the compositor draws fill + placed media into
 * its own GPU target, which the transition pack samples as uFrom / uTo.
 */
export type CutTransitionSide = {
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	/** Pixels never change for this source object (still image). */
	sourceIsStatic: boolean;
	/** Distinguishes frames when a pooled source object is reused (video). */
	frameKey: string;
	transform: Transform;
	opacity: number;
	backgroundFill: BackgroundFillSettings;
	styleSource: { source: CanvasImageSource; width: number; height: number } | null;
	/** Null when identity. */
	colorGrade: ColorGradeSettings | null;
	/** Null when inactive. */
	colorCorrection: ResolvedColorCorrection | null;
	clipLocalTime: number;
	clipDurationSec: number;
	mediaAnims?: MediaAnimAssignment;
};

/** Dual-sampled cut: outgoing (from) and incoming (to) sides for a transition pack. */
export type CutTransitionComposite = {
	packId: string;
	packTimelineTimeSec: number;
	from: CutTransitionSide;
	to: CutTransitionSide;
};

export interface ResolvedVisualSourceNodeState extends ResolvedVisualNodeState {
	source: CanvasImageSource;
	sourceWidth: number;
	sourceHeight: number;
	/** Set while the playhead is inside this clip's cut-transition window. */
	cutTransition?: CutTransitionComposite;
}

export abstract class VisualNode<
	Params extends VisualNodeParams = VisualNodeParams,
	Resolved extends ResolvedVisualNodeState = ResolvedVisualNodeState,
> extends BaseNode<Params, Resolved> {}
