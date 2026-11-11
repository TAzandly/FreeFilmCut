import { describe, expect, test } from "bun:test";
import { fitBeautyPassSize, planBeautyPasses } from "@/beauty/gpu/beauty-pass";
import { DEFAULT_BEAUTY_PARAMS } from "@/beauty/types";
import { isBeautyParamsActive } from "@/beauty/settings";

const base = DEFAULT_BEAUTY_PARAMS;

describe("beauty pass planning", () => {
	test("no data -> nothing runs", () => {
		const beauty = { ...base, smooth: 1, whiten: 1, eye: 1 };
		expect(planBeautyPasses({ beauty, faceCount: 0, maskCoverage: 0 })).toEqual({
			warp: false,
			smooth: false,
			whiten: false,
		});
	});

	test("warp needs faces; smooth/whiten need mask coverage", () => {
		const beauty = { ...base, smooth: 0.5, whiten: 0.5, faceSlim: 0.5 };
		expect(planBeautyPasses({ beauty, faceCount: 1, maskCoverage: 0 })).toEqual({
			warp: true,
			smooth: false,
			whiten: false,
		});
		expect(planBeautyPasses({ beauty, faceCount: 0, maskCoverage: 0.2 })).toEqual({
			warp: false,
			smooth: true,
			whiten: true,
		});
	});

	test("zero sliders skip their passes", () => {
		expect(
			planBeautyPasses({ beauty: { ...base, whiten: 0.3 }, faceCount: 2, maskCoverage: 1 }),
		).toEqual({ warp: false, smooth: false, whiten: true });
	});

	test("fitBeautyPassSize keeps aspect and caps the long edge", () => {
		expect(fitBeautyPassSize(1920, 1080, 4096)).toEqual({ width: 1920, height: 1080 });
		expect(fitBeautyPassSize(7680, 4320, 3840)).toEqual({ width: 3840, height: 2160 });
		expect(fitBeautyPassSize(0, 0, 100)).toEqual({ width: 1, height: 1 });
	});

	test("isBeautyParamsActive matches resolved params", () => {
		expect(isBeautyParamsActive(base)).toBe(false);
		expect(isBeautyParamsActive({ ...base, noseSlim: 0.1 })).toBe(true);
	});
});
