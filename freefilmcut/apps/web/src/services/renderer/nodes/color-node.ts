import type { CutTransitionBinding } from "../cut-transition";
import { BaseNode } from "./base-node";

export type ColorNodeParams = {
	color: string;
	/** When set with duration, color only paints during the clip window. */
	timeOffset?: number;
	duration?: number;
	/** When set, fill is suppressed inside these cut windows (baked into uFrom/uTo). */
	cutTransitions?: CutTransitionBinding[];
};

export type ResolvedColorNodeState = {
	active: true;
};

export class ColorNode extends BaseNode<
	ColorNodeParams,
	ResolvedColorNodeState
> {}
