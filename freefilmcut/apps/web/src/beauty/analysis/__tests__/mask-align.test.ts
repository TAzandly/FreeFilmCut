import { describe, expect, test } from "bun:test";
import {
	alignSkinMaskToFaces,
	MASK_ALIGN_ANCHORS,
	solveAffine,
} from "@/beauty/analysis/mask-align";
import { boxFromPoints } from "@/beauty/analysis/mediapipe-face";
import type { FaceLandmarks } from "@/beauty/analysis/types";

const SIZE = 64;

/** Face whose anchors (eye corners, chin) and box sit at the given offset/scale. */
function face(dx: number, dy: number, scale = 1): FaceLandmarks {
	const points = new Float32Array(478 * 2);
	// Every landmark on a small grid around the center so the box is sane.
	for (let i = 0; i < 478; i++) {
		points[i * 2] = 0.5 + dx + ((i % 10) / 10 - 0.45) * 0.3 * scale;
		points[i * 2 + 1] = 0.5 + dy + ((Math.floor(i / 10) % 10) / 10 - 0.45) * 0.3 * scale;
	}
	const [eyeA, eyeB, chin] = MASK_ALIGN_ANCHORS;
	const set = (i: number, x: number, y: number) => {
		points[i * 2] = 0.5 + dx + x * scale;
		points[i * 2 + 1] = 0.5 + dy + y * scale;
	};
	set(eyeA, -0.1, -0.05);
	set(eyeB, 0.1, -0.05);
	set(chin, 0, 0.15);
	return { points, box: boxFromPoints(points) };
}

function maskWithBlockAt(cx: number, cy: number): Uint8Array {
	const mask = new Uint8Array(SIZE * SIZE);
	for (let y = cy - 3; y < cy + 3; y++) {
		for (let x = cx - 3; x < cx + 3; x++) mask[y * SIZE + x] = 255;
	}
	return mask;
}

function centroid(mask: Uint8Array): { x: number; y: number } {
	let sx = 0;
	let sy = 0;
	let n = 0;
	for (let i = 0; i < mask.length; i++) {
		if (mask[i] < 128) continue;
		sx += i % SIZE;
		sy += Math.floor(i / SIZE);
		n++;
	}
	return { x: sx / n, y: sy / n };
}

describe("alignSkinMaskToFaces", () => {
	test("solveAffine recovers a translation + scale", () => {
		const to = [
			{ x: 0, y: 0 },
			{ x: 10, y: 0 },
			{ x: 0, y: 10 },
		];
		const from = to.map((p) => ({ x: p.x * 2 + 3, y: p.y * 2 - 1 }));
		const [a, b, c, d, e, f] = solveAffine(to, from) ?? [];
		expect(a).toBeCloseTo(2);
		expect(b).toBeCloseTo(0);
		expect(c).toBeCloseTo(3);
		expect(d).toBeCloseTo(0);
		expect(e).toBeCloseTo(2);
		expect(f).toBeCloseTo(-1);
	});

	test("mask follows the face when it moves", () => {
		const from = face(0, 0);
		const to = face(0.1, 0.05);
		const mask = maskWithBlockAt(32, 32);
		const out = alignSkinMaskToFaces(mask, SIZE, SIZE, [from], [to]);
		const before = centroid(mask);
		const after = centroid(out);
		// Nearest-pixel sampling: within one pixel of the exact shift.
		expect(Math.abs(after.x - (before.x + 0.1 * SIZE))).toBeLessThanOrEqual(1);
		expect(Math.abs(after.y - (before.y + 0.05 * SIZE))).toBeLessThanOrEqual(1);
	});

	test("unmatched faces fall back to the landmark polygon", () => {
		const out = alignSkinMaskToFaces(
			new Uint8Array(SIZE * SIZE),
			SIZE,
			SIZE,
			[],
			[face(0, 0)],
		);
		expect(out.some((v) => v === 255)).toBe(true);
	});
});
