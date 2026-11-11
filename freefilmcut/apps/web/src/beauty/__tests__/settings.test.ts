import { describe, expect, test } from "bun:test";
import {
	DEFAULT_BEAUTY_PARAMS,
	isBeautyActive,
	normalizeBeautyParams,
	readBeautyFromParams,
	resolveBeautyFromParams,
} from "@/beauty/settings";

describe("beauty settings", () => {
	test("normalize clamps to 0..1 and fills defaults", () => {
		expect(normalizeBeautyParams({ smooth: 2, eye: -1 })).toEqual({
			...DEFAULT_BEAUTY_PARAMS,
			smooth: 1,
			eye: 0,
		});
	});

	test("isBeautyActive false when all zero", () => {
		expect(isBeautyActive({ params: {} })).toBe(false);
	});

	test("isBeautyActive true when any channel > 0", () => {
		expect(
			isBeautyActive({
				params: { "beauty.smooth": 0.2 },
			}),
		).toBe(true);
	});

	test("readBeautyFromParams reads dotted keys", () => {
		const b = readBeautyFromParams({
			params: {
				"beauty.smooth": 0.5,
				"beauty.whiten": 0.1,
				"beauty.eye": 0,
				"beauty.faceSlim": 0.3,
				"beauty.noseSlim": 0,
			},
		});
		expect(b.smooth).toBe(0.5);
		expect(b.faceSlim).toBe(0.3);
	});

	test("resolveBeautyFromParams returns null when inactive", () => {
		expect(resolveBeautyFromParams({ params: {} })).toBeNull();
	});
});
