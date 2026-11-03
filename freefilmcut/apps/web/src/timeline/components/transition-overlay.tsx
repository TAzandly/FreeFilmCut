"use client";

import {
	useEffect,
	useRef,
	useState,
	type PointerEvent as ReactPointerEvent,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { useEditor } from "@/editor/use-editor";
import { DEFAULT_FPS } from "@/fps/defaults";
import {
	findAdjacentCut,
	resizeTransitionDuration,
	transitionWindow,
	type TransitionEdge,
	type VideoTrack,
} from "@/timeline";
import {
	getTimelinePixelsPerSecond,
	timelineTimeToPixels,
} from "@/timeline/pixel-utils";
import { cn } from "@/utils/ui";
import {
	mediaTime,
	TICKS_PER_SECOND,
	ZERO_MEDIA_TIME,
	type MediaTime,
} from "@/wasm";
import { getPackRegistrySnapshot } from "@/vfxpack/pack-registry";
import { normalizeVfxPackType } from "@/vfxpack/pack-placement";
import { TIMELINE_LAYERS } from "./layers";
import { getTrackHeight } from "./track-layout";
import { VFX_PACK_TIMELINE_COLOR } from "./theme";

const HATCH_IMAGE =
	"repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.38) 4px, rgba(255,255,255,0.38) 5px)";
const HATCH_IMAGE_SELECTED =
	"repeating-linear-gradient(-45deg, transparent, transparent 4px, rgba(255,255,255,0.72) 4px, rgba(255,255,255,0.72) 5px)";

function pixelsToDeltaTime({
	deltaPx,
	zoomLevel,
}: {
	deltaPx: number;
	zoomLevel: number;
}): MediaTime {
	const pixelsPerSecond = getTimelinePixelsPerSecond({ zoomLevel });
	if (!(pixelsPerSecond > 0)) {
		return ZERO_MEDIA_TIME;
	}
	return mediaTime({
		ticks: Math.round((deltaPx / pixelsPerSecond) * TICKS_PER_SECOND),
	});
}

function stopPrimaryButton({
	event,
}: {
	event: ReactPointerEvent | ReactMouseEvent;
}): boolean {
	if (event.button !== 0) {
		return false;
	}
	event.stopPropagation();
	event.preventDefault();
	return true;
}

export function TransitionOverlays({
	track,
	zoomLevel,
}: {
	track: VideoTrack;
	zoomLevel: number;
}) {
	const editor = useEditor();
	const selectedTransition = useEditor((currentEditor) =>
		currentEditor.selection.getSelectedTransition(),
	);

	useEffect(() => {
		if (!selectedTransition || selectedTransition.trackId !== track.id) {
			return;
		}
		const exists = (track.transitions ?? []).some(
			(edge) => edge.id === selectedTransition.transitionId,
		);
		if (!exists) {
			editor.selection.setSelectedTransition({ selection: null });
		}
	}, [editor, selectedTransition, track]);

	return (track.transitions ?? []).map((edge) => {
		const fromElement = track.elements.find(
			(element) => element.id === edge.fromElementId,
		);
		const toElement = track.elements.find(
			(element) => element.id === edge.toElementId,
		);
		if (!fromElement || !toElement) {
			return null;
		}
		const cut = findAdjacentCut({
			elements: track.elements,
			fromId: edge.fromElementId,
			toId: edge.toElementId,
		});
		if (!cut) {
			return null;
		}
		return (
			<TransitionOverlay
				key={edge.id}
				trackId={track.id}
				edge={edge}
				cutTime={cut.cutTime}
				fromDuration={fromElement.duration}
				toDuration={toElement.duration}
				zoomLevel={zoomLevel}
			/>
		);
	});
}

function TransitionOverlay({
	trackId,
	edge,
	cutTime,
	fromDuration,
	toDuration,
	zoomLevel,
}: {
	trackId: string;
	edge: TransitionEdge;
	cutTime: MediaTime;
	fromDuration: MediaTime;
	toDuration: MediaTime;
	zoomLevel: number;
}) {
	const editor = useEditor();
	const selectedTransition = useEditor((currentEditor) =>
		currentEditor.selection.getSelectedTransition(),
	);
	const [previewDuration, setPreviewDuration] = useState<MediaTime | null>(
		null,
	);
	const dragCleanupRef = useRef<(() => void) | null>(null);

	useEffect(() => {
		return () => {
			dragCleanupRef.current?.();
		};
	}, []);

	const isSelected =
		selectedTransition?.trackId === trackId &&
		selectedTransition.transitionId === edge.id;
	const duration = previewDuration ?? edge.duration;
	const { start } = transitionWindow({ cutTime, duration });
	const left = timelineTimeToPixels({ time: start, zoomLevel });
	const width = timelineTimeToPixels({ time: duration, zoomLevel });
	const trackHeight = getTrackHeight({ type: "video" });
	const handleWidthPx = Math.min(8, Math.max(4, width / 4));
	const pack = getPackRegistrySnapshot().packs.find(
		(entry) => entry.id === edge.packId,
	);
	const transitionColor = pack
		? VFX_PACK_TIMELINE_COLOR[normalizeVfxPackType(pack.type)]
		: VFX_PACK_TIMELINE_COLOR.transition;

	const selectTransition = () => {
		if (isSelected) {
			return;
		}
		editor.selection.setSelectedTransition({
			selection: { trackId, transitionId: edge.id },
		});
	};

	const startResize = ({
		event,
		side,
	}: {
		event: ReactPointerEvent<HTMLButtonElement>;
		side: "left" | "right";
	}) => {
		dragCleanupRef.current?.();

		const startX = event.clientX;
		const startDuration = previewDuration ?? edge.duration;
		const zoom = zoomLevel;
		const fps = editor.project.getActiveOrNull()?.settings.fps ?? DEFAULT_FPS;
		const pointerId = event.pointerId;
		let latest = startDuration;
		let settled = false;

		const durationAt = ({ clientX }: { clientX: number }) =>
			resizeTransitionDuration({
				startDuration,
				deltaTime: pixelsToDeltaTime({
					deltaPx: clientX - startX,
					zoomLevel: zoom,
				}),
				side,
				fromDuration,
				toDuration,
				fps,
			});

		const detach = () => {
			window.removeEventListener("pointermove", onMove, true);
			window.removeEventListener("pointerup", onUp, true);
			window.removeEventListener("pointercancel", onUp, true);
			if (dragCleanupRef.current === detach) {
				dragCleanupRef.current = null;
			}
		};

		const finish = ({
			nextDuration,
			moved,
		}: {
			nextDuration: MediaTime;
			moved: boolean;
		}) => {
			if (settled) {
				return;
			}
			settled = true;
			detach();
			setPreviewDuration(null);
			if (moved && nextDuration !== startDuration) {
				editor.timeline.setTransitionDuration({
					trackId,
					transitionId: edge.id,
					duration: nextDuration,
				});
			}
		};

		const onMove = (moveEvent: PointerEvent) => {
			if (moveEvent.pointerId !== pointerId) {
				return;
			}
			latest = durationAt({ clientX: moveEvent.clientX });
			setPreviewDuration(latest);
		};

		const onUp = (upEvent: PointerEvent) => {
			if (upEvent.pointerId !== pointerId) {
				return;
			}
			if (upEvent.type === "pointercancel") {
				finish({
					nextDuration: latest,
					moved: latest !== startDuration,
				});
				return;
			}
			finish({
				nextDuration: durationAt({ clientX: upEvent.clientX }),
				moved: upEvent.clientX !== startX,
			});
		};

		dragCleanupRef.current = detach;
		window.addEventListener("pointermove", onMove, true);
		window.addEventListener("pointerup", onUp, true);
		window.addEventListener("pointercancel", onUp, true);
		event.currentTarget.setPointerCapture(pointerId);
	};

	return (
		<div
			className={cn(
				"absolute top-0 touch-none overflow-hidden border border-white/35 select-none",
				isSelected && "border-primary ring-primary ring-1 ring-inset",
			)}
			data-transition-id={edge.id}
			style={{
				left: `${left}px`,
				width: `${width}px`,
				height: `${trackHeight}px`,
				zIndex: TIMELINE_LAYERS.transition,
				backgroundColor: isSelected
					? `${transitionColor}b3`
					: `${transitionColor}6b`,
				backgroundImage: isSelected ? HATCH_IMAGE_SELECTED : HATCH_IMAGE,
			}}
		>
			<button
				type="button"
				className="absolute inset-0 z-0 m-0 cursor-pointer border-0 bg-transparent p-0"
				aria-label="Select transition"
				aria-pressed={isSelected}
				onPointerDown={(event) => {
					if (!stopPrimaryButton({ event })) {
						return;
					}
					selectTransition();
				}}
				onMouseDown={(event) => {
					stopPrimaryButton({ event });
				}}
				onClick={(event) => {
					event.stopPropagation();
					selectTransition();
				}}
			/>
			{width >= 20 ? (
				<span
					aria-hidden
					className="pointer-events-none absolute top-1/2 left-1/2 z-10 -translate-x-1/2 -translate-y-1/2 text-sm leading-none text-white drop-shadow"
				>
					⋈
				</span>
			) : null}
			<button
				type="button"
				tabIndex={-1}
				aria-label="Resize transition from the left"
				className="absolute top-0 bottom-0 left-0 z-20 m-0 cursor-w-resize border-0 bg-white/55 p-0"
				style={{ width: `${handleWidthPx}px` }}
				onPointerDown={(event) => {
					if (!stopPrimaryButton({ event })) {
						return;
					}
					selectTransition();
					startResize({ event, side: "left" });
				}}
				onMouseDown={(event) => {
					stopPrimaryButton({ event });
				}}
				onClick={(event) => {
					event.stopPropagation();
					selectTransition();
				}}
			/>
			<button
				type="button"
				tabIndex={-1}
				aria-label="Resize transition from the right"
				className="absolute top-0 right-0 bottom-0 z-20 m-0 cursor-e-resize border-0 bg-white/55 p-0"
				style={{ width: `${handleWidthPx}px` }}
				onPointerDown={(event) => {
					if (!stopPrimaryButton({ event })) {
						return;
					}
					selectTransition();
					startResize({ event, side: "right" });
				}}
				onMouseDown={(event) => {
					stopPrimaryButton({ event });
				}}
				onClick={(event) => {
					event.stopPropagation();
					selectTransition();
				}}
			/>
		</div>
	);
}
