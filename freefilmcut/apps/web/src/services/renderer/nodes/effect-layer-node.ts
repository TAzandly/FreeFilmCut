import type { EffectPass } from "@/effects/types";
import type { ParamValues } from "@/params";
import type { ElementAnimations } from "@/animation/types";
import type { StickerAnimAssignment } from "@/timeline";
import { BaseNode } from "./base-node";

export type EffectLayerNodeParams = {
	effectType: string;
	effectParams: ParamValues;
	timeOffset: number;
	duration: number;
	anims?: ElementAnimations;
	stickerAnims?: StickerAnimAssignment;
};

export type ResolvedEffectLayerNodeState = {
	passes: EffectPass[];
	/** Seconds from clip start (timeline local). */
	localTime?: number;
};

export class EffectLayerNode extends BaseNode<
	EffectLayerNodeParams,
	ResolvedEffectLayerNodeState
> {}
