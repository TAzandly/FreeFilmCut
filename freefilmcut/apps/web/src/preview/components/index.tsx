"use client";
import "@/vfxpack/troika-preconfig";
import { loadFlowerPackCatalog } from "@/vfxpack/flower-pack-catalog";
void loadFlowerPackCatalog();

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useEditor } from "@/editor/use-editor";
import { useContainerSize } from "@/hooks/use-container-size";
import { useFullscreen } from "@/hooks/use-fullscreen";
import { CanvasRenderer } from "@/services/renderer/canvas-renderer";
import { threeCompositor } from "@/services/renderer/compositor/three-compositor";
import { TICKS_PER_SECOND, mediaTimeToSeconds } from "@/wasm";
import type { RootNode } from "@/services/renderer/nodes/root-node";
import {
	buildScene,
	createSceneNodeCache,
} from "@/services/renderer/scene-builder";
import { PreviewOverlayLayer } from "./overlay-layer";
import { PreviewInteractionOverlay } from "./preview-interaction-overlay";
import { ContextMenu, ContextMenuTrigger } from "@/components/ui/context-menu";
import type {
	PreviewOverlayControl,
	PreviewOverlayInstance,
} from "@/preview/overlays";
import { PreviewContextMenu } from "./context-menu";
import { PreviewToolbar } from "./toolbar";
import {
	PreviewViewportProvider,
	usePreviewViewportState,
} from "./preview-viewport";
import { setCompositorAntialias } from "@/services/renderer/compositor/antialias-setting";
import { beginPerfPhase, endPerfPhase } from "@/utils/perf-mark";
import {
	incrementCounter,
	measureSpanSync,
} from "@/diagnostics/render-perf";
import {
	getPackVideoFrameEpoch,
	setPackVideoPreviewState,
} from "@/vfxpack/pack-video";
import {
	getFlowerTextFrameEpoch,
	onFlowerTextFrameEpoch,
} from "@/vfxpack/flower-text-epoch";
import {
	getLiveDragEpoch,
	onLiveDragEpoch,
} from "@/preview/live-drag-transform";
import {
	bindLiveParamPreviewScene,
	getLiveParamPreviewEpoch,
	onLiveParamPreviewEpoch,
} from "@/preview/live-param-preview";
import { usePreviewStore } from "@/preview/preview-store";
import { playbackQualityScale } from "@/preview/playback-quality";

function usePreviewSize() {
	const canvasSize = useEditor(
		(e) => e.project.getActive()?.settings.canvasSize,
	);

	return {
		width: canvasSize?.width,
		height: canvasSize?.height,
	};
}

function normalizeWheelDelta({
	delta,
	deltaMode,
	pageSize,
}: {
	delta: number;
	deltaMode: number;
	pageSize: number;
}): number {
	if (deltaMode === WheelEvent.DOM_DELTA_LINE) {
		return delta * 16;
	}

	if (deltaMode === WheelEvent.DOM_DELTA_PAGE) {
		return delta * pageSize;
	}

	return delta;
}

