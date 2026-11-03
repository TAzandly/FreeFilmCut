import type { CutTransitionBinding } from "../cut-transition";
import { BaseNode } from "./base-node";

export type CoverFillNodeParams = {
	url: string;
	duration: number;
	timeOffset: number;
	/** When true, contentHash includes clip local time so GIF frames refresh. */
	animated?: boolean;
	/** When set, fill is suppressed inside these cut windows (baked into uFrom/uTo). */
	cutTransitions?: CutTransitionBinding[];
};

export type ResolvedCoverFillNodeState = {
	source: CanvasImageSource;
	width: number;
	height: number;
	/** Clip-local seconds used for animated cache busting. */
	localTimeSec: number;
};

/**
 * Full-canvas cover blit of a still/GIF under an image clip (identity transform).
 * Isolated from chroma / grade / mask / clip-anim.
 */
export class CoverFillNode extends BaseNode<
	CoverFillNodeParams,
	ResolvedCoverFillNodeState
> {}
