import { describe, expect, test } from "bun:test";
import { skinMaskFromDlmvOutput } from "@/beauty/analysis/dlmv-skin";

describe("skinMaskFromDlmvOutput", () => {
	test("minmax-normalizes [1,1,H,W] and floors soft tails", () => {
		const h = 2;
		const w = 2;
		const data = new Float32Array([0.1, 0.5, 0.9, 0.2]);
		const result = skinMaskFromDlmvOutput(data, [1, 1, h, w], 0.15);
		expect(result?.width).toBe(2);
		expect(result?.height).toBe(2);
		expect(result?.mask[2]).toBe(255); // 0.9 -> peak
		expect(result?.mask[0]).toBe(0); // near floor after normalize
		expect(result?.mask[1]).toBeGreaterThan(0);
	});

	test("rejects unexpected shapes", () => {
		expect(skinMaskFromDlmvOutput(new Float32Array(4), [1, 2, 2, 1])).toBeNull();
	});
});
