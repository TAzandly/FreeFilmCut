import { describe, expect, test } from "bun:test";
import {
	faceFxHasWarp2d,
	sampleFaceWarpUv,
} from "@/vfxpack/face-fx-warp2d";

const base = {
	centerU: 0.5,
	centerV: 0.5,
	radius: 0.25,
	strength: 1,
};

describe("sampleFaceWarpUv", () => {
	test("zero strength is identity", () => {
		const p = sampleFaceWarpUv({
			...base,
			u: 0.55,
			v: 0.52,
			strength: 0,
			preset: "bulge",
		});
		expect(p).toEqual({ u: 0.55, v: 0.52 });
	});

	test("outside radius is identity", () => {
		const p = sampleFaceWarpUv({
			...base,
			u: 0.9,
			v: 0.9,
			preset: "pinch",
		});
		expect(p.u).toBeCloseTo(0.9);
		expect(p.v).toBeCloseTo(0.9);
	});

	test("bulge pulls sample UV toward center (outward visual)", () => {
		const p = sampleFaceWarpUv({
			...base,
			u: 0.55,
			v: 0.5,
			preset: "bulge",
		});
		expect(p.u).toBeGreaterThan(0.5);
		expect(p.u).toBeLessThan(0.55);
	});

	test("pinch pushes sample UV away from center", () => {
		const p = sampleFaceWarpUv({
			...base,
			u: 0.55,
			v: 0.5,
			preset: "pinch",
		});
		expect(p.u).toBeGreaterThan(0.55);
	});

	test("stretchY only changes v", () => {
		const p = sampleFaceWarpUv({
			...base,
			u: 0.55,
			v: 0.6,
			preset: "stretchY",
		});
		expect(p.u).toBeCloseTo(0.55);
		expect(p.v).not.toBeCloseTo(0.6);
	});

	test("wave moves with time", () => {
		const a = sampleFaceWarpUv({
			...base,
			u: 0.55,
			v: 0.5,
			preset: "wave",
			time: 0,
		});
		const b = sampleFaceWarpUv({
			...base,
			u: 0.55,
			v: 0.5,
			preset: "wave",
			time: 0.4,
		});
		expect(a.u !== b.u || a.v !== b.v).toBe(true);
	});
});

describe("faceFxHasWarp2d", () => {
	test("detects warp layers", () => {
		expect(faceFxHasWarp2d([])).toBe(false);
		expect(faceFxHasWarp2d([{ kind: "anchor3d" }])).toBe(false);
		expect(faceFxHasWarp2d([{ kind: "warp2d", strength: 0.5 }])).toBe(true);
		expect(faceFxHasWarp2d([{ kind: "warp2d", strength: 0 }])).toBe(false);
	});
});
