import { describe, expect, test } from "bun:test";
import type { SceneTracks, TimelineElement } from "@/timeline";
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

function tracksOf(elements: TimelineElement[]): SceneTracks {
	return {
		overlay: [],
		main: { id: "main", type: "video", elements, transitions: [] },
		audio: [],
	} as unknown as SceneTracks;
}

function build(tracks: SceneTracks, cache: ReturnType<typeof createSceneNodeCache>) {
	return buildScene({
		tracks,
		mediaAssets: [],
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

	test("rebuilds only the edited element's nodes", () => {
		const cache = createSceneNodeCache();
		const a = effect("a", 0);
		const b = effect("b", 200);
		const first = build(tracksOf([a, b]), cache);
		const movedB = { ...b, startTime: 300 } as TimelineElement;
		const second = build(tracksOf([a, movedB]), cache);

		expect(second).not.toBe(first);
		// children[0] is the project background color.
		expect(second.children[0]).toBe(first.children[0]);
		expect(second.children[1]).toBe(first.children[1]);
		expect(second.children[2]).not.toBe(first.children[2]);
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
