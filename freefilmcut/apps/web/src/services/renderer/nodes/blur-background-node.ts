import type { RetimeConfig } from "@/timeline";
import type { CutTransitionBinding } from "../cut-transition";
import { BaseNode } from "./base-node";

export type BlurBackgroundNodeParams = {
	mediaId: string;
	url: string;
	file: File;
	mediaType: "video" | "image";
	duration: number;
	timeOffset: number;
	trimStart: number;
	trimEnd: number;
	retime?: RetimeConfig;
	blurIntensity: number;
	/** When set, fill is suppressed inside these cut windows (baked into uFrom/uTo). */
	cutTransitions?: CutTransitionBinding[];
};

export type BackdropSource = {
	source: CanvasImageSource;
	width: number;
	height: number;
};

export interface ResolvedBlurBackgroundNodeState {
	backdropSource: BackdropSource;
}

export class BlurBackgroundNode extends BaseNode<
	BlurBackgroundNodeParams,
	ResolvedBlurBackgroundNodeState
> {}
