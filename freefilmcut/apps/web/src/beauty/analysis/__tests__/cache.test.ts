import { describe, expect, test } from "bun:test";
import {
	BeautyAnalysisCache,
	beautyAnalysisCacheKey,
	quantizeMediaTimeTicks,
} from "@/beauty/analysis/cache";
import type { BeautyAnalysisFrame } from "@/beauty/analysis/types";

function frame(clipId: string, ticks: number): BeautyAnalysisFrame {
	return {
		clipId,
		mediaTimeTicks: ticks,
		faces: [],
		skinWidth: 1,
		skinHeight: 1,
		skinMask: new Uint8Array([255]),
		source: "landmarks-only-mask",
	};
}

describe("beauty analysis cache", () => {
	test("quantizeMediaTimeTicks snaps to frame quantum", () => {
		const q = 100;
		expect(quantizeMediaTimeTicks(0, q)).toBe(0);
		expect(quantizeMediaTimeTicks(150, q)).toBe(100);
		expect(quantizeMediaTimeTicks(250, q)).toBe(200);
	});

	test("beautyAnalysisCacheKey uses clip and quantized ticks", () => {
		expect(beautyAnalysisCacheKey("clip-a", 150)).toBe(
			`clip-a:${quantizeMediaTimeTicks(150)}`,
		);
	});

	test("set then get returns same frame", () => {
		const cache = new BeautyAnalysisCache(4);
		const v = frame("c1", 0);
		cache.set("c1", 0, v);
		expect(cache.get("c1", 0)).toBe(v);
	});

	test("get refreshes LRU order", () => {
		const cache = new BeautyAnalysisCache(2);
		cache.set("a", 0, frame("a", 0));
		cache.set("b", 0, frame("b", 0));
		expect(cache.get("a", 0)).toBeDefined();
		cache.set("c", 0, frame("c", 0));
		expect(cache.get("b", 0)).toBeUndefined();
		expect(cache.get("a", 0)).toBeDefined();
	});

	test("evicts oldest when exceeding max entries", () => {
		const cache = new BeautyAnalysisCache(3);
		cache.set("a", 0, frame("a", 0));
		cache.set("b", 0, frame("b", 0));
		cache.set("c", 0, frame("c", 0));
		expect(cache.size).toBe(3);
		cache.set("d", 0, frame("d", 0));
		expect(cache.size).toBe(3);
		expect(cache.get("a", 0)).toBeUndefined();
		expect(cache.get("d", 0)).toBeDefined();
	});

	test("invalidateClip removes all keys for clip", () => {
		const cache = new BeautyAnalysisCache(8);
		cache.set("x", 0, frame("x", 0));
		cache.set("x", 500, frame("x", 500));
		cache.set("y", 0, frame("y", 0));
		cache.invalidateClip("x");
		expect(cache.get("x", 0)).toBeUndefined();
		expect(cache.get("x", 500)).toBeUndefined();
		expect(cache.get("y", 0)).toBeDefined();
	});

	test("clear removes everything", () => {
		const cache = new BeautyAnalysisCache(4);
		cache.set("a", 0, frame("a", 0));
		cache.clear();
		expect(cache.size).toBe(0);
		expect(cache.get("a", 0)).toBeUndefined();
	});
});
