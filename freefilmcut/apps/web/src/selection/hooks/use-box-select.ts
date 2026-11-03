"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type {
	BoxSelectionSnapshot,
	ResolveIntersections,
	SelectionBoxBounds,
} from "@/selection/types";
import { recordInteractionWork } from "@/diagnostics/interaction-perf";

interface SelectionBoxState<TId> extends BoxSelectionSnapshot<TId> {
	startPos: { x: number; y: number };
	currentPos: { x: number; y: number };
	bounds: SelectionBoxBounds | null;
	isActive: boolean;
	isAdditive: boolean;
}

function getSelectionBoxBounds({
	container,
	startPos,
	currentPos,
}: {
	container: HTMLElement;
	startPos: { x: number; y: number };
	currentPos: { x: number; y: number };
}): SelectionBoxBounds {
	const containerRect = container.getBoundingClientRect();
	const startX = startPos.x - containerRect.left;
	const startY = startPos.y - containerRect.top;
	const currentX = currentPos.x - containerRect.left;
	const currentY = currentPos.y - containerRect.top;

	return {
		left: Math.min(startX, currentX),
		top: Math.min(startY, currentY),
		width: Math.abs(currentX - startX),
		height: Math.abs(currentY - startY),
	};
}

export function useBoxSelect<TId>({
	containerRef,
	resolveIntersections,
	selectedIds,
	getSelectedIds,
	anchorId,
	onSelectionChange,
	shouldStartSelection,
	getIsAdditiveSelection,
	isEnabled = true,
}: {
	containerRef: React.RefObject<HTMLElement | null>;
	resolveIntersections: ResolveIntersections<TId>;
	selectedIds?: TId[];
	/** fcc-tl-flower-66: read selection at mousedown without React-subscribing the parent. */
	getSelectedIds?: () => TId[];
	anchorId: TId | null;
	onSelectionChange: (state: {
		intersectedIds: TId[];
		initialSelectedIds: TId[];
		initialAnchorId: TId | null;
		isAdditive: boolean;
	}) => void;
	shouldStartSelection?: (event: React.MouseEvent<Element>) => boolean;
	getIsAdditiveSelection?: (event: React.MouseEvent<Element>) => boolean;
	isEnabled?: boolean;
}) {
	const [selectionBox, setSelectionBox] =
		useState<SelectionBoxState<TId> | null>(null);
	const justFinishedSelectingRef = useRef(false);

	const handleMouseDown = useCallback(
		(event: React.MouseEvent<Element>) => {
			const canStartSelection = shouldStartSelection
				? shouldStartSelection(event)
				: true;
			if (!isEnabled || event.button !== 0 || !canStartSelection) {
				return;
			}

			const startPos = { x: event.clientX, y: event.clientY };
			const container = containerRef.current;
			setSelectionBox({
				startPos,
				currentPos: startPos,
				bounds: container
					? getSelectionBoxBounds({
							container,
							startPos,
							currentPos: startPos,
						})
					: null,
				isActive: false,
				isAdditive: getIsAdditiveSelection
					? getIsAdditiveSelection(event)
					: event.ctrlKey || event.metaKey,
				initialSelectedIds: getSelectedIds
					? getSelectedIds()
					: (selectedIds ?? []),
				initialAnchorId: anchorId,
			});
		},
		[
			anchorId,
			containerRef,
			getIsAdditiveSelection,
			getSelectedIds,
			isEnabled,
			selectedIds,
			shouldStartSelection,
		],
	);

	const updateSelection = useCallback(
		({
			startPos,
			currentPos,
			isAdditive,
			initialSelectedIds,
			initialAnchorId,
		}: SelectionBoxState<TId>) => {
			const intersectedIds = resolveIntersections({
				startPos,
				currentPos,
			});
			onSelectionChange({
				intersectedIds,
				initialSelectedIds,
				initialAnchorId,
				isAdditive,
			});
		},
		[onSelectionChange, resolveIntersections],
	);

	// The live box is read through a ref inside the window listeners below.
	// Keying the effect on the box object itself would tear down and re-attach
	// two window listeners on every mousemove (the box is a fresh object each
	// frame), and would also hand the handler a stale snapshot.
	const selectionBoxRef = useRef(selectionBox);
	const updateSelectionRef = useRef(updateSelection);
	useEffect(() => {
		selectionBoxRef.current = selectionBox;
		updateSelectionRef.current = updateSelection;
	});
	const hasSelectionBox = selectionBox !== null;

	useEffect(() => {
		if (!hasSelectionBox) {
			return;
		}

		let frameId = 0;
		let pendingPoint: { x: number; y: number } | null = null;

		const applyMove = () => {
			frameId = 0;
			const box = selectionBoxRef.current;
			const point = pendingPoint;
			pendingPoint = null;
			if (!box || !point) return;

			recordInteractionWork({ name: "timeline.boxSelect" });

			const container = containerRef.current;
			const nextSelectionBox: SelectionBoxState<TId> = {
				...box,
				currentPos: point,
				bounds: container
					? getSelectionBoxBounds({
							container,
							startPos: box.startPos,
							currentPos: point,
						})
					: null,
				isActive:
					Math.abs(point.x - box.startPos.x) > 5 ||
					Math.abs(point.y - box.startPos.y) > 5 ||
					box.isActive,
			};

			setSelectionBox(nextSelectionBox);

			if (!nextSelectionBox.isActive) {
				return;
			}

			updateSelectionRef.current(nextSelectionBox);
		};

		const handleMouseMove = ({ clientX, clientY }: MouseEvent) => {
			pendingPoint = { x: clientX, y: clientY };
			if (frameId !== 0) return;
			frameId = requestAnimationFrame(applyMove);
		};

		const handleMouseUp = () => {
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
				frameId = 0;
			}
			pendingPoint = null;

			if (selectionBoxRef.current?.isActive) {
				justFinishedSelectingRef.current = true;
				requestAnimationFrame(() => {
					justFinishedSelectingRef.current = false;
				});
			}

			setSelectionBox(null);
		};

		window.addEventListener("mousemove", handleMouseMove);
		window.addEventListener("mouseup", handleMouseUp);

		return () => {
			if (frameId !== 0) cancelAnimationFrame(frameId);
			window.removeEventListener("mousemove", handleMouseMove);
			window.removeEventListener("mouseup", handleMouseUp);
		};
	}, [containerRef, hasSelectionBox]);

	useEffect(() => {
		if (!hasSelectionBox) {
			return;
		}

		const container = containerRef.current;
		const previousBodyUserSelect = document.body.style.userSelect;
		const previousContainerUserSelect = container?.style.userSelect ?? "";

		document.body.style.userSelect = "none";
		if (container) {
			container.style.userSelect = "none";
		}

		return () => {
			document.body.style.userSelect = previousBodyUserSelect;
			if (container) {
				container.style.userSelect = previousContainerUserSelect;
			}
		};
	}, [containerRef, hasSelectionBox]);

	const shouldIgnoreClick = useCallback(() => {
		return justFinishedSelectingRef.current;
	}, []);

	return {
		selectionBox:
			selectionBox?.isActive && selectionBox.bounds
				? { bounds: selectionBox.bounds }
				: null,
		handleMouseDown,
		isSelecting: selectionBox?.isActive ?? false,
		shouldIgnoreClick,
	};
}
