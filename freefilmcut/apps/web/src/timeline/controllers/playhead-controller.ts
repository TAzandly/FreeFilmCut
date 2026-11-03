import type { MouseEvent as ReactMouseEvent } from "react";
import type { FrameRate } from "opencut-wasm";
import {
	createRafPointerMove,
	type PointerPoint,
} from "@/timeline/controllers/raf-pointer-move";
import { measureInteraction, recordInteractionWork } from "@/diagnostics/interaction-perf";
import {
	mediaTime,
	snapSeekMediaTime,
	TICKS_PER_SECOND,
	type MediaTime,
} from "@/wasm";
import {
	buildTimelineSnapPoints,
	getTimelineSnapThresholdInTicks,
	resolveTimelineSnap,
	type SnapPoint,
} from "@/timeline/snapping";
import { getBookmarkSnapPoints } from "@/timeline/bookmarks/index";
import { getElementEdgeSnapPoints } from "@/timeline/element-snap-source";
import { getAnimationKeyframeSnapPointsForTimeline } from "@/timeline/animation-snap-points";
import {
	getCenteredLineLeft,
	timelineTimeToPixels,
	timelineTimeToSnappedPixels,
} from "@/timeline";
import { BASE_TIMELINE_PIXELS_PER_SECOND } from "@/timeline/scale";
import type { Bookmark, SceneTracks } from "@/timeline";

// --- Session ---

interface ScrubSession {
	kind: "scrubbing";
	/** True when scrub started from a ruler click (not the playhead handle). */
	didStartFromRuler: boolean;
	/** True once the mouse has moved during a ruler drag. */
	hasMoved: boolean;
	/** Most recent frame-snapped time set by scrub(). */
	currentTime: MediaTime | null;
}

type Session = { kind: "idle" } | ScrubSession;

// --- Config ---

export interface PlayheadConfig {
	zoomLevel: number;
	duration: MediaTime;
	getActiveProjectFps: () => FrameRate | null;
	isShiftHeld: () => boolean;
	getIsPlaying: () => boolean;
	getRulerEl: () => HTMLDivElement | null;
	getRulerScrollEl: () => HTMLDivElement | null;
	getTracksScrollEl: () => HTMLDivElement | null;
	getPlayheadEl: () => HTMLDivElement | null;
	getSceneTracks: () => SceneTracks;
	getSceneBookmarks: () => Bookmark[];
	seek: (time: MediaTime) => void;
	setScrubbing: (isScrubbing: boolean) => void;
	setTimelineViewState: (viewState: {
		zoomLevel: number;
		scrollLeft: number;
		playheadTime: MediaTime;
	}) => void;
}

export interface PlayheadConfigRef {
	readonly current: PlayheadConfig;
}

// --- Pure helpers (px → logical) ---

function pixelToTime({
	clientX,
	rulerEl,
	zoomLevel,
	duration,
}: {
	clientX: number;
	rulerEl: HTMLDivElement;
	zoomLevel: number;
	duration: MediaTime;
}): MediaTime {
	const rulerRect = rulerEl.getBoundingClientRect();
	const contentWidth = timelineTimeToPixels({ time: duration, zoomLevel });
	const clampedX = Math.max(
		0,
		Math.min(contentWidth, clientX - rulerRect.left),
	);
	const seconds = Math.max(
		0,
		Math.min(
			duration / TICKS_PER_SECOND,
			clampedX / (BASE_TIMELINE_PIXELS_PER_SECOND * zoomLevel),
		),
	);
	return mediaTime({ ticks: Math.round(seconds * TICKS_PER_SECOND) });
}

// --- Controller ---

export class PlayheadController {
	private lastMouseClientX = 0;

	private session: Session = { kind: "idle" };
	private readonly configRef: PlayheadConfigRef;

	/**
	 * Snap points for the current scrub session, built on the first move and
	 * dropped on mouseup.
	 *
	 * A playhead drag cannot change the scene, so the set is constant for the
	 * whole gesture — yet it used to be rebuilt on *every* pointer frame.
	 * `getElementEdgeSnapPoints` walks every element of every track and
	 * `getAnimationKeyframeSnapPointsForTimeline` allocates one object per
	 * keyframe, so a keyframe-heavy project paid thousands of short-lived
	 * allocations at 60Hz. That is why the stutter only appears "sometimes":
	 * it scales with project content, not with drag speed — and the garbage it
	 * produces surfaces as sudden GC pauses rather than a steady low frame rate.
	 */
	private sessionSnapPoints: SnapPoint[] | null = null;

