import type { EditorCore } from "@/core";
import type { SelectedKeyframeRef } from "@/animation/types";
import type {
	EditorSelectionKind,
	EditorSelectionPatch,
	EditorSelectionSnapshot,
	SelectedMaskPointSelection,
	SelectedTransition,
} from "@/selection/editor-selection";
import type { ElementRef } from "@/timeline/types";

export class SelectionManager {
	private selectedElements: ElementRef[] = [];
	private selectedKeyframes: SelectedKeyframeRef[] = [];
	private keyframeSelectionAnchor: SelectedKeyframeRef | null = null;
	private selectedMaskPoints: SelectedMaskPointSelection | null = null;
	private selectedTransition: SelectedTransition | null = null;
	private listeners = new Set<() => void>();

	constructor(editor: EditorCore) {
		void editor;
	}

	getSelectedElements(): ElementRef[] {
		return this.selectedElements;
	}

	/**
	 * Primitive-returning selection query.
	 *
	 * `getSelectedElements()` hands back the whole array, so every component
	 * that subscribes to it re-renders on every selection change — including
	 * the thousands of timeline clips that only care about "am I selected?".
	 * Subscribing to a boolean instead means a click re-renders exactly the two
	 * clips whose state flipped.
	 */
	isElementSelected({ trackId, elementId }: ElementRef): boolean {
		for (const element of this.selectedElements) {
			if (element.trackId === trackId && element.elementId === elementId) {
				return true;
			}
		}
		return false;
	}

	getSelectedElementCount(): number {
		return this.selectedElements.length;
	}

	/** True for "more than one element selected" — a boolean, so it only
	 * re-renders subscribers when the selection actually crosses 1↔2 (not on
	 * every switch between single selections). */
	hasMultipleElementsSelected(): boolean {
		return this.selectedElements.length > 1;
	}

	/**
	 * Primitive digest of "which TRACKS contain a selected element".
	 *
	 * Track rows only use the selection to paint a highlight on the row, so a
	 * string key is enough: switching between two clips on the same track keeps
	 * the same key, and the rows (plus every clip inside them) stay untouched.
	 * Returning the array instead made one click recommit the whole timeline.
	 */
	getSelectedTrackIdsKey(): string {
		if (this.selectedElements.length === 0) return "";
		const trackIds = new Set<string>();
		for (const element of this.selectedElements) {
			trackIds.add(element.trackId);
		}
		return [...trackIds].sort().join("|");
	}

	getSelectedKeyframes(): SelectedKeyframeRef[] {
		return this.selectedKeyframes;
	}

	getKeyframeSelectionAnchor(): SelectedKeyframeRef | null {
		return this.keyframeSelectionAnchor;
	}

	getSelectedMaskPointSelection(): SelectedMaskPointSelection | null {
		return this.selectedMaskPoints;
	}

	getSelectedTransition(): SelectedTransition | null {
		return this.selectedTransition;
	}

	getActiveSelectionKind(): EditorSelectionKind | null {
		if ((this.selectedMaskPoints?.pointIds.length ?? 0) > 0) {
			return "mask-points";
		}
		if (this.selectedKeyframes.length > 0) {
			return "keyframes";
		}
		if (this.selectedTransition) {
			return "transition";
		}
		if (this.selectedElements.length > 0) {
			return "elements";
		}
		return null;
	}

	getSnapshot(): EditorSelectionSnapshot {
		return {
			selectedElements: [...this.selectedElements],
			selectedKeyframes: [...this.selectedKeyframes],
			keyframeSelectionAnchor: this.keyframeSelectionAnchor,
			selectedMaskPoints: this.selectedMaskPoints
				? {
						...this.selectedMaskPoints,
						pointIds: [...this.selectedMaskPoints.pointIds],
					}
				: null,
			selectedTransition: this.selectedTransition
				? { ...this.selectedTransition }
				: null,
		};
	}

	setSelectedElements({ elements }: { elements: ElementRef[] }): void {
		const sameElements =
			elements.length === this.selectedElements.length &&
			elements.every(
				(el, i) =>
					el.trackId === this.selectedElements[i]?.trackId &&
					el.elementId === this.selectedElements[i]?.elementId,
			);
		const clearingExtras =
			this.selectedKeyframes.length === 0 &&
			this.keyframeSelectionAnchor === null &&
			this.selectedMaskPoints === null &&
			this.selectedTransition === null;
		// fcc-tl-flower-66: identical element selection + no extras → skip notify.
		if (sameElements && clearingExtras) {
			return;
		}
		this.selectedElements = elements;
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.selectedMaskPoints = null;
		this.selectedTransition = null;
		this.notify();
	}

	setSelectedKeyframes({
		keyframes,
		anchorKeyframe,
	}: {
		keyframes: SelectedKeyframeRef[];
		anchorKeyframe?: SelectedKeyframeRef | null;
	}): void {
		this.selectedKeyframes = keyframes;
		if (anchorKeyframe !== undefined) {
			this.keyframeSelectionAnchor = anchorKeyframe;
		} else if (keyframes.length === 0) {
			this.keyframeSelectionAnchor = null;
		}
		this.selectedMaskPoints = null;
		this.selectedTransition = null;
		this.notify();
	}

