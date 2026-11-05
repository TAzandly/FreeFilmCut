import { describe, expect, test } from "bun:test";
import type { TimelineElement } from "@/timeline";
import {
	canShowFreeze,
	canShowReverse,
	canShowMirrorOrRotate,
	buildMirrorPatches,
	buildRotate90Patches,
	buildFreezeRippleUpdates,
	FREEZE_DURATION_SECONDS,
	normalizeDegrees,
	resolveFreezeSourceTime,
} from "@/timeline/clip-quick-actions";
import { mediaTime, mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

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
			{
				trackId: "t",
				elementId: "a",
				patch: { params: { "transform.scaleX": -1 } },
			},
			{
				trackId: "t",
				elementId: "b",
				patch: { params: { "transform.scaleX": 1 } },
			},
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

describe("freeze frame", () => {
	test("freeze duration is 3 seconds", () => {
		expect(FREEZE_DURATION_SECONDS).toBe(3);
	});

	test("ripple shifts only elements at or after the cut", () => {
		const afterTime = mediaTime({ ticks: 500 });
		const delta = mediaTime({ ticks: 300 });
		const updates = buildFreezeRippleUpdates({
			trackId: "track",
			elements: [
				{ id: "video", startTime: mediaTime({ ticks: 0 }) },
				{ id: "before", startTime: mediaTime({ ticks: 499 }) },
				{ id: "at-cut", startTime: mediaTime({ ticks: 500 }) },
				{ id: "later", startTime: mediaTime({ ticks: 800 }) },
			],
			afterTime,
			delta,
		});
		expect(updates).toEqual([
			{
				trackId: "track",
				elementId: "at-cut",
				patch: { startTime: mediaTime({ ticks: 800 }) },
			},
			{
				trackId: "track",
				elementId: "later",
				patch: { startTime: mediaTime({ ticks: 1100 }) },
			},
		]);
		expect(
			buildFreezeRippleUpdates({
				trackId: "track",
				elements: [{ id: "video", startTime: mediaTime({ ticks: 500 }) }],
				afterTime,
				delta,
				excludeElementId: "video",
			}),
		).toEqual([]);
	});

	test("last visible source time honors reverse and retime", () => {
		const fps = { numerator: 5, denominator: 1 };
		const duration = mediaTimeFromSeconds({ seconds: 10 });
		const trimStart = mediaTimeFromSeconds({ seconds: 2 });
		const seconds = ({
			time,
		}: {
			time: ReturnType<typeof resolveFreezeSourceTime>;
		}) => mediaTimeToSeconds({ time });

		expect(
			seconds({
				time: resolveFreezeSourceTime({
					duration,
					trimStart,
					reversed: false,
					fps,
				}),
			}),
		).toBeCloseTo(11.8, 5);
		expect(
			seconds({
				time: resolveFreezeSourceTime({
					duration,
					trimStart,
					reversed: true,
					fps,
				}),
			}),
		).toBeCloseTo(2.2, 5);
		expect(
			seconds({
				time: resolveFreezeSourceTime({
					duration,
					trimStart,
					retime: { rate: 2 },
					reversed: true,
					fps,
				}),
			}),
		).toBeCloseTo(2.4, 5);
	});
});