	constructor(deps: { configRef: PlayheadConfigRef }) {
		this.configRef = deps.configRef;
		this.onPlayheadMouseDown = this.onPlayheadMouseDown.bind(this);
		this.onRulerMouseDown = this.onRulerMouseDown.bind(this);
	}

	private get config(): PlayheadConfig {
		return this.configRef.current;
	}

	get isActive(): boolean {
		return this.session.kind !== "idle";
	}

	getLastMouseClientX(): number {
		return this.lastMouseClientX;
	}

	destroy(): void {
		this.deactivate();
	}

	// --- Public event handlers (bound, stable references) ---

	onPlayheadMouseDown(event: ReactMouseEvent): void {
		event.preventDefault();
		event.stopPropagation();
		this.session = {
			kind: "scrubbing",
			didStartFromRuler: false,
			hasMoved: false,
			currentTime: null,
		};
		this.config.setScrubbing(true);
		this.scrub({ event, isElementSnappingEnabled: true });
		this.activate();
	}

	onRulerMouseDown(event: ReactMouseEvent): void {
		if (event.button !== 0) return;
		if (this.config.getPlayheadEl()?.contains(event.target as Node)) return;

		event.preventDefault();
		this.session = {
			kind: "scrubbing",
			didStartFromRuler: true,
			hasMoved: false,
			currentTime: null,
		};
		this.config.setScrubbing(true);
		// No element-edge snapping on initial ruler click — avoids a jarring jump.
		this.scrub({ event, isElementSnappingEnabled: false });
		this.activate();
	}

	// --- Public non-session methods ---

	/**
	 * Imperatively updates the playhead DOM element's `left` style.
	 * Called on scroll and playback events to avoid React re-renders
	 * during animation frame updates.
	 */
	updatePlayheadLeft(time: MediaTime): void {
		const playheadEl = this.config.getPlayheadEl();
		if (!playheadEl) return;

		const zoomLevel = this.config.zoomLevel;
		// While playing, keep sub-pixel precision. At low zoom the playhead moves
		// well under 1 device pixel per frame (50 px/s * 0.1 zoom = 5 px/s, i.e.
		// ~0.12 px per frame at 40fps), so snapping to the device grid makes whole
		// frames land on the same rounded pixel and the playhead looks frozen.
		// When paused/scrubbing we still snap so the 2px indicator stays crisp.
		const centerPixel = this.config.getIsPlaying()
			? timelineTimeToPixels({ time, zoomLevel })
			: timelineTimeToSnappedPixels({ time, zoomLevel });
		const scrollLeft = this.config.getRulerScrollEl()?.scrollLeft ?? 0;
		playheadEl.style.left = `${getCenteredLineLeft({ centerPixel }) - scrollLeft}px`;
	}

	/**
	 * Updates the playhead position and auto-scrolls to keep the playhead
	 * visible during playback.
	 */
	handlePlaybackUpdate(time: MediaTime): void {
		this.updatePlayheadLeft(time);

		// Auto-scroll only during playback, not while scrubbing.
		if (!this.config.getIsPlaying() || this.session.kind === "scrubbing")
			return;

		const rulerViewport = this.config.getRulerScrollEl();
		const tracksViewport = this.config.getTracksScrollEl();
		if (!rulerViewport || !tracksViewport) return;

		const playheadPixels = timelineTimeToPixels({
			time,
			zoomLevel: this.config.zoomLevel,
		});
		const viewportWidth = rulerViewport.clientWidth;
		const isOutOfView =
			playheadPixels < rulerViewport.scrollLeft ||
			playheadPixels > rulerViewport.scrollLeft + viewportWidth;

		if (isOutOfView) {
			const desiredScroll = Math.max(
				0,
				Math.min(
					rulerViewport.scrollWidth - viewportWidth,
					playheadPixels - viewportWidth / 2,
				),
			);
			rulerViewport.scrollLeft = tracksViewport.scrollLeft = desiredScroll;
		}
	}

	// --- Private ---

