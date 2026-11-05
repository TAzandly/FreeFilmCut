import { describe, expect, test } from "bun:test";
import {
	getMappedClipTimeFromSource,
	getMappedSourceTime,
} from "@/retime/source-time";

describe("getMappedSourceTime", () => {
	test("forward equals trimStart + retime delta", () => {
		expect(
			getMappedSourceTime({
				clipTime: 5,
				clipDuration: 10,
				trimStart: 100,
				retime: { rate: 2 },
				reversed: false,
			}),
		).toBe(110); // 100 + 5*2
	});

	test("reversed maps clip start to source end of span", () => {
		// span at rate 1 over duration 10 = 10
		expect(
			getMappedSourceTime({
				clipTime: 0,
				clipDuration: 10,
				trimStart: 100,
				reversed: true,
			}),
		).toBe(110); // trimStart + span
	});

	test("reversed maps clip end to trimStart", () => {
		expect(
			getMappedSourceTime({
				clipTime: 10,
				clipDuration: 10,
				trimStart: 100,
				reversed: true,
			}),
		).toBe(100);
	});

	test("reversed mid-point with 2x retime", () => {
		// span = 10*2 = 20; clipTime 5 → forwardDelta 10 → source = 100+20-10 = 110
		expect(
			getMappedSourceTime({
				clipTime: 5,
				clipDuration: 10,
				trimStart: 100,
				retime: { rate: 2 },
				reversed: true,
			}),
		).toBe(110);
	});
});

describe("getMappedClipTimeFromSource", () => {
	test("forward inverts trimStart + retime mapping", () => {
		expect(
			getMappedClipTimeFromSource({
				sourceTime: 110,
				clipDuration: 10,
				trimStart: 100,
				retime: { rate: 2 },
				reversed: false,
			}),
		).toBe(5);
	});

	test("reversed inverts span-relative mapping", () => {
		expect(
			getMappedClipTimeFromSource({
				sourceTime: 110,
				clipDuration: 10,
				trimStart: 100,
				reversed: true,
			}),
		).toBe(0);
	});
});
