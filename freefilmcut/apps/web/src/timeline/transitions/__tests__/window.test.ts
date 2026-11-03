import { describe, expect, test } from "bun:test";
import type { FrameRate } from "opencut-wasm";
import {
	clampTransitionDuration,
	DEFAULT_TRANSITION_DURATION_SEC,
	defaultTransitionDuration,
	packTimelineSampleTime,
	resizeTransitionDuration,
	symmetricDurationFromEdgeDelta,
	transitionWindow,
} from "@/timeline/transitions/window";
import { mediaTime, mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";

const FPS: FrameRate = { numerator: 30, denominator: 1 };

describe("defaultTransitionDuration", () => {
	test("defaults to one second", () => {
		expect(DEFAULT_TRANSITION_DURATION_SEC).toBe(1);
		expect(mediaTimeToSeconds({ time: defaultTransitionDuration() })).toBe(1);
	});
});

describe("transitionWindow", () => {
	test("centers window on cut", () => {
		const cutTime = mediaTime({ ticks: 1000 });
		const duration = mediaTime({ ticks: 200 });
		const { start, end } = transitionWindow({ cutTime, duration });
		expect(start).toEqual(mediaTime({ ticks: 900 }));
		expect(end).toEqual(mediaTime({ ticks: 1100 }));
	});
});

describe("packTimelineSampleTime", () => {
	test("maps window start to 0 and end to pack duration", () => {
		const windowStart = 100;
		const duration = 200;
		expect(
			packTimelineSampleTime({
				timelineTime: 100,
				windowStart,
				duration,
				packTimelineDurationSec: 1,
			}),
		).toBe(0);
		expect(
			packTimelineSampleTime({
				timelineTime: 300,
				windowStart,
				duration,
				packTimelineDurationSec: 1,
			}),
		).toBe(1);
	});

	test("returns midpoint at half pack duration", () => {
		expect(
			packTimelineSampleTime({
				timelineTime: 200,
				windowStart: 100,
				duration: 200,
				packTimelineDurationSec: 2,
			}),
		).toBe(1);
	});

	test("clamps before window to 0 and after to T", () => {
		expect(
			packTimelineSampleTime({
				timelineTime: 0,
				windowStart: 100,
				duration: 200,
				packTimelineDurationSec: 1,
			}),
		).toBe(0);
		expect(
			packTimelineSampleTime({
				timelineTime: 500,
				windowStart: 100,
				duration: 200,
				packTimelineDurationSec: 1,
			}),
		).toBe(1);
	});

	test("returns 0 when duration is non-positive", () => {
		expect(
			packTimelineSampleTime({
				timelineTime: 150,
				windowStart: 100,
				duration: 0,
				packTimelineDurationSec: 1,
			}),
		).toBe(0);
	});
});

describe("symmetricDurationFromEdgeDelta", () => {
	test("right edge grows and shrinks by twice the pointer delta", () => {
		const startDuration = mediaTime({ ticks: 1000 });
		expect(
			symmetricDurationFromEdgeDelta({
				startDuration,
				deltaTime: mediaTime({ ticks: 100 }),
				side: "right",
			}),
		).toEqual(mediaTime({ ticks: 1200 }));
		expect(
			symmetricDurationFromEdgeDelta({
				startDuration,
				deltaTime: mediaTime({ ticks: -100 }),
				side: "right",
			}),
		).toEqual(mediaTime({ ticks: 800 }));
	});

	test("left edge mirrors the right edge around the cut", () => {
		const startDuration = mediaTime({ ticks: 1000 });
		expect(
			symmetricDurationFromEdgeDelta({
				startDuration,
				deltaTime: mediaTime({ ticks: -100 }),
				side: "left",
			}),
		).toEqual(mediaTime({ ticks: 1200 }));
		expect(
			symmetricDurationFromEdgeDelta({
				startDuration,
				deltaTime: mediaTime({ ticks: 100 }),
				side: "left",
			}),
		).toEqual(mediaTime({ ticks: 800 }));
	});
});

describe("resizeTransitionDuration", () => {
	test("clamps symmetric growth to the shorter clip", () => {
		const resized = resizeTransitionDuration({
			startDuration: mediaTimeFromSeconds({ seconds: 1 }),
			deltaTime: mediaTimeFromSeconds({ seconds: 10 }),
			side: "right",
			fromDuration: mediaTimeFromSeconds({ seconds: 1 }),
			toDuration: mediaTimeFromSeconds({ seconds: 1 }),
			fps: FPS,
		});
		expect(mediaTimeToSeconds({ time: resized })).toBeCloseTo(2, 5);
	});
});

describe("clampTransitionDuration", () => {
	test("raises duration below two-frame minimum", () => {
		const tiny = mediaTime({ ticks: 1 });
		const clamped = clampTransitionDuration({
			duration: tiny,
			fromDuration: mediaTimeFromSeconds({ seconds: 10 }),
			toDuration: mediaTimeFromSeconds({ seconds: 10 }),
			fps: FPS,
		});
		const minSec = 2 / 30;
		expect(mediaTimeToSeconds({ time: clamped })).toBeCloseTo(minSec, 5);
	});

	test("lowers duration above clip-based max", () => {
		const fromDuration = mediaTimeFromSeconds({ seconds: 1 });
		const toDuration = mediaTimeFromSeconds({ seconds: 1 });
		const huge = mediaTimeFromSeconds({ seconds: 10 });
		const clamped = clampTransitionDuration({
			duration: huge,
			fromDuration,
			toDuration,
			fps: FPS,
		});
		expect(mediaTimeToSeconds({ time: clamped })).toBeCloseTo(2, 5);
	});

	test("caps at five seconds when clips allow more", () => {
		const long = mediaTimeFromSeconds({ seconds: 60 });
		const clamped = clampTransitionDuration({
			duration: mediaTimeFromSeconds({ seconds: 10 }),
			fromDuration: long,
			toDuration: long,
			fps: FPS,
		});
		expect(mediaTimeToSeconds({ time: clamped })).toBe(5);
	});
});