	private activate(): void {
		window.addEventListener("mousemove", this.handleMouseMove);
		window.addEventListener("mouseup", this.handleMouseUp);
	}

	private deactivate(): void {
		window.removeEventListener("mousemove", this.handleMouseMove);
		window.removeEventListener("mouseup", this.handleMouseUp);
		// Gesture over: the next drag must re-read the scene, because an edit
		// made between two drags moves every edge and keyframe.
		this.sessionSnapPoints = null;
	}

	/**
	 * Snap points for the live scrub session (see `sessionSnapPoints`).
	 * Built lazily so a click that never moves costs nothing.
	 */
	private getSessionSnapPoints(): SnapPoint[] {
		if (!this.sessionSnapPoints) {
			this.sessionSnapPoints = buildTimelineSnapPoints({
				sources: [
					() =>
						getElementEdgeSnapPoints({ tracks: this.config.getSceneTracks() }),
					() =>
						getBookmarkSnapPoints({
							bookmarks: this.config.getSceneBookmarks(),
						}),
					() =>
						getAnimationKeyframeSnapPointsForTimeline({
							tracks: this.config.getSceneTracks(),
						}),
				],
			});
		}
		return this.sessionSnapPoints;
	}

	/**
	 * Converts pointer position to a frame-snapped timeline time and seeks.
	 * `isElementSnappingEnabled` controls element-edge snapping; frame-level snapping
	 * is always applied.
	 */
	private scrub({
		event,
		isElementSnappingEnabled,
	}: {
		event: { clientX: number };
		isElementSnappingEnabled: boolean;
	}): void {
		const ruler = this.config.getRulerEl();
		if (!ruler) return;

		const fps = this.config.getActiveProjectFps();
		if (!fps) return;

		const { zoomLevel, duration } = this.config;
		const rawTime = pixelToTime({
			clientX: event.clientX,
			rulerEl: ruler,
			zoomLevel,
			duration,
		});
		const frameTime = snapSeekMediaTime({ time: rawTime, duration, fps });

		const time = (() => {
			if (!isElementSnappingEnabled || this.config.isShiftHeld())
				return frameTime;

			const snapPoints = this.getSessionSnapPoints();
			const result = resolveTimelineSnap({
				targetTime: frameTime,
				snapPoints,
				maxSnapDistance: getTimelineSnapThresholdInTicks({ zoomLevel }),
			});
			return result.snapPoint ? result.snappedTime : frameTime;
		})();

		if (this.session.kind === "scrubbing") {
			this.session.currentTime = time;
		}
		this.config.seek(time);
		this.lastMouseClientX = event.clientX;
	}

	private handleMouseMove = (event: MouseEvent): void => {
		this.rafPointerMove.push({ clientX: event.clientX, clientY: event.clientY });
	};

	// Coalesced work callback — at most one scrub per animation frame.
	// Declared before `rafPointerMove`; class fields initialize in order.
	private applyPointerMove = ({ clientX }: PointerPoint): void => {
		recordInteractionWork({ name: "timeline.playhead" });

		if (this.session.kind !== "scrubbing") return;
		measureInteraction({
			name: "timeline.playhead",
			fn: () => {
				this.scrub({ event: { clientX }, isElementSnappingEnabled: true });
			},
		});
		if (this.session.didStartFromRuler) {
			this.session.hasMoved = true;
		}
	};

	private rafPointerMove = createRafPointerMove({
		onFrame: this.applyPointerMove,
	});

	private handleMouseUp = (event: MouseEvent): void => {
		// Apply the pending scrub before reading the session's final time.
		this.rafPointerMove.flushNow();

		if (this.session.kind !== "scrubbing") return;

		const session = this.session;
		this.config.setScrubbing(false);

		if (session.currentTime !== null) {
			this.config.seek(session.currentTime);
			this.config.setTimelineViewState({
				zoomLevel: this.config.zoomLevel,
				scrollLeft: this.config.getTracksScrollEl()?.scrollLeft ?? 0,
				playheadTime: session.currentTime,
			});
		}

		// Ruler click without drag: snap to clicked position on mouseup.
		if (session.didStartFromRuler && !session.hasMoved) {
			this.scrub({ event, isElementSnappingEnabled: false });
		}

		this.session = { kind: "idle" };
		this.rafPointerMove.cancel();
		this.deactivate();
	}
}