	setSelectedMaskPoints({
		selection,
	}: {
		selection: SelectedMaskPointSelection | null;
	}): void {
		this.selectedMaskPoints =
			selection && selection.pointIds.length > 0
				? {
						...selection,
						pointIds: [...selection.pointIds],
					}
				: null;
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.selectedTransition = null;
		this.notify();
	}

	setSelectedTransition({
		selection,
	}: {
		selection: SelectedTransition | null;
	}): void {
		this.selectedTransition = selection
			? {
					trackId: selection.trackId,
					transitionId: selection.transitionId,
				}
			: null;
		if (this.selectedTransition) {
			this.selectedElements = [];
			this.selectedKeyframes = [];
			this.keyframeSelectionAnchor = null;
			this.selectedMaskPoints = null;
		}
		this.notify();
	}

	clearSelection(): void {
		// fcc-tl-flower-66: clicking track labels always clearSelection(); skip notify
		// when already empty so Timeline/Ruler/icons do not recommit for nothing.
		if (
			this.selectedElements.length === 0 &&
			this.selectedKeyframes.length === 0 &&
			this.keyframeSelectionAnchor === null &&
			this.selectedMaskPoints === null &&
			this.selectedTransition === null
		) {
			return;
		}
		this.selectedElements = [];
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.selectedMaskPoints = null;
		this.selectedTransition = null;
		this.notify();
	}

	clearKeyframeSelection(): void {
		this.selectedKeyframes = [];
		this.keyframeSelectionAnchor = null;
		this.notify();
	}

	clearMaskPointSelection(): void {
		if (!this.selectedMaskPoints) {
			return;
		}
		this.selectedMaskPoints = null;
		this.notify();
	}

	clearMostSpecificSelection(): boolean {
		const activeSelectionKind = this.getActiveSelectionKind();
		if (activeSelectionKind === "mask-points") {
			this.clearMaskPointSelection();
			return true;
		}
		if (activeSelectionKind === "keyframes") {
			this.clearKeyframeSelection();
			return true;
		}
		if (activeSelectionKind === "transition") {
			this.setSelectedTransition({ selection: null });
			return true;
		}
		if (activeSelectionKind === "elements") {
			this.setSelectedElements({ elements: [] });
			return true;
		}
		return false;
	}

	applySelectionPatch({
		patch,
	}: {
		patch: EditorSelectionPatch;
	}): EditorSelectionSnapshot {
		if (patch.selectedElements !== undefined) {
			this.selectedElements = [...patch.selectedElements];
		}
		if (patch.selectedKeyframes !== undefined) {
			this.selectedKeyframes = [...patch.selectedKeyframes];
		}
		if (patch.keyframeSelectionAnchor !== undefined) {
			this.keyframeSelectionAnchor = patch.keyframeSelectionAnchor;
		}
		if (patch.selectedMaskPoints !== undefined) {
			this.selectedMaskPoints = patch.selectedMaskPoints
				? {
						...patch.selectedMaskPoints,
						pointIds: [...patch.selectedMaskPoints.pointIds],
					}
				: null;
		}
		if (patch.selectedTransition !== undefined) {
			this.selectedTransition = patch.selectedTransition
				? {
						trackId: patch.selectedTransition.trackId,
						transitionId: patch.selectedTransition.transitionId,
					}
				: null;
		} else if (
			patch.selectedElements !== undefined ||
			patch.selectedKeyframes !== undefined ||
			patch.keyframeSelectionAnchor !== undefined ||
			patch.selectedMaskPoints !== undefined
		) {
			this.selectedTransition = null;
		}
		if (this.selectedTransition) {
			this.selectedElements = [];
			this.selectedKeyframes = [];
			this.keyframeSelectionAnchor = null;
			this.selectedMaskPoints = null;
		}
		this.notify();
		return this.getSnapshot();
	}

	restoreSnapshot({ snapshot }: { snapshot: EditorSelectionSnapshot }): void {
		this.selectedElements = [...snapshot.selectedElements];
		this.selectedKeyframes = [...snapshot.selectedKeyframes];
		this.keyframeSelectionAnchor = snapshot.keyframeSelectionAnchor;
		this.selectedMaskPoints = snapshot.selectedMaskPoints
			? {
					...snapshot.selectedMaskPoints,
					pointIds: [...snapshot.selectedMaskPoints.pointIds],
				}
			: null;
		this.selectedTransition = snapshot.selectedTransition
			? { ...snapshot.selectedTransition }
			: null;
		this.notify();
	}

	subscribe(listener: () => void): () => void {
		this.listeners.add(listener);
		return () => this.listeners.delete(listener);
	}

	private notify(): void {
		this.listeners.forEach((fn) => {
			fn();
		});
	}
}
