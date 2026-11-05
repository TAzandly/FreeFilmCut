import { describe, expect, test } from "bun:test";
import { analyzeColorCorrection } from "../analyze";

function makeRgba({
	w,
	h,
	fill,
}: {
	w: number;
	h: number;
	fill: (x: number, y: number) => [number, number, number, number];
}): ImageData {
	const data = new Uint8ClampedArray(w * h * 4);
	for (let y = 0; y < h; y++) {
		for (let x = 0; x < w; x++) {
			const [r, g, b, a] = fill(x, y);
			const i = (y * w + x) * 4;
			data[i] = r;
			data[i + 1] = g;
			data[i + 2] = b;
			data[i + 3] = a;
		}
	}
	return new ImageData(data, w, h);
}

describe("analyzeColorCorrection", () => {
	test("dark frame → positive brightness", () => {
		const img = makeRgba({
			w: 32,
			h: 32,
			fill: () => [20, 20, 20, 255],
		});
		expect(analyzeColorCorrection({ imageData: img }).brightness).toBeGreaterThan(
			0,
		);
	});

	test("flat mid-gray → positive contrast", () => {
		const img = makeRgba({
			w: 32,
			h: 32,
			fill: () => [128, 128, 128, 255],
		});
		expect(analyzeColorCorrection({ imageData: img }).contrast).toBeGreaterThan(0);
	});

	test("strong blue cast → temperature/tint pull warm/opposite", () => {
		const img = makeRgba({
			w: 32,
			h: 32,
			fill: () => [40, 60, 200, 255],
		});
		const a = analyzeColorCorrection({ imageData: img });
		expect(a.temperature).toBeGreaterThan(0);
		expect(Math.abs(a.temperature) + Math.abs(a.tint)).toBeGreaterThan(0.01);
	});

	test("outputs are finite and roughly in [-1,1] after s1/s2", () => {
		const img = makeRgba({
			w: 16,
			h: 16,
			fill: (x, y) => [x * 15, y * 15, 100, 255],
		});
		const a = analyzeColorCorrection({ imageData: img });
		for (const v of Object.values(a)) {
			expect(Number.isFinite(v)).toBe(true);
			expect(v).toBeGreaterThanOrEqual(-1);
			expect(v).toBeLessThanOrEqual(1);
		}
	});
});
