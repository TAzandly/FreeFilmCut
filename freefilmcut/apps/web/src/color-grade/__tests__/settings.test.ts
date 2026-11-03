import { describe, expect, test } from "bun:test";
import { mediaTimeFromSeconds } from "@/wasm";
import { DEFAULT_CURVE_POINTS, evaluateCurve, isLinearCurve } from "../curves";
import {
	DEFAULT_COLOR_GRADE,
	DEFAULT_COLOR_GRADE_BASIC,
	isColorGradeBasicIdentity,
	isColorGradeIdentity,
	readColorGradeBasicFromParams,
	readColorGradeFromParams,
	resolveColorGradeAtTime,
} from "../settings";

describe("readColorGradeBasicFromParams", () => {
	test("returns defaults when params are empty", () => {
		expect(readColorGradeBasicFromParams({ params: {} })).toEqual(
			DEFAULT_COLOR_GRADE_BASIC,
		);
	});

	test("reads and clamps slider values", () => {
		const grade = readColorGradeBasicFromParams({
			params: {
				"colorGrade.temperature": 40,
				"colorGrade.exposure": 250,
				"colorGrade.shadows": -120,
			},
		});
		expect(grade.temperature).toBe(40);
		expect(grade.exposure).toBe(100);
		expect(grade.shadows).toBe(-100);
	});
});

describe("isColorGradeIdentity", () => {
	test("true for defaults", () => {
		expect(isColorGradeIdentity({ grade: DEFAULT_COLOR_GRADE })).toBe(true);
		expect(
			isColorGradeBasicIdentity({ grade: DEFAULT_COLOR_GRADE_BASIC }),
		).toBe(true);
	});

	test("false when hsl moves", () => {
		const grade = structuredClone(DEFAULT_COLOR_GRADE);
		grade.hsl.sat = 20;
		expect(isColorGradeIdentity({ grade })).toBe(false);
	});
});

describe("resolveColorGradeAtTime", () => {
	test("samples keyed basic paths at local time", () => {
		const resolved = resolveColorGradeAtTime({
			base: DEFAULT_COLOR_GRADE,
			localTime: mediaTimeFromSeconds({ seconds: 1 }),
			animations: {
				"colorGrade.brightness": {
					keys: [
						{
							id: "a",
							time: mediaTimeFromSeconds({ seconds: 0 }),
							value: 10,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
						{
							id: "b",
							time: mediaTimeFromSeconds({ seconds: 2 }),
							value: 50,
							segmentToNext: "linear",
							tangentMode: "auto",
						},
					],
				},
			},
		});
		expect(resolved.basic.brightness).toBe(30);
	});
});

describe("curves", () => {
	test("linear evaluate and identity", () => {
		expect(isLinearCurve(DEFAULT_CURVE_POINTS)).toBe(true);
		expect(evaluateCurve({ points: DEFAULT_CURVE_POINTS, t: 0.25 })).toBeCloseTo(
			0.25,
		);
	});

	test("readColorGradeFromParams parses curve JSON", () => {
		const grade = readColorGradeFromParams({
			params: {
				"colorGrade.curves.master": JSON.stringify([
					[0, 0],
					[0.5, 0.6],
					[1, 1],
				]),
			},
		});
		expect(grade.curves.master).toHaveLength(3);
		expect(isColorGradeIdentity({ grade })).toBe(false);
	});
});
