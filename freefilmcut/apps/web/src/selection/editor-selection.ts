import type { SelectedKeyframeRef } from "@/animation/types";
import type { ElementRef } from "@/timeline/types";

export interface SelectedMaskPointSelection {
	trackId: string;
	elementId: string;
	maskId: string;
	pointIds: string[];
}

export interface SelectedTransition {
	trackId: string;
	transitionId: string;
}

export interface EditorSelectionSnapshot {
	selectedElements: ElementRef[];
	selectedKeyframes: SelectedKeyframeRef[];
	keyframeSelectionAnchor: SelectedKeyframeRef | null;
	selectedMaskPoints: SelectedMaskPointSelection | null;
	selectedTransition: SelectedTransition | null;
}

export interface EditorSelectionPatch {
	selectedElements?: ElementRef[];
	selectedKeyframes?: SelectedKeyframeRef[];
	keyframeSelectionAnchor?: SelectedKeyframeRef | null;
	selectedMaskPoints?: SelectedMaskPointSelection | null;
	selectedTransition?: SelectedTransition | null;
}

export type EditorSelectionKind =
	| "mask-points"
	| "keyframes"
	| "transition"
	| "elements";
