import { describe, expect, test } from "bun:test";
import { mediaTimeFromSeconds, mediaTimeToSeconds } from "@/wasm";
import { colorCorrectionSampleTimeSeconds } from "../sample-frame";

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
