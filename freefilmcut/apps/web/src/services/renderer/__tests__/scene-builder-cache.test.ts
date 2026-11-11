import { describe, expect, test } from "bun:test";
import type { MediaAsset } from "@/media";
import type { SceneTracks, TimelineElement } from "@/timeline";
import { VideoNode } from "../nodes/video-node";
import { buildScene, createSceneNodeCache } from "../scene-builder";

function effect(id: string, startTime: number): TimelineElement {
	return {
		id,
		type: "effect",
		effectType: "blur",
		params: {},
		startTime,
		duration: 100,
		trimStart: 0,
		trimEnd: 0,
	} as unknown as TimelineElement;
}

function videoClip(id: string, mediaId: string): TimelineElement {
	return {
		id,
		type: "video",
		mediaId,
		params: {
			transform: { x: 0, y: 0, scaleX: 1, scaleY: 1, rotation: 0 },
			opacity: 1,
		},
		startTime: 0,
		duration: 500,
		trimStart: 0,
		trimEnd: 0,
	} as unknown as TimelineElement;
}

function tracksOf(elements: TimelineElement[]): SceneTracks {
	return {
		overlay: [],
		main: { id: "main", type: "video", elements, transitions: [] },
		audio: [],
	} as unknown as SceneTracks;
}

function fakeVideoMedia(id: string): MediaAsset {
	return {
		id,
		type: "video",
		name: "clip.mp4",
		url: "blob:fake-video",
		file: new File([], "clip.mp4", { type: "video/mp4" }),
		duration: 500,
	} as MediaAsset;
}

function build(
	tracks: SceneTracks,
	cache: ReturnType<typeof createSceneNodeCache>,
	mediaAssets: MediaAsset[] = [],
) {
	return buildScene({
		tracks,
		mediaAssets,
		duration: 1000,
		canvasSize: { width: 1920, height: 1080 },
		background: { type: "color", color: "#000000" },
		isPreview: true,
		cache,
	});
}

describe("buildScene node cache", () => {
	test("returns the same tree when nothing visual changed", () => {
		const cache = createSceneNodeCache();
		const a = effect("a", 0);
		const b = effect("b", 200);
		const first = build(tracksOf([a, b]), cache);
		// New tracks object, same element objects (e.g. an audio-only edit).
		const second = build(tracksOf([a, b]), cache);
		expect(second).toBe(first);
	});

	test("rebuilds only the structurally edited element's nodes", () => {
		const cache = createSceneNodeCache();
		const a = effect("a", 0);
		const b = effect("b", 200);
		const first = build(tracksOf([a, b]), cache);
		const retypedB = { ...b, effectType: "sharpen" } as TimelineElement;
		const second = build(tracksOf([a, retypedB]), cache);

		expect(second).not.toBe(first);
		// children[0] is the project background color.
		expect(second.children[0]).toBe(first.children[0]);
		expect(second.children[1]).toBe(first.children[1]);
		expect(second.children[2]).not.toBe(first.children[2]);
	});

	test("params-only scrub patches nodes and publishes a new root", () => {
		const cache = createSceneNodeCache();
		const a = effect("a", 0);
		const b = effect("b", 200);
		const first = build(tracksOf([a, b]), cache);
		// New element object (preview overlay spread) — timing only, same structure.
		const movedB = { ...b, startTime: 300 } as TimelineElement;
		const second = build(tracksOf([a, movedB]), cache);

		expect(second).not.toBe(first);
		expect(second.children[0]).toBe(first.children[0]);
		expect(second.children[1]).toBe(first.children[1]);
		// Same GPU/effect node instance — patched in place.
		expect(second.children[2]).toBe(first.children[2]);
		expect(second.children[2]?.params.timeOffset).toBe(300);
	});

	test("Basic color-grade scrub keeps VideoNode identity", () => {
		const cache = createSceneNodeCache();
		const media = fakeVideoMedia("m1");
		const clip = videoClip("v1", "m1");
		const first = build(tracksOf([clip]), cache, [media]);
		const videoNode = first.children.find((n) => n instanceof VideoNode);
		expect(videoNode).toBeTruthy();

		const scrubbed = {
			...clip,
			params: {
				...clip.params,
				"colorGrade.brightness": 0.2,
				"colorGrade.contrast": 0.1,
			},
		} as TimelineElement;
		const second = build(tracksOf([scrubbed]), cache, [media]);
		const videoNode2 = second.children.find((n) => n instanceof VideoNode);

		expect(second).not.toBe(first);
		expect(videoNode2).toBe(videoNode);
		expect(videoNode2?.params.colorGrade?.basic.brightness).toBe(0.2);
		expect(videoNode2?.params.colorGrade?.basic.contrast).toBe(0.1);
	});

	test("beauty.* params plumb onto VideoNode params and patch in place", () => {
		const cache = createSceneNodeCache();
		const media = fakeVideoMedia("m1");
		const clip = videoClip("v1", "m1");
		const first = build(tracksOf([clip]), cache, [media]);
		const videoNode = first.children.find((n) => n instanceof VideoNode);
		expect(videoNode?.params.beauty).toBeNull();

		const beautified = {
			...clip,
			params: { ...clip.params, "beauty.smooth": 0.6 },
		} as TimelineElement;
		const second = build(tracksOf([beautified]), cache, [media]);
		const videoNode2 = second.children.find((n) => n instanceof VideoNode);

		expect(videoNode2).toBe(videoNode);
		expect(videoNode2?.params.beauty?.smooth).toBe(0.6);
	});

	test("without a cache every call builds a fresh tree", () => {
		const tracks = tracksOf([effect("a", 0)]);
		const params = {
			tracks,
			mediaAssets: [],
			duration: 1000,
			canvasSize: { width: 1920, height: 1080 },
			background: { type: "color" as const, color: "#000000" },
		};
		expect(buildScene(params)).not.toBe(buildScene(params));
	});
});
