import { describe, expect, test } from "vitest";
import {
	authoredAspectFromResolution,
	normalizeTransitionFitMode,
} from "../transition-fit-mode";

describe("normalizeTransitionFitMode", () => {
	test("defaults to crop when missing or unknown", () => {
		expect(normalizeTransitionFitMode(undefined)).toBe("crop");
		expect(normalizeTransitionFitMode(null)).toBe("crop");
		expect(normalizeTransitionFitMode("")).toBe("crop");
		expect(normalizeTransitionFitMode("cover")).toBe("crop");
		expect(normalizeTransitionFitMode("CROP")).toBe("crop");
	});

	test("accepts stretch case-insensitively", () => {
		expect(normalizeTransitionFitMode("stretch")).toBe("stretch");
		expect(normalizeTransitionFitMode("Stretch")).toBe("stretch");
		expect(normalizeTransitionFitMode(" STRETCH ")).toBe("stretch");
	});
});

describe("authoredAspectFromResolution", () => {
	test("uses width/height when both positive", () => {
		expect(authoredAspectFromResolution({ width: 1080, height: 1080 })).toBe(1);
		expect(authoredAspectFromResolution({ width: 1080, height: 1920 })).toBeCloseTo(
			1080 / 1920,
			6,
		);
		expect(authoredAspectFromResolution({ width: 1920, height: 1080 })).toBeCloseTo(
			1920 / 1080,
			6,
		);
	});

	test("falls back when resolution is missing or invalid", () => {
		expect(authoredAspectFromResolution(null, 1.5)).toBe(1.5);
		expect(authoredAspectFromResolution(undefined, 1)).toBe(1);
		expect(authoredAspectFromResolution({ width: 0, height: 1080 }, 2)).toBe(2);
		expect(authoredAspectFromResolution({ width: 1080, height: -1 }, 2)).toBe(2);
	});
});
