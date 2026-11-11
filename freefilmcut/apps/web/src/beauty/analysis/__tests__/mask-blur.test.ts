import { describe, expect, test } from "bun:test";
import { blurSkinMask } from "@/beauty/analysis/mask-blur";

describe("blurSkinMask", () => {
	test("softens a hard vertical edge", () => {
		const w = 16;
		const h = 8;
		const mask = new Uint8Array(w * h);
		for (let y = 0; y < h; y++) {
			for (let x = 0; x < w; x++) mask[y * w + x] = x < w / 2 ? 255 : 0;
		}
		const soft = blurSkinMask(mask, w, h, 2);
		const left = soft[4 * w + 3];
		const edge = soft[4 * w + 7];
		const right = soft[4 * w + 12];
		expect(left).toBeGreaterThan(200);
		expect(right).toBeLessThan(40);
		expect(edge).toBeGreaterThan(40);
		expect(edge).toBeLessThan(220);
	});

	test("sigma 0 returns a copy without softening", () => {
		const mask = new Uint8Array([0, 255, 0, 255]);
		const out = blurSkinMask(mask, 2, 2, 0);
		expect(Array.from(out)).toEqual([0, 255, 0, 255]);
		expect(out).not.toBe(mask);
	});
});
