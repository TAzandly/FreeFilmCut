import { describe, expect, test, afterEach } from "bun:test";
import type { DragEvent } from "react";
import {
	DragDropController,
	type DragDropConfig,
} from "@/timeline/controllers/drag-drop-controller";
import {
	resolveTransitionCutDrop,
	TRANSITION_CUT_HIT_THRESHOLD_PX,
} from "@/timeline/controllers/transition-cut-drop";
import { TimelineDragSource } from "@/timeline/drag-source";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import {
	TIMELINE_CONTENT_TOP_PADDING_PX,
	TIMELINE_TRACK_GAP_PX,
} from "@/timeline/components/layout";
import { getTrackHeight } from "@/timeline/components/track-layout";
import type {
	AudioElement,
	AudioTrack,
	ImageElement,
	SceneTracks,
	TextTrack,
	TimelineTrack,
	VideoElement,
	VideoTrack,
} from "@/timeline";
import { getVfxPackPlacement } from "@/vfxpack/pack-placement";
import { usePackRegistry } from "@/vfxpack/pack-registry";
import type { LoadedVfxPack } from "@/vfxpack/types";
import { mediaTime, TICKS_PER_SECOND, ZERO_MEDIA_TIME } from "@/wasm";

const SECOND = TICKS_PER_SECOND;

