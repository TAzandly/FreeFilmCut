import { describe, expect, test } from "bun:test";
import {
	buildCurveRetime,
	integrateCurveRate,
	meanCurveRate,
	sampleCurveRateAt,
} from "@/retime/curve";
import {
	getSourceTimeAtClipTime,
	getTimelineDurationForSourceSpan,
} from "@/retime/resolve";

describe("retime curve", () => {
	test("samples piecewise-linear rates", () => {
		const keys = [
			{ t: 0, rate: 1 },
			{ t: 1, rate: 3 },
		];
		expect(sampleCurveRateAt({ keys, u: 0 })).toBe(1);
		expect(sampleCurveRateAt({ keys, u: 0.5 })).toBe(2);
		expect(sampleCurveRateAt({ keys, u: 1 })).toBe(3);
	});

	test("integrates trapezoids for mean rate", () => {
		const keys = [
			{ t: 0, rate: 1 },
			{ t: 1, rate: 3 },
		];
		expect(integrateCurveRate({ keys, u: 1 })).toBeCloseTo(2, 5);
		expect(meanCurveRate({ keys })).toBeCloseTo(2, 5);
	});

	test("maps clip time through curve with clipDuration", () => {
		const retime = buildCurveRetime({
			curveId: "custom",
			keys: [
				{ t: 0, rate: 1 },
				{ t: 1, rate: 3 },
			],
		});
		const clipDuration = 10;
		// ∫_0^{0.5} lerp(1,3) = avg(1,2)*0.5 = 0.75 → 10*0.75 = 7.5
		expect(
			getSourceTimeAtClipTime({
				clipTime: 5,
				retime,
				clipDuration,
			}),
		).toBeCloseTo(7.5, 4);
		expect(
			getTimelineDurationForSourceSpan({ sourceSpan: 20, retime }),
		).toBeCloseTo(10, 4);
	});
});
