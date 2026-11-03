import {
	useState,
	useCallback,
	useEffect,
	useRef,
	type RefObject,
} from "react";
import { useEditor } from "@/editor/use-editor";
import { useShiftKey } from "@/hooks/use-shift-key";
import { TIMELINE_DRAG_THRESHOLD_PX } from "@/timeline/components/interaction";
import { getMouseTimeFromClientX } from "@/timeline/drag-utils";
import {
	buildTimelineSnapPoints,
	getTimelineSnapThresholdInTicks,
	resolveTimelineSnap,
	type SnapPoint,
} from "@/timeline/snapping";
import { getBookmarkSnapPoints } from "../snap-source";
import { getElementEdgeSnapPoints } from "@/timeline/element-snap-source";
import { getPlayheadSnapPoints } from "@/timeline/playhead-snap-source";
import { getAnimationKeyframeSnapPointsForTimeline } from "@/timeline/animation-snap-points";
import type { Bookmark } from "@/timeline";
import { roundFrameTime, type MediaTime, ZERO_MEDIA_TIME } from "@/wasm";
import { recordInteractionWork } from "@/diagnostics/interaction-perf";

export interface BookmarkDragState {
	isDragging: boolean;
	bookmarkTime: MediaTime | null;
	currentTime: MediaTime;
}

interface PendingBookmarkDrag {
	bookmarkTime: MediaTime;
	startMouseX: number;
	startMouseY: number;
}

interface UseBookmarkDragProps {
	zoomLevel: number;
	scrollRef: RefObject<HTMLElement | null>;
	snappingEnabled: boolean;
	onSnapPointChange?: (snapPoint: SnapPoint | null) => void;
}

