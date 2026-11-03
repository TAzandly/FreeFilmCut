import { useEffect, useReducer, useState, type RefObject } from "react";
import { useEditor } from "@/editor/use-editor";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { useShiftKey } from "@/hooks/use-shift-key";
import { registerCanceller } from "@/editor/cancel-interaction";
import {
	ElementInteractionController,
	type ElementInteractionDeps,
	type ElementInteractionDepsRef,
	type ElementSelectionApi,
} from "@/timeline/controllers/element-interaction-controller";
import type { SnapPoint } from "@/timeline/snapping";

interface UseElementInteractionProps {
	zoomLevel: number;
	tracksContainerRef: RefObject<HTMLDivElement | null>;
	tracksScrollRef: RefObject<HTMLDivElement | null>;
	headerRef?: RefObject<HTMLElement | null>;
	snappingEnabled: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useElementInteraction({
	zoomLevel,
	tracksContainerRef,
	tracksScrollRef,
	headerRef,
	snappingEnabled,
	onSnapPointChange,
}: UseElementInteractionProps) {
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	/**
	 * Selection is read on demand instead of subscribed.
	 *
	 * This hook lives inside the `Timeline` component, so subscribing here meant
	 * every selection change re-rendered the whole timeline shell (ruler ticks +
	 * toolbar + every track row + every clip). The controller only needs the
	 * selection at the moment a gesture starts, so lazy reads are equivalent.
	 */
	const selection: ElementSelectionApi = {
		getSelected: () => editor.selection.getSelectedElements(),
		isSelected: (ref) => editor.selection.isElementSelected(ref),
		select: (ref) => editor.selection.setSelectedElements({ elements: [ref] }),
		handleClick: ({ trackId, elementId, isMultiKey }) => {
			if (!isMultiKey) {
				editor.selection.setSelectedElements({
					elements: [{ trackId, elementId }],
				});
				return;
			}
			const current = editor.selection.getSelectedElements();
			const alreadySelected = editor.selection.isElementSelected({
				trackId,
				elementId,
			});
			editor.selection.setSelectedElements({
				elements: alreadySelected
					? current.filter(
							(element) =>
								!(element.trackId === trackId && element.elementId === elementId),
						)
					: [...current, { trackId, elementId }],
			});
		},
		clearKeyframeSelection: () => editor.selection.clearKeyframeSelection(),
	};

	const deps: ElementInteractionDeps = {
		viewport: {
			getZoomLevel: () => zoomLevel,
			getTracksScrollEl: () => tracksScrollRef.current,
			getTracksContainerEl: () => tracksContainerRef.current,
			getHeaderEl: () => headerRef?.current ?? null,
		},
		input: {
			isShiftHeld: () => isShiftHeldRef.current,
		},
		scene: {
			getTracks: () => editor.scenes.getActiveScene().tracks,
			getActiveFps: () => editor.project.getActive()?.settings.fps ?? null,
		},
		selection,
		playback: {
			getCurrentTime: () => editor.playback.getCurrentTime(),
		},
		timeline: {
			moveElements: (args) => editor.timeline.moveElements(args),
		},
		snap: {
			isEnabled: () => snappingEnabled,
			onChange: onSnapPointChange,
		},
	};
	const depsRef = useCommittedRef(deps) as ElementInteractionDepsRef;
	const [controller] = useState(
		() => new ElementInteractionController({ depsRef }),
	);

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);

	useEffect(() => {
		if (!controller.isActive) return;
		return registerCanceller({ fn: () => controller.cancel() });
	}, [controller.isActive, controller]);

	useEffect(() => () => controller.destroy(), [controller]);

	return {
		dragView: controller.view,
		handleElementMouseDown: controller.onElementMouseDown,
		handleElementClick: controller.onElementClick,
	};
}
