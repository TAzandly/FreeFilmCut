import { describe, expect, test } from "bun:test";
import {
	IDENTITY_ANALYSIS,
	intensityScale,
	packColorCorrectionUniforms,
	sampleMidtoneLiftCurve,
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

describe("sampleMidtoneLiftCurve", () => {
	test("pins black and white", () => {
		expect(sampleMidtoneLiftCurve({ x: 0, amount: 1 })).toBe(0);
		expect(sampleMidtoneLiftCurve({ x: 1, amount: 1 })).toBe(1);
	});

	test("lifts midtones above the diagonal", () => {
		const mid = sampleMidtoneLiftCurve({ x: 0.5, amount: 1 });
		expect(mid).toBeGreaterThan(0.5);
		expect(mid).toBeCloseTo(0.5 + 0.28, 5);
	});

	test("amount 0 is identity", () => {
		expect(sampleMidtoneLiftCurve({ x: 0.4, amount: 0 })).toBeCloseTo(0.4, 8);
	});
});

describe("packColorCorrectionUniforms", () => {
	test("zero analysis → analysis flags off, but midtone lift follows intensity", () => {
		const u = packColorCorrectionUniforms({
			analysis: IDENTITY_ANALYSIS,
			intensity: 80,
		});
		expect(u.enableContrast).toBe(0);
		expect(u.enableBrightness).toBe(0);
		expect(u.enableSaturation).toBe(0);
		expect(u.enableMidtoneLift).toBe(1);
		expect(u.midtoneLiftAmount).toBeCloseTo(0.8, 8);
	});

	test("intensity 0 disables midtone lift", () => {
		const u = packColorCorrectionUniforms({
			analysis: IDENTITY_ANALYSIS,
			intensity: 0,
		});
		expect(u.enableMidtoneLift).toBe(0);
		expect(u.midtoneLiftAmount).toBe(0);
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