export function useBookmarkDrag({
	zoomLevel,
	scrollRef,
	snappingEnabled,
	onSnapPointChange,
}: UseBookmarkDragProps) {
	const editor = useEditor();
	const isShiftHeldRef = useShiftKey();
	const tracks = editor.scenes.getActiveScene().tracks;
	const activeScene = editor.scenes.getActiveScene();
	const bookmarks = activeScene?.bookmarks ?? [];
	const playheadTime = editor.playback.getCurrentTime();
	const duration = editor.timeline.getTotalDuration();

	const [dragState, setDragState] = useState<BookmarkDragState>({
		isDragging: false,
		bookmarkTime: null,
		currentTime: ZERO_MEDIA_TIME,
	});
	const [isPendingDrag, setIsPendingDrag] = useState(false);
	const pendingDragRef = useRef<PendingBookmarkDrag | null>(null);
	const lastMouseXRef = useRef(0);
	// Last frame-snapped time computed by the coalesced move handler. Mouseup
	// reads this instead of React state so a move still queued for the next
	// animation frame can be flushed and committed exactly.
	const lastDraggedTimeRef = useRef<MediaTime | null>(null);
	const flushPendingMoveRef = useRef<() => void>(() => {});

	const startDrag = useCallback(
		({
			bookmarkTime,
			initialCurrentTime,
		}: {
			bookmarkTime: MediaTime;
			initialCurrentTime: MediaTime;
		}) => {
			setDragState({
				isDragging: true,
				bookmarkTime,
				currentTime: initialCurrentTime,
			});
		},
		[],
	);

	const endDrag = useCallback(() => {
		lastDraggedTimeRef.current = null;
		setDragState({
			isDragging: false,
			bookmarkTime: null,
			currentTime: ZERO_MEDIA_TIME,
		});
	}, []);

	const getSnapResult = useCallback(
		({
			rawTime,
			excludeBookmarkTime,
		}: {
			rawTime: MediaTime;
			excludeBookmarkTime: MediaTime;
		}): { snappedTime: MediaTime; snapPoint: SnapPoint | null } => {
			const shouldSnap = snappingEnabled && !isShiftHeldRef.current;
			if (!shouldSnap) {
				return { snappedTime: rawTime, snapPoint: null };
			}

			const snapPoints = buildTimelineSnapPoints({
				sources: [
					() => getElementEdgeSnapPoints({ tracks }),
					() => getPlayheadSnapPoints({ playheadTime }),
					() => getBookmarkSnapPoints({ bookmarks, excludeBookmarkTime }),
					() => getAnimationKeyframeSnapPointsForTimeline({ tracks }),
				],
			});
			const result = resolveTimelineSnap({
				targetTime: rawTime,
				snapPoints,
				maxSnapDistance: getTimelineSnapThresholdInTicks({ zoomLevel }),
			});
			return {
				snappedTime: result.snappedTime,
				snapPoint: result.snapPoint,
			};
		},
		[
			snappingEnabled,
			tracks,
			playheadTime,
			bookmarks,
			zoomLevel,
			isShiftHeldRef,
		],
	);

	useEffect(() => {
		if (!dragState.isDragging && !isPendingDrag) return;

		let frameId = 0;
		let pendingPoint: { clientX: number; clientY: number } | null = null;

		const applyMove = (point: { clientX: number; clientY: number }) => {
			recordInteractionWork({ name: "timeline.bookmarkDrag" });

			const { clientX, clientY } = point;
			const scrollContainer = scrollRef.current;
			if (!scrollContainer) return;

			if (isPendingDrag && pendingDragRef.current) {
				const { startMouseX, startMouseY, bookmarkTime } =
					pendingDragRef.current;
				const deltaX = Math.abs(clientX - startMouseX);
				const deltaY = Math.abs(clientY - startMouseY);

				if (
					deltaX <= TIMELINE_DRAG_THRESHOLD_PX &&
					deltaY <= TIMELINE_DRAG_THRESHOLD_PX
				) {
					return;
				}

				const activeProject = editor.project.getActive();
				if (!activeProject) return;

				const scrollLeft = scrollContainer.scrollLeft;
				const mouseTime = getMouseTimeFromClientX({
					clientX,
					containerRect: scrollContainer.getBoundingClientRect(),
					zoomLevel,
					scrollLeft,
				});
				const clampedTime = mouseTime > duration ? duration : mouseTime;
				const frameSnappedTime = roundFrameTime({
					time: clampedTime,
					fps: activeProject.settings.fps,
				});
				const { snappedTime: initialTime } = getSnapResult({
					rawTime: frameSnappedTime,
					excludeBookmarkTime: bookmarkTime,
				});

				lastDraggedTimeRef.current = initialTime;
				startDrag({
					bookmarkTime,
					initialCurrentTime: initialTime,
				});
				pendingDragRef.current = null;
				setIsPendingDrag(false);
				return;
			}

			if (!dragState.isDragging || dragState.bookmarkTime === null) return;

			const activeProject = editor.project.getActive();
			if (!activeProject) return;

			const scrollLeft = scrollContainer.scrollLeft;
			const mouseTime = getMouseTimeFromClientX({
				clientX,
				containerRect: scrollContainer.getBoundingClientRect(),
				zoomLevel,
				scrollLeft,
			});
			const clampedTime = mouseTime > duration ? duration : mouseTime;
			const frameSnappedTime = roundFrameTime({
				time: clampedTime,
				fps: activeProject.settings.fps,
			});
			const snapResult = getSnapResult({
				rawTime: frameSnappedTime,
				excludeBookmarkTime: dragState.bookmarkTime,
			});

			lastDraggedTimeRef.current = snapResult.snappedTime;
			setDragState((previousDragState) => ({
				...previousDragState,
				currentTime: snapResult.snappedTime,
			}));
			onSnapPointChange?.(snapResult.snapPoint);
		};

		const runPendingMove = () => {
			const point = pendingPoint;
			pendingPoint = null;
			if (point) applyMove(point);
		};

		flushPendingMoveRef.current = () => {
			if (frameId !== 0) {
				cancelAnimationFrame(frameId);
				frameId = 0;
			}
			runPendingMove();
		};

		const handleMouseMove = (event: MouseEvent) => {
			// Track the raw pointer immediately so consumers that only need the
			// last x (e.g. click-after-drag suppression) stay exact.
			lastMouseXRef.current = event.clientX;

			pendingPoint = { clientX: event.clientX, clientY: event.clientY };
			if (frameId !== 0) return;
			frameId = requestAnimationFrame(() => {
				frameId = 0;
				runPendingMove();
			});
		};

		document.addEventListener("mousemove", handleMouseMove);
		return () => {
			document.removeEventListener("mousemove", handleMouseMove);
			if (frameId !== 0) cancelAnimationFrame(frameId);
			frameId = 0;
			pendingPoint = null;
			flushPendingMoveRef.current = () => {};
		};
	}, [
		dragState.isDragging,
		dragState.bookmarkTime,
		zoomLevel,
		duration,
		editor.project,
		scrollRef,
		isPendingDrag,
		startDrag,
		getSnapResult,
		onSnapPointChange,
	]);

	useEffect(() => {
		if (!dragState.isDragging) return;

		const handleMouseUp = () => {
			// Apply any move still queued for the next frame so the bookmark
			// lands where the pointer was released.
			flushPendingMoveRef.current();

			if (dragState.bookmarkTime === null) {
				endDrag();
				onSnapPointChange?.(null);
				return;
			}

			const liveTime = lastDraggedTimeRef.current ?? dragState.currentTime;
			const clampedTime = liveTime > duration ? duration : liveTime;

			editor.scenes.moveBookmark({
				fromTime: dragState.bookmarkTime,
				toTime: clampedTime,
			});

			endDrag();
			onSnapPointChange?.(null);
		};

		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [
		dragState.isDragging,
		dragState.bookmarkTime,
		dragState.currentTime,
		duration,
		endDrag,
		onSnapPointChange,
		editor.scenes,
	]);

	useEffect(() => {
		if (!isPendingDrag) return;

		const handleMouseUp = () => {
			pendingDragRef.current = null;
			setIsPendingDrag(false);
			onSnapPointChange?.(null);
		};

		document.addEventListener("mouseup", handleMouseUp);
		return () => document.removeEventListener("mouseup", handleMouseUp);
	}, [isPendingDrag, onSnapPointChange]);

	const handleBookmarkMouseDown = useCallback(
		({ event, bookmark }: { event: React.MouseEvent; bookmark: Bookmark }) => {
			if (event.button !== 0) return;

			event.preventDefault();
			event.stopPropagation();

			pendingDragRef.current = {
				bookmarkTime: bookmark.time,
				startMouseX: event.clientX,
				startMouseY: event.clientY,
			};
			setIsPendingDrag(true);
		},
		[],
	);

	return {
		dragState,
		handleBookmarkMouseDown,
		lastMouseXRef,
	};
}
