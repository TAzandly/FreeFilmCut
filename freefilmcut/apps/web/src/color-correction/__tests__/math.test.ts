import { describe, expect, test } from "bun:test";
import {
	IDENTITY_ANALYSIS,
	intensityScale,
	packColorCorrectionUniforms,
	type ColorCorrectionAnalysis,
} from "../math";

describe("intensityScale", () => {
	test("matches CapCut NormalizeScale=50 at 80%", () => {
		// scale = 1/50/0.8 * 0.8 = 0.02
		expect(intensityScale({ intensity: 80 })).toBeCloseTo(0.02, 8);
	});

	test("at 100%", () => {
		expect(intensityScale({ intensity: 100 })).toBeCloseTo(0.025, 8);
	});

	test("at 0%", () => {
		expect(intensityScale({ intensity: 0 })).toBe(0);
	});
});

describe("packColorCorrectionUniforms", () => {
	test("zero analysis → all enable flags false / identity-ish", () => {
		const u = packColorCorrectionUniforms({
			analysis: IDENTITY_ANALYSIS,
			intensity: 80,
		});
		expect(u.enableContrast).toBe(0);
		expect(u.enableBrightness).toBe(0);
		expect(u.enableSaturation).toBe(0);
	});

	test("positive brightness analysis enables brightness and scales with intensity", () => {
		const analysis: ColorCorrectionAnalysis = {
			...IDENTITY_ANALYSIS,
			brightness: 0.5, // post s1
		};
		const soft = packColorCorrectionUniforms({ analysis, intensity: 40 });
		const hard = packColorCorrectionUniforms({ analysis, intensity: 80 });
		expect(soft.enableBrightness).toBe(1);
		expect(hard.enableBrightness).toBe(1);
		expect(Math.abs(hard.brightnessParam)).toBeGreaterThan(
			Math.abs(soft.brightnessParam),
		);
	});

	test("getSaturationParam: intensity 0 → sat 1", () => {
		const analysis: ColorCorrectionAnalysis = {
			...IDENTITY_ANALYSIS,
			saturation: 0.4,
		};
		const u = packColorCorrectionUniforms({ analysis, intensity: 80 });
		// axisIntensity = 0.4 * 0.02 = 0.008; satParam = 1 + 0.008
		expect(u.saturationParam).toBeCloseTo(1.008, 5);
		expect(u.enableSaturation).toBe(1);
	});
});