function videoElement({
	id,
	start,
	duration,
}: {
	id: string;
	start: number;
	duration: number;
}): VideoElement {
	return {
		id,
		type: "video",
		name: id,
		startTime: mediaTime({ ticks: start }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: `media-${id}`,
		params: {},
	};
}

function imageElement({
	id,
	start,
	duration,
}: {
	id: string;
	start: number;
	duration: number;
}): ImageElement {
	return {
		id,
		type: "image",
		name: id,
		startTime: mediaTime({ ticks: start }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: `media-${id}`,
		params: {},
	};
}

function audioElement({
	id,
	start,
	duration,
}: {
	id: string;
	start: number;
	duration: number;
}): AudioElement {
	return {
		id,
		type: "audio",
		sourceType: "upload",
		name: id,
		startTime: mediaTime({ ticks: start }),
		duration: mediaTime({ ticks: duration }),
		trimStart: ZERO_MEDIA_TIME,
		trimEnd: ZERO_MEDIA_TIME,
		mediaId: `media-${id}`,
		params: {},
	};
}

function videoTrack({
	id,
	elements,
}: {
	id: string;
	elements: VideoTrack["elements"];
}): VideoTrack {
	return {
		id,
		name: id,
		type: "video",
		elements,
		transitions: [],
		muted: false,
		hidden: false,
	};
}

function textTrack(): TextTrack {
	return {
		id: "titles",
		name: "titles",
		type: "text",
		elements: [],
		hidden: false,
	};
}

function audioTrack(): AudioTrack {
	return {
		id: "music",
		name: "music",
		type: "audio",
		muted: false,
		elements: [
			audioElement({ id: "s1", start: 0, duration: SECOND }),
			audioElement({ id: "s2", start: SECOND, duration: SECOND }),
		],
	};
}

function yInside({
	tracks,
	trackIndex,
}: {
	tracks: TimelineTrack[];
	trackIndex: number;
}): number {
	let top = TIMELINE_CONTENT_TOP_PADDING_PX;
	for (let i = 0; i < trackIndex; i++) {
		top += getTrackHeight({ type: tracks[i].type }) + TIMELINE_TRACK_GAP_PX;
	}
	return top + 8;
}

function cutX({ ticks }: { ticks: number }): number {
	return timelineTimeToPixels({
		time: mediaTime({ ticks }),
		zoomLevel: 1,
	});
}

describe("getVfxPackPlacement transition", () => {
	test("does not insert an effect track and points at the cut", () => {
		expect(TRANSITION_CUT_HIT_THRESHOLD_PX).toBe(12);
		const placement = getVfxPackPlacement({ type: "transition" });
		expect(placement.insertTrackType).toBeNull();
		expect(placement.dragHint).toBe(
			"Drag onto the cut between two adjacent clips",
		);
		expect(placement.targetElementTypes).toEqual([]);
	});
});

describe("resolveTransitionCutDrop", () => {
	const video = videoTrack({
		id: "main",
		elements: [
			videoElement({ id: "a", start: 0, duration: SECOND }),
			imageElement({ id: "b", start: SECOND, duration: SECOND }),
			videoElement({ id: "c", start: 2 * SECOND, duration: SECOND }),
		],
	});
	const tracks: TimelineTrack[] = [textTrack(), video, audioTrack()];
	const videoY = yInside({ tracks, trackIndex: 1 });

	test("picks the nearest adjacent cut within 12px on the video track", () => {
		const firstCut = cutX({ ticks: SECOND });
		const target = resolveTransitionCutDrop({
			mouseX: firstCut + 10,
			mouseY: videoY,
			tracks,
			zoomLevel: 1,
		});
		expect(target?.transitionCut).toEqual({
			trackId: "main",
			fromElementId: "a",
			toElementId: "b",
			cutTime: mediaTime({ ticks: SECOND }),
		});
		expect(target?.targetElement).toBeNull();
		expect(target?.isNewTrack).toBe(false);

		const second = resolveTransitionCutDrop({
			mouseX: cutX({ ticks: 2 * SECOND }) - 9,
			mouseY: videoY,
			tracks,
			zoomLevel: 1,
		});
		expect(second?.transitionCut?.fromElementId).toBe("b");
		expect(second?.transitionCut?.toElementId).toBe("c");
	});

	test("accepts the cut at exactly 12px and refuses 13px", () => {
		const cut = cutX({ ticks: SECOND });
		expect(
			resolveTransitionCutDrop({
				mouseX: cut + TRANSITION_CUT_HIT_THRESHOLD_PX,
				mouseY: videoY,
				tracks,
				zoomLevel: 1,
			})?.transitionCut?.fromElementId,
		).toBe("a");
		expect(
			resolveTransitionCutDrop({
				mouseX: cut + TRANSITION_CUT_HIT_THRESHOLD_PX + 1,
				mouseY: videoY,
				tracks,
				zoomLevel: 1,
			}),
		).toBeNull();
	});

	test("refuses gaps, other tracks, and the space between tracks", () => {
		const gapped = videoTrack({
			id: "main",
			elements: [
				videoElement({ id: "a", start: 0, duration: SECOND }),
				videoElement({ id: "b", start: 3 * SECOND, duration: SECOND }),
			],
		});
		expect(
			resolveTransitionCutDrop({
				mouseX: cutX({ ticks: SECOND }),
				mouseY: yInside({ tracks: [gapped], trackIndex: 0 }),
				tracks: [gapped],
				zoomLevel: 1,
			}),
		).toBeNull();

		expect(
			resolveTransitionCutDrop({
				mouseX: cutX({ ticks: SECOND }),
				mouseY: yInside({ tracks, trackIndex: 0 }),
				tracks,
				zoomLevel: 1,
			}),
		).toBeNull();

		expect(
			resolveTransitionCutDrop({
				mouseX: cutX({ ticks: SECOND }),
				mouseY: yInside({ tracks, trackIndex: 2 }),
				tracks,
				zoomLevel: 1,
			}),
		).toBeNull();

		const gapY =
			TIMELINE_CONTENT_TOP_PADDING_PX +
			getTrackHeight({ type: "text" }) +
			1;
		expect(
			resolveTransitionCutDrop({
				mouseX: cutX({ ticks: SECOND }),
				mouseY: gapY,
				tracks,
				zoomLevel: 1,
			}),
		).toBeNull();
	});
});

function transitionPack(): LoadedVfxPack {
	return {
		id: "fade",
		displayName: "Fade",
		type: "Transition",
		scope: "clip",
		manifest: {
			schema: "freecapcut.vfxpack/1",
			id: "fade",
			version: "1",
			displayName: "Fade",
			type: "transition",
		},
		scene: null,
		files: new Map(),
		objectUrls: new Map(),
		sourceFileName: "fade.vfxpack",
	};
}

describe("DragDropController transition drop", () => {
	afterEach(() => {
		usePackRegistry.setState({ packs: [], activeOverlayIds: [] });
	});

	test("upserts the cut and does not insert an element or clip effect", () => {
		usePackRegistry.getState().registerPack(transitionPack());
		const upserts: Array<{
			trackId: string;
			fromElementId: string;
			toElementId: string;
			packId: string;
		}> = [];
		let inserts = 0;
		let clipEffects = 0;
		const main = videoTrack({
			id: "main",
			elements: [
				videoElement({ id: "a", start: 0, duration: 2 * SECOND }),
				videoElement({ id: "b", start: 2 * SECOND, duration: SECOND }),
			],
		});
		const scene: SceneTracks = { overlay: [], main, audio: [] };
		const dragSource = new TimelineDragSource();
		dragSource.begin({
			dataTransfer: {
				setData() {},
				effectAllowed: "copy",
			} as unknown as DataTransfer,
			dragData: {
				id: "vfxpack:fade",
				name: "Fade",
				type: "effect",
				effectType: "vfxpack:fade",
				targetElementTypes: [],
			},
		});

		const config: DragDropConfig = {
			zoomLevel: 1,
			getContainerEl: () => null,
			getHeaderEl: () => null,
			getTracksScrollEl: () =>
				({
					getBoundingClientRect: () => ({
						left: 0,
						top: 0,
						right: 800,
						bottom: 400,
						width: 800,
						height: 400,
						x: 0,
						y: 0,
						toJSON() {
							return {};
						},
					}),
					scrollLeft: 0,
					scrollTop: 0,
				}) as unknown as HTMLDivElement,
			getActiveProjectFps: () => null,
			getActiveProjectId: () => "project",
			getSceneTracks: () => scene,
			getCurrentPlayheadTime: () => ZERO_MEDIA_TIME,
			getMediaAssets: () => [],
			dragSource,
			addMediaAsset: async () => null,
			executeCommand: () => {},
			insertElement: () => {
				inserts += 1;
			},
			addClipEffect: () => {
				clipEffects += 1;
			},
			upsertTransition: (args) => {
				upserts.push(args);
			},
		};

		const controller = new DragDropController({
			configRef: { current: config },
		});
		const cut = cutX({ ticks: 2 * SECOND });
		const y = yInside({ tracks: [main], trackIndex: 0 });
		const over = pointerEvent({ x: cut, y });
		controller.onDragOver(over.event);
		expect(controller.dropTarget?.transitionCut).toMatchObject({
			trackId: "main",
			fromElementId: "a",
			toElementId: "b",
		});
		expect(over.dataTransfer.dropEffect).toBe("copy");

		controller.onDrop(pointerEvent({ x: cut, y }).event);
		expect(upserts).toEqual([
			{
				trackId: "main",
				fromElementId: "a",
				toElementId: "b",
				packId: "fade",
			},
		]);
		expect(inserts).toBe(0);
		expect(clipEffects).toBe(0);

		const missed = pointerEvent({ x: cut + 40, y });
		controller.onDragOver(missed.event);
		expect(controller.dropTarget).toBeNull();
		expect(missed.dataTransfer.dropEffect).toBe("none");
		controller.onDrop(missed.event);
		expect(upserts).toHaveLength(1);
		expect(inserts).toBe(0);
		expect(clipEffects).toBe(0);
		controller.destroy();
	});
});

function pointerEvent({ x, y }: { x: number; y: number }): {
	event: DragEvent;
	dataTransfer: { dropEffect: string };
} {
	const dataTransfer = {
		dropEffect: "copy",
		types: [] as string[],
		files: [] as File[],
	};
	return {
		dataTransfer,
		event: {
			preventDefault() {},
			clientX: x,
			clientY: y,
			dataTransfer,
		} as unknown as DragEvent,
	};
}
