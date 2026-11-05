import { describe, expect, test } from "bun:test";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import {
	colorCorrectionSampleTimeSeconds,
	colorCorrectionStreamKey,
} from "../sample-frame";

describe("colorCorrectionSampleTimeSeconds", () => {
	test("midpoint of a trimmed window excludes the tail trim", () => {
		const trimStart = mediaTimeFromSeconds({ seconds: 2 });
		const trimEnd = mediaTimeFromSeconds({ seconds: 3 });
		const duration = mediaTimeFromSeconds({ seconds: 5 });
		const seconds = colorCorrectionSampleTimeSeconds({
			trimStart,
			trimEnd,
			duration,
		});
		expect(seconds).toBeCloseTo(4.5, 5);
		expect(seconds).toBeGreaterThan(mediaTimeToSeconds({ time: trimStart }));
		expect(seconds).toBeLessThan(
			mediaTimeToSeconds({ time: trimStart }) +
				mediaTimeToSeconds({ time: duration }),
		);
	});

	test("untrimmed clip samples the middle of its duration", () => {
		const duration = mediaTimeFromSeconds({ seconds: 8 });
		const seconds = colorCorrectionSampleTimeSeconds({
			trimStart: mediaTimeFromSeconds({ seconds: 0 }),
			trimEnd: mediaTimeFromSeconds({ seconds: 0 }),
			duration,
		});
		expect(seconds).toBeCloseTo(4, 5);
	});
});

describe("colorCorrectionStreamKey", () => {
	test("names media, sample time, element, and the request id", () => {
		expect(
			colorCorrectionStreamKey({
				mediaId: "media-1",
				sampleTimeSeconds: 4.5,
				elementId: "clip-a",
				requestId: "req-1",
			}),
		).toBe("color-correction:media-1:4.5:clip-a:req-1");
	});

	test("omits the element segment when no clip id is given", () => {
		expect(
			colorCorrectionStreamKey({
				mediaId: "media-1",
				sampleTimeSeconds: 1,
				requestId: "req-1",
			}),
		).toBe("color-correction:media-1:1:req-1");
	});

	test("two requests for the same media and time do not share a key", () => {
		const args = {
			mediaId: "media-1",
			sampleTimeSeconds: 4.5,
			elementId: "clip-a",
		};
		const first = colorCorrectionStreamKey(args);
		const second = colorCorrectionStreamKey(args);
		expect(first).not.toBe(second);
		expect(first.startsWith("color-correction:")).toBe(true);
		expect(first).not.toBe("color-correction");
	});
});
