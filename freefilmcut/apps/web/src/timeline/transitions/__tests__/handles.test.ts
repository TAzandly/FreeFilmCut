import { describe, expect, test } from "bun:test";
import { sampleTransitionSourceTime } from "@/timeline/transitions/handles";
import { mediaTime, mediaTimeToSeconds } from "@/wasm";

describe("sampleTransitionSourceTime", () => {
	const elementStart = mediaTime({ ticks: 0 });
	const elementDuration = mediaTime({ ticks: 100 });
	const trimStart = mediaTime({ ticks: 0 });
	const trimEnd = mediaTime({ ticks: 0 });
	const cutTime = mediaTime({ ticks: 100 });

	test("from: inside visible clip uses live source mapping", () => {
		const result = sampleTransitionSourceTime({
			role: "from",
			timelineTime: mediaTime({ ticks: 80 }),
			elementStart,
			elementDuration,
			trimStart,
			trimEnd,
			sourceDuration: mediaTime({ ticks: 200 }),
			cutTime,
		});
		expect(result.frozen).toBe(false);
		expect(result.sourceTimeSec).toBeCloseTo(
			mediaTimeToSeconds({ time: mediaTime({ ticks: 80 }) }),
			8,
		);
	});

	test("from: post-out handle uses frames past out when available", () => {
		const result = sampleTransitionSourceTime({
			role: "from",
			timelineTime: mediaTime({ ticks: 110 }),
			elementStart,
			elementDuration,
			trimStart,
			trimEnd,
			sourceDuration: mediaTime({ ticks: 200 }),
			cutTime,
		});
		expect(result.frozen).toBe(false);
		expect(result.sourceTimeSec).toBeCloseTo(
			mediaTimeToSeconds({ time: mediaTime({ ticks: 110 }) }),
			8,
		);
	});

	test("from: freezes last frame when post-out exceeds source", () => {
		const result = sampleTransitionSourceTime({
			role: "from",
			timelineTime: mediaTime({ ticks: 120 }),
			elementStart,
			elementDuration,
			trimStart,
			trimEnd,
			sourceDuration: mediaTime({ ticks: 115 }),
			cutTime,
		});
		expect(result.frozen).toBe(true);
		expect(result.sourceTimeSec).toBeCloseTo(
			mediaTimeToSeconds({ time: mediaTime({ ticks: 114 }) }),
			8,
		);
	});

	test("to: pre-in handle uses frames before in when available", () => {
		const result = sampleTransitionSourceTime({
			role: "to",
			timelineTime: mediaTime({ ticks: 90 }),
			elementStart: mediaTime({ ticks: 100 }),
			elementDuration,
			trimStart: mediaTime({ ticks: 20 }),
			trimEnd,
			sourceDuration: mediaTime({ ticks: 200 }),
			cutTime,
		});
		expect(result.frozen).toBe(false);
		expect(result.sourceTimeSec).toBeCloseTo(
			mediaTimeToSeconds({ time: mediaTime({ ticks: 10 }) }),
			8,
		);
	});

	test("to: freezes first visible frame when pre-in exceeds trim budget", () => {
		const toTrimStart = mediaTime({ ticks: 5 });
		const result = sampleTransitionSourceTime({
			role: "to",
			timelineTime: mediaTime({ ticks: 90 }),
			elementStart: mediaTime({ ticks: 100 }),
			elementDuration,
			trimStart: toTrimStart,
			trimEnd,
			sourceDuration: mediaTime({ ticks: 200 }),
			cutTime,
		});
		expect(result.frozen).toBe(true);
		expect(result.sourceTimeSec).toBeCloseTo(
			mediaTimeToSeconds({ time: toTrimStart }),
			8,
		);
	});

	test("from: undefined source duration never freezes for length", () => {
		const result = sampleTransitionSourceTime({
			role: "from",
			timelineTime: mediaTime({ ticks: 500 }),
			elementStart,
			elementDuration,
			trimStart,
			trimEnd,
			sourceDuration: undefined,
			cutTime,
		});
		expect(result.frozen).toBe(false);
		expect(result.sourceTimeSec).toBeCloseTo(
			mediaTimeToSeconds({ time: mediaTime({ ticks: 500 }) }),
			8,
		);
	});
});
