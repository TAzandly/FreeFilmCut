"use client";

import { useCallback, useLayoutEffect, useRef } from "react";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import { TimelineElement } from "./timeline-element";
import { TransitionOverlays } from "./transition-overlay";
import type { TimelineTrack, TransitionCutDrop } from "@/timeline";
import type { TimelineElement as TimelineElementType } from "@/timeline";
import { TIMELINE_LAYERS } from "./layers";
import type { ElementDragView } from "@/timeline";
import { addMediaTime, type MediaTime } from "@/wasm";

interface TimelineTrackContentProps {
	track: TimelineTrack;
	zoomLevel: number;
	dragView: ElementDragView;
	onResizeStart: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
		side: "left" | "right";
	}) => void;
	onElementMouseDown: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
	}) => void;
	onElementClick: (params: {
		event: React.MouseEvent;
		element: TimelineElementType;
		track: TimelineTrack;
	}) => void;
	onTrackMouseDown?: (event: React.MouseEvent) => void;
	onTrackMouseUp?: (event: React.MouseEvent) => void;
	shouldIgnoreClick?: () => boolean;
	targetElementId?: string | null;
	transitionCut?: TransitionCutDrop | null;
}

export function TimelineTrackContent({
	track,
	zoomLevel,
	dragView,
	onResizeStart,
	onElementMouseDown,
	onElementClick,
	onTrackMouseDown,
	onTrackMouseUp,
	shouldIgnoreClick,
	targetElementId = null,
	transitionCut = null,
}: TimelineTrackContentProps) {
	// Clips are memoized: hand them callbacks whose identity never changes and
	// read the current track / handlers at call time.
	const latestRef = useRef({
		track,
		onResizeStart,
		onElementMouseDown,
		onElementClick,
	});
	useLayoutEffect(() => {
		latestRef.current = {
			track,
			onResizeStart,
			onElementMouseDown,
			onElementClick,
		};
	});
	const handleResizeStart = useCallback(
		({
			event,
			element,
			side,
		}: {
			event: React.MouseEvent;
			element: TimelineElementType;
			side: "left" | "right";
		}) => {
			const latest = latestRef.current;
			latest.onResizeStart({ event, element, track: latest.track, side });
		},
		[],
	);
	const handleElementMouseDown = useCallback(
		({
			event,
			element,
		}: {
			event: React.MouseEvent;
			element: TimelineElementType;
		}) => {
			const latest = latestRef.current;
			latest.onElementMouseDown({ event, element, track: latest.track });
		},
		[],
	);
	const handleElementClick = useCallback(
		({
			event,
			element,
		}: {
			event: React.MouseEvent;
			element: TimelineElementType;
		}) => {
			const latest = latestRef.current;
			latest.onElementClick({ event, element, track: latest.track });
		},
		[],
	);

	return (
		<div className="relative size-full">
			<button
				type="button"
				className="absolute inset-0 m-0 size-full appearance-none border-0 bg-transparent p-0"
				aria-label={`Select ${track.name} track`}
				onMouseUp={(event) => {
					if (shouldIgnoreClick?.()) return;
					onTrackMouseUp?.(event);
				}}
				onMouseDown={(event) => {
					event.preventDefault();
					onTrackMouseDown?.(event);
				}}
			/>
			{/* eslint-disable-next-line jsx-a11y/no-static-element-interactions -- spatial gesture surface; the wrapping <button> handles keyboard track selection, this <div> only forwards background clicks for box-select / deselect. */}
			<div
				className="relative h-full min-w-full"
				style={{ zIndex: TIMELINE_LAYERS.trackContent }}
				onMouseUp={(event) => {
					if (event.target !== event.currentTarget) return;
					if (shouldIgnoreClick?.()) return;
					onTrackMouseUp?.(event);
				}}
				onMouseDown={(event) => {
					if (event.target !== event.currentTarget) return;
					event.preventDefault();
					onTrackMouseDown?.(event);
				}}
			>
				{track.elements.length === 0 ? (
					<div className="text-muted-foreground border-muted/30 pointer-events-none flex size-full items-center justify-center rounded-sm border-2 border-dashed text-xs" />
				) : (
					track.elements.map((element) => {
						// Only clips in the drag group get a position, so the
						// rest keep equal props on every mousemove.
						const dragTimeOffset =
							dragView.kind === "dragging"
								? dragView.memberTimeOffsets.get(element.id)
								: undefined;
						return (
							<TimelineElement
								key={element.id}
								element={element}
								trackId={track.id}
								trackType={track.type}
								zoomLevel={zoomLevel}
								onResizeStart={handleResizeStart}
								onElementMouseDown={handleElementMouseDown}
								onElementClick={handleElementClick}
								dragStartTime={
									dragView.kind === "dragging" && dragTimeOffset !== undefined
										? addMediaTime({
												a: dragView.currentTime,
												b: dragTimeOffset,
											})
										: undefined
								}
								dragOffsetY={
									dragView.kind === "dragging" && dragTimeOffset !== undefined
										? dragView.currentMouseY - dragView.startMouseY
										: 0
								}
								isDropTarget={element.id === targetElementId}
							/>
						);
					})
				)}
				{track.type === "video" ? (
					<TransitionOverlays track={track} zoomLevel={zoomLevel} />
				) : null}
				{transitionCut ? (
					<TransitionCutDropHighlight
						cutTime={transitionCut.cutTime}
						zoomLevel={zoomLevel}
					/>
				) : null}
			</div>
		</div>
	);
}

function TransitionCutDropHighlight({
	cutTime,
	zoomLevel,
}: {
	cutTime: MediaTime;
	zoomLevel: number;
}) {
	const center = timelineTimeToPixels({ time: cutTime, zoomLevel });
	return (
		<div
			className="bg-primary pointer-events-none absolute top-0 bottom-0 w-1 rounded-full"
			style={{
				left: `${center - 2}px`,
				zIndex: TIMELINE_LAYERS.dragLine,
			}}
		/>
	);
}
