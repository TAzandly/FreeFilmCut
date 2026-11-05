import { describe, expect, test } from "bun:test";
import { mediaTimeFromSeconds } from "@/wasm";
import {
	DEFAULT_COLOR_CORRECTION_INTENSITY,
	parseColorCorrectionAnalysis,
	readColorCorrectionFromParams,
	resolveColorCorrectionAtTime,
	serializeColorCorrectionAnalysis,
	isColorCorrectionActive,
} from "../settings";
import { IDENTITY_ANALYSIS } from "../math";

describe("analysis JSON", () => {
	test("round-trips 9 floats", () => {
		const a = { ...IDENTITY_ANALYSIS, brightness: 0.12, saturation: -0.05 };
		const s = serializeColorCorrectionAnalysis({ analysis: a });
		expect(parseColorCorrectionAnalysis({ raw: s })).toEqual(a);
	});

	test("rejects wrong length", () => {
		expect(parseColorCorrectionAnalysis({ raw: "[1,2,3]" })).toBeNull();
	});
});

describe("readColorCorrectionFromParams", () => {
	test("defaults disabled", () => {
		const c = readColorCorrectionFromParams({ params: {} });
		expect(c.enabled).toBe(false);
		expect(c.intensity).toBe(DEFAULT_COLOR_CORRECTION_INTENSITY);
		expect(c.analysis).toBeNull();
	});

	test("reads enabled + analysis", () => {
		const c = readColorCorrectionFromParams({
			params: {
				"colorCorrection.enabled": true,
				"colorCorrection.intensity": 60,
				"colorCorrection.analysis": serializeColorCorrectionAnalysis({
					analysis: { ...IDENTITY_ANALYSIS, contrast: 0.2 },
				}),
			},
		});
		expect(c.enabled).toBe(true);
		expect(c.intensity).toBe(60);
		expect(c.analysis?.contrast).toBe(0.2);
	});
});

describe("resolveColorCorrectionAtTime", () => {
	test("inactive when disabled or no analysis", () => {
		expect(
			isColorCorrectionActive({
				correction: resolveColorCorrectionAtTime({
					base: {
						enabled: true,
						intensity: 80,
						analysis: null,
					},
					animations: undefined,
					localTime: mediaTimeFromSeconds({ seconds: 0 }),
				}),
			}),
		).toBe(false);
	});

	test("samples intensity keyframe", () => {
		const resolved = resolveColorCorrectionAtTime({
			base: {
				enabled: true,
				intensity: 80,
				analysis: { ...IDENTITY_ANALYSIS, brightness: 0.5 },
			},
			localTime: mediaTimeFromSeconds({ seconds: 1 }),
			animations: {
				"colorCorrection.intensity": {
					keys: [
						{
							id: "a",
							time: mediaTimeFromSeconds({ seconds: 0 }),
							value: 0,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
						{
							id: "b",
							time: mediaTimeFromSeconds({ seconds: 2 }),
							value: 100,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
					],
				},
			},
		});
		expect(resolved).not.toBeNull();
		expect(resolved!.intensity).toBeCloseTo(50, 0);
	});
});
