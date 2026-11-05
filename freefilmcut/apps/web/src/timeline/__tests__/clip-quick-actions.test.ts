import { describe, expect, test } from "bun:test";
import type { TimelineElement } from "@/timeline";
import {
	canShowFreeze,
	canShowReverse,
	canShowMirrorOrRotate,
	buildMirrorPatches,
	buildRotate90Patches,
	normalizeDegrees,
} from "@/timeline/clip-quick-actions";

const video = {
	type: "video" as const,
	params: { "transform.scaleX": 1, "transform.rotate": 0 },
} as TimelineElement;
const image = {
	type: "image" as const,
	params: { "transform.scaleX": 1, "transform.rotate": 90 },
} as TimelineElement;
const text = { type: "text" as const, params: {} } as TimelineElement;

describe("visibility gates", () => {
	test("freeze/reverse only for single video", () => {
		expect(canShowFreeze({ elements: [video] })).toBe(true);
		expect(canShowFreeze({ elements: [video, video] })).toBe(false);
		expect(canShowFreeze({ elements: [image] })).toBe(false);
		expect(canShowReverse({ elements: [video] })).toBe(true);
		expect(canShowReverse({ elements: [image] })).toBe(false);
	});

	test("mirror/rotate when any video|image|sticker selected", () => {
		expect(canShowMirrorOrRotate({ elements: [image] })).toBe(true);
		expect(canShowMirrorOrRotate({ elements: [text] })).toBe(false);
		expect(canShowMirrorOrRotate({ elements: [text, image] })).toBe(true);
	});
});

describe("patches", () => {
	test("mirror flips scaleX per element", () => {
		const patches = buildMirrorPatches({
			items: [
				{
					trackId: "t",
					elementId: "a",
					element: {
						...video,
						params: { "transform.scaleX": 1 },
					} as TimelineElement,
				},
				{
					trackId: "t",
					elementId: "b",
					element: {
						...image,
						params: { "transform.scaleX": -1 },
					} as TimelineElement,
				},
				{ trackId: "t", elementId: "c", element: text },
			],
		});
		expect(patches).toEqual([
			{ trackId: "t", elementId: "a", patch: { params: { "transform.scaleX": -1 } } },
			{ trackId: "t", elementId: "b", patch: { params: { "transform.scaleX": 1 } } },
		]);
	});

	test("rotate adds 90 and wraps", () => {
		expect(normalizeDegrees({ degrees: 360 })).toBe(0);
		expect(normalizeDegrees({ degrees: 450 })).toBe(90);
		const patches = buildRotate90Patches({
			items: [
				{
					trackId: "t",
					elementId: "a",
					element: {
						...image,
						params: { "transform.rotate": 270 },
					} as TimelineElement,
				},
			],
		});
		expect(patches[0]?.patch).toEqual({ params: { "transform.rotate": 0 } });
	});
});
