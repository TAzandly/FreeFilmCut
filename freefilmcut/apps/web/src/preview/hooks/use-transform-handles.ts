import { useEffect, useReducer, useState } from "react";
import { usePreviewViewport } from "@/preview/components/preview-viewport";
import type { OnSnapLinesChange } from "@/preview/hooks/use-preview-interaction";
import { useEditor } from "@/editor/use-editor";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import { useCommittedRef } from "@/hooks/use-committed-ref";
import { useShiftKey } from "@/hooks/use-shift-key";
import { registerCanceller } from "@/editor/cancel-interaction";
import {
	TransformHandleController,
	type TransformHandleDeps,
} from "@/preview/controllers/transform-handle-controller";

export function useTransformHandles({
	onSnapLinesChange,
}: {
	onSnapLinesChange?: OnSnapLinesChange;
}) {
	const viewport = usePreviewViewport();
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	const selectedElements = useEditor((e) => e.selection.getSelectedElements());
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const canvasSize = useEditor(
		(e) => e.project.getActive().settings.canvasSize,
	);
	usePackRegistry((state) => state.packs);
	// fcc-tl-flower-65: read playhead imperatively — scrub must not React-render
	// the whole preview chrome; onSeek below refreshes handle bounds when needed.
	const deps: TransformHandleDeps = {
		viewport,
		input: {
			isShiftHeld: () => isShiftHeldRef.current,
		},
		scene: {
			getSelectedElements: () => selectedElements,
			getTracks: () => tracks,
			getCurrentTime: () => editor.playback.getCurrentTime(),
			getMediaAssets: () => mediaAssets,
			getCanvasSize: () => canvasSize,
		},
		timeline: {
			previewElements: (updates) =>
				editor.timeline.previewElements({ updates }),
			commitPreview: () => editor.timeline.commitPreview(),
			discardPreview: () => editor.timeline.discardPreview(),
		},
		preview: {
			onSnapLinesChange,
		},
	};
	const depsRef = useCommittedRef(deps);
	const [controller] = useState(
		() => new TransformHandleController({ depsRef }),
	);

	const [, rerender] = useReducer((n: number) => n + 1, 0);
	useEffect(() => controller.subscribe(rerender), [controller]);
	// Seek/scrub only — play ticks use onUpdate and must not React-commit handles every rAF.
	useEffect(() => {
		const unsubSeek = editor.playback.onSeek(() => rerender());
		return () => {
			unsubSeek();
		};
	}, [editor.playback]);

	useEffect(() => {
		if (!controller.isActive) return;
		return registerCanceller({ fn: () => controller.cancel() });
	}, [controller, controller.isActive]);

	useEffect(() => () => controller.destroy(), [controller]);

	const selectedWithBounds = controller.selectedWithBounds;
	const hasVisualSelection = selectedWithBounds !== null;

	return {
		selectedWithBounds,
		hasVisualSelection,
		activeHandle: controller.activeHandle,
		handleCornerPointerDown: controller.onCornerPointerDown,
		handleEdgePointerDown: controller.onEdgePointerDown,
		handleRotationPointerDown: controller.onRotationPointerDown,
		handlePointerMove: controller.onPointerMove,
		handlePointerUp: controller.onPointerUp,
	};
}