export function PreviewPanel({
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const containerRef = useRef<HTMLDivElement>(null);
	const [container, setContainer] = useState<HTMLDivElement | null>(null);
	const { toggleFullscreen } = useFullscreen({ containerRef });
	const handleContainerRef = useCallback((node: HTMLDivElement | null) => {
		containerRef.current = node;
		setContainer(node);
	}, []);

	return (
		<div
			ref={handleContainerRef}
			className="panel bg-background relative flex size-full min-h-0 min-w-0 flex-col rounded-sm border"
		>
			<PreviewCanvas
				container={container}
				onToggleFullscreen={toggleFullscreen}
				overlayControls={overlayControls}
				overlayInstances={overlayInstances}
				onOverlayVisibilityChange={onOverlayVisibilityChange}
			/>
			<RenderTreeController />
		</div>
	);
}

function RenderTreeController() {
	const editor = useEditor();
	const tracks = useEditor(
		(e) => e.timeline.getPreviewTracks() ?? e.scenes.getActiveScene().tracks,
	);
	const mediaAssets = useEditor((e) => e.media.getAssets());
	const activeProject = useEditor((e) => e.project.getActive());

	const { width, height } = usePreviewSize();
	const sceneCacheRef = useRef(createSceneNodeCache());

	useEffect(() => {
		return bindLiveParamPreviewScene({
			cache: sceneCacheRef.current,
			getCanvasSize: () => ({ width, height }),
		});
	}, [width, height]);

	/**
	 * Was `useDeepCompareEffect`, which is a tax paid on EVERY render, not just
	 * on change: `dequal` walks the whole dependency array first. With a real
	 * project that means a full traversal of every track × element × param
	 * (masks, effects, keyframes, transitions) on every preview frame, before
	 * the effect even decides whether to run.
	 *
	 * That walk buys nothing here: `updateSceneTracks` and `applyPreviewOverlay`
	 * both install a brand-new tracks object, so identity is already a stricter
	 * (and free) signal. Nothing mutates elements in place — and if something
	 * did, `dequal` would not have caught it either, because it compares against
	 * the same live object.
	 */
	useEffect(() => {
		if (!activeProject) return;

		const duration = editor.timeline.getTotalDuration();
		// Unchanged elements reuse their cached nodes; only edited clips are
		// rebuilt. When no node changed (audio-only edits, media list churn) the
		// previous tree comes back and nothing is published or re-rendered.
		const renderTree = measureSpanSync({
			name: "preview:buildScene",
			fn: () =>
				buildScene({
					tracks,
					mediaAssets,
					duration,
					canvasSize: { width, height },
					background: activeProject.settings.background,
					isPreview: true,
					cache: sceneCacheRef.current,
				}),
		});
		if (renderTree === editor.renderer.getRenderTree()) {
			incrementCounter({ name: "preview:treeReused" });
			return;
		}

		// setRenderTree notifies the renderer store synchronously, which fans out to
		// every renderer subscriber — measure it so a second cascade is visible.
		measureSpanSync({
			name: "preview:publishTree",
			fn: () => editor.renderer.setRenderTree({ renderTree }),
		});
		incrementCounter({ name: "preview:treePublish" });
		// eslint-disable-next-line react-hooks/exhaustive-deps -- editor.renderer / editor.timeline are process-wide singletons; activeProject is only read for settings.background, which is what the deps track (project metadata churn must NOT rebuild the tree).
	}, [tracks, mediaAssets, activeProject?.settings.background, width, height]);

	return null;
}


function PreviewCanvas({
	container,
	onToggleFullscreen,
	overlayControls,
	overlayInstances,
	onOverlayVisibilityChange,
}: {
	container: HTMLElement | null;
	onToggleFullscreen: () => void;
	overlayControls: PreviewOverlayControl[];
	overlayInstances: PreviewOverlayInstance[];
	onOverlayVisibilityChange: (params: {
		overlayId: string;
		isVisible: boolean;
	}) => void;
}) {
	const canvasMountRef = useRef<HTMLDivElement>(null);
	const viewportRef = useRef<HTMLDivElement>(null);
	const lastFrameRef = useRef(-1);
	const lastAntialiasRef = useRef(false);
	const lastVideoPlayRef = useRef(false);
	const lastVideoVolRef = useRef(1);
	const lastVideoEpochRef = useRef(0);
	const lastFlowerTextEpochRef = useRef(0);
	const lastLiveDragEpochRef = useRef(0);
	const lastLiveParamEpochRef = useRef(0);
	const lastSceneRef = useRef<RootNode | null>(null);
	const renderingRef = useRef(false);
	/** fcc-tl-flower-57: coalesce when a slow flower/PP frame is in flight. */
	const pendingRenderRef = useRef(false);
	const wakePreviewRef = useRef<() => void>(() => {});
	const { width: nativeWidth, height: nativeHeight } = usePreviewSize();
	const playbackQuality = usePreviewStore((s) => s.playbackQuality);
	const contentScale = playbackQualityScale(playbackQuality);
	const viewportSize = useContainerSize({ containerRef: viewportRef });
	const editor = useEditor();
	const activeProject = useEditor((e) => e.project.getActive());
	const renderTree = useEditor((e) => e.renderer.getRenderTree());
	const viewport = usePreviewViewportState({
		canvasHeight: nativeHeight,
		canvasWidth: nativeWidth,
		viewportHeight: viewportSize.height,
		viewportRef,
		viewportWidth: viewportSize.width,
	});
	const { canPan, panByScreenDelta, scaleZoom } = viewport;

	const renderer = useMemo(() => {
		return new CanvasRenderer({
			width: nativeWidth,
			height: nativeHeight,
			fps: activeProject.settings.fps,
			contentScale,
		});
	}, [nativeWidth, nativeHeight, activeProject.settings.fps, contentScale]);

	useEffect(() => {
		lastFrameRef.current = -1;
	}, [contentScale, renderer]);

	// Mount the compositor's output canvas directly into the preview. wgpu
	// renders straight into this element, so there is no intermediate copy —
	// the container div owns positioning/styling, the canvas itself fills it.
	useEffect(() => {
		const mount = canvasMountRef.current;
		if (!mount) return;
		const outputCanvas = renderer.getOutputCanvas();
		outputCanvas.style.display = "block";
		outputCanvas.style.width = "100%";
		outputCanvas.style.height = "100%";
		mount.appendChild(outputCanvas);
		return () => {
			if (outputCanvas.parentElement === mount) {
				mount.removeChild(outputCanvas);
			}
		};
	}, [renderer]);

	// fcc-tl-flower-67: return true to keep RAF; false = sleep until wake (play/seek/epoch).
	const render = useCallback((): boolean => {
		if (!renderTree) return false;
		// Export owns the shared WebGL canvas — do not resize/draw over it.
		if (threeCompositor.isExportSizeLocked()) return false;

		const antialias = !!editor.project.getActive()?.settings.antialias;
		setCompositorAntialias(antialias);
		const scrubbing = editor.playback.getIsScrubbing();
		const playing = editor.playback.getIsPlaying() && !scrubbing;
		const volume = editor.playback.getVolume();
		const lastFrameTime = editor.timeline.getLastFrameTime();
		const snappedTime = Math.min(editor.playback.getCurrentTime(), lastFrameTime);
		// fcc-tl-flower-57: continuous playhead for VideoPlayer free-run (editor tVideo).
		const continuousTime = Math.min(
			editor.playback.getCurrentTimeContinuous(),
			lastFrameTime,
		);
		setPackVideoPreviewState({
			playing,
			scrubbing,
			volume,
			timelineSec: mediaTimeToSeconds({ time: continuousTime }),
			timelineSecSnapped: mediaTimeToSeconds({ time: snappedTime }),
		});
		if (
			playing !== lastVideoPlayRef.current ||
			volume !== lastVideoVolRef.current
		) {
			lastVideoPlayRef.current = playing;
			lastVideoVolRef.current = volume;
			lastFrameRef.current = -1;
		}
		if (antialias !== lastAntialiasRef.current) {
			lastAntialiasRef.current = antialias;
			lastFrameRef.current = -1;
		}

		const renderTime = snappedTime;
		const ticksPerFrame = Math.round(
			(TICKS_PER_SECOND * renderer.fps.denominator) / renderer.fps.numerator,
		);
		const frame = Math.floor(renderTime / ticksPerFrame);
		const videoEpoch = getPackVideoFrameEpoch();
		const flowerTextEpoch = getFlowerTextFrameEpoch();
		const liveDragEpoch = getLiveDragEpoch();
		const liveParamEpoch = getLiveParamPreviewEpoch();
		// Frame-gated, playing or not: the canvas keeps the last frame
		// (preserveDrawingBuffer), and video/pack sources are sampled at the
		// snapped project frame, so re-composing an unchanged frame is pure waste.
		// Preview therefore steps at project fps, like export.
		// Live canvas-drag / property scrub bumps an epoch so the frame moves
		// without a new scene tree.
		const videoFrameDirty = videoEpoch !== lastVideoEpochRef.current;
		const flowerTextDirty = flowerTextEpoch !== lastFlowerTextEpochRef.current;
		const liveDragDirty = liveDragEpoch !== lastLiveDragEpochRef.current;
		const liveParamDirty = liveParamEpoch !== lastLiveParamEpochRef.current;
		const pending = pendingRenderRef.current;
		const transportActive = playing || scrubbing;
		const frameDirty =
			videoFrameDirty ||
			flowerTextDirty ||
			liveDragDirty ||
			liveParamDirty ||
			frame !== lastFrameRef.current ||
			renderTree !== lastSceneRef.current;

		if (renderingRef.current) {
			// Coalesce: remember that playhead/epoch moved so we redraw when free.
			if (frameDirty) pendingRenderRef.current = true;
			return true;
		}

		if (!pending && !frameDirty) {
			// fcc-tl-flower-67: paused still-frame — stop RAF; wake on play/seek/epoch.
			return transportActive;
		}

		pendingRenderRef.current = false;
		renderingRef.current = true;
		lastSceneRef.current = renderTree;
		lastFrameRef.current = frame;
		lastVideoEpochRef.current = videoEpoch;
		lastFlowerTextEpochRef.current = flowerTextEpoch;
		lastLiveDragEpochRef.current = liveDragEpoch;
		lastLiveParamEpochRef.current = liveParamEpoch;
		// Dev-only: `render()` is async, but everything before its first truly
		// yielding await — shader compile, texture upload, RT reallocation —
		// runs in the caller's task and blocks the frame. `compose:sync` measures
		// exactly that head so a 110ms hitch can be attributed to it rather than
		// guessed at. `compose` covers the whole call including async tail.
		beginPerfPhase({ phase: "compose:sync" });
		beginPerfPhase({ phase: "compose" });
		const composePromise = renderer.render({ node: renderTree, time: renderTime });
		endPerfPhase({ phase: "compose:sync" });
		composePromise
			.then(() => {
				endPerfPhase({ phase: "compose" });
				renderingRef.current = false;
				// Wake if a coalesce landed while we were rendering.
				if (pendingRenderRef.current) {
					wakePreviewRef.current();
				}
			})
			.catch((err) => {
				endPerfPhase({ phase: "compose" });
				console.error("[FreeFilmCut] preview render failed", err);
				renderingRef.current = false;
				// Allow RAF to retry after a failed/hung-cleared frame
				lastFrameRef.current = -1;
				wakePreviewRef.current();
			});
		return true;
	}, [renderer, renderTree, editor.playback, editor.timeline, contentScale]);

	// fcc-tl-flower-67: sleep preview RAF when paused on an unchanged still frame.
	useEffect(() => {
		let rafId = 0;
		let alive = true;

		const schedule = () => {
			if (!alive || rafId) return;
			rafId = requestAnimationFrame(() => {
				rafId = 0;
				if (!alive) return;
				const cont = render();
				if (cont) schedule();
			});
		};
		wakePreviewRef.current = schedule;

		const unsubPlay = editor.playback.subscribe(schedule);
		const unsubUpdate = editor.playback.onUpdate(() => schedule());
		const unsubSeek = editor.playback.onSeek(() => schedule());
		const unsubEpoch = onFlowerTextFrameEpoch(schedule);
		const unsubLiveDrag = onLiveDragEpoch(schedule);
		const unsubLiveParam = onLiveParamPreviewEpoch(schedule);

		schedule();

		return () => {
			alive = false;
			wakePreviewRef.current = () => {};
			if (rafId) cancelAnimationFrame(rafId);
			unsubPlay();
			unsubUpdate();
			unsubSeek();
			unsubEpoch();
			unsubLiveDrag();
			unsubLiveParam();
		};
	}, [render, editor.playback]);


	useEffect(() => {
		const container = viewportRef.current;
		if (!container) return;

		let pendingZoomDelta = 0;
		let pendingPanDeltaX = 0;
		let pendingPanDeltaY = 0;
		let zoomRafId: ReturnType<typeof requestAnimationFrame> | null = null;
		let panRafId: ReturnType<typeof requestAnimationFrame> | null = null;

		const onWheel = (event: WheelEvent) => {
			const normalizedDeltaX = normalizeWheelDelta({
				delta: event.deltaX,
				deltaMode: event.deltaMode,
				pageSize: container.clientWidth,
			});
			const normalizedDeltaY = normalizeWheelDelta({
				delta: event.deltaY,
				deltaMode: event.deltaMode,
				pageSize: container.clientHeight,
			});
			const isZoomGesture = event.ctrlKey || event.metaKey;
			if (isZoomGesture) {
				event.preventDefault();
				pendingZoomDelta += normalizedDeltaY;

				if (zoomRafId === null) {
					zoomRafId = requestAnimationFrame(() => {
						const cappedDelta =
							Math.sign(pendingZoomDelta) *
							Math.min(Math.abs(pendingZoomDelta), 30);
						const zoomFactor = Math.exp(-cappedDelta / 300);

						scaleZoom({ factor: zoomFactor });
						pendingZoomDelta = 0;
						zoomRafId = null;
					});
				}

				return;
			}

			if (!canPan) {
				return;
			}

			if (normalizedDeltaX === 0 && normalizedDeltaY === 0) {
				return;
			}

			event.preventDefault();
			pendingPanDeltaX += normalizedDeltaX;
			pendingPanDeltaY += normalizedDeltaY;

			if (panRafId === null) {
				panRafId = requestAnimationFrame(() => {
					panByScreenDelta({
						deltaX: pendingPanDeltaX,
						deltaY: pendingPanDeltaY,
					});
					pendingPanDeltaX = 0;
					pendingPanDeltaY = 0;
					panRafId = null;
				});
			}
		};

		container.addEventListener("wheel", onWheel, {
			capture: true,
			passive: false,
		});

		return () => {
			container.removeEventListener("wheel", onWheel, {
				capture: true,
			});
			if (zoomRafId !== null) {
				cancelAnimationFrame(zoomRafId);
			}
			if (panRafId !== null) {
				cancelAnimationFrame(panRafId);
			}
		};
	}, [canPan, panByScreenDelta, scaleZoom]);

	return (
		<PreviewViewportProvider value={viewport}>
			<div className="flex size-full min-h-0 min-w-0 flex-col">
				<div className="flex min-h-0 min-w-0 flex-1 p-2 pb-0">
					<ContextMenu>
						<ContextMenuTrigger asChild>
							<div
								ref={viewportRef}
								className="relative flex size-full min-h-0 min-w-0 items-center justify-center overflow-hidden"
							>
							<div
								ref={canvasMountRef}
								className="absolute block border"
								style={{
									left: viewport.sceneLeft,
									top: viewport.sceneTop,
									width: viewport.sceneWidth,
									height: viewport.sceneHeight,
									background:
										activeProject.settings.background.type === "color"
											? activeProject.settings.background.color
											: "#000000",
								}}
							/>
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="under-interaction"
								/>
								<PreviewInteractionOverlay />
								<PreviewOverlayLayer
									instances={overlayInstances}
									plane="over-interaction"
								/>
							</div>
						</ContextMenuTrigger>
						<PreviewContextMenu
							onToggleFullscreen={onToggleFullscreen}
							container={container}
							overlayControls={overlayControls}
							onOverlayVisibilityChange={onOverlayVisibilityChange}
						/>
					</ContextMenu>
				</div>
				<PreviewToolbar onToggleFullscreen={onToggleFullscreen} />
			</div>
		</PreviewViewportProvider>
	);
}
