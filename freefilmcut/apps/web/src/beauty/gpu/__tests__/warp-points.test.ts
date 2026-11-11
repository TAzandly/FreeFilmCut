import { describe, expect, test } from "bun:test";
import {
	FACE_SLIM_INDICES,
	LEFT_EYE_INDICES,
	NOSE_WING_INDICES,
	RIGHT_EYE_INDICES,
} from "@/beauty/analysis/landmark-indices";
import type { FaceLandmarks } from "@/beauty/analysis/types";
import {
	MAX_BEAUTY_FACES,
	packWarpFaces,
	skinMaskCoverage,
	WARP_SLOT,
	WARP_VEC4_PER_FACE,
} from "@/beauty/gpu/warp-points";

/** Frontal face on x = 0.5; mirrored landmark pairs on either side. */
function syntheticFace(scale = 1): FaceLandmarks {
	const points = new Float32Array(478 * 2);
	const set = (i: number, x: number, y: number) => {
		points[i * 2] = 0.5 + (x - 0.5) * scale;
		points[i * 2 + 1] = 0.5 + (y - 0.5) * scale;
	};
	set(168, 0.5, 0.4); // bridge
	set(152, 0.5, 0.7); // chin
	set(234, 0.3, 0.5);
	set(454, 0.7, 0.5);
	FACE_SLIM_INDICES.imageLeft.forEach((i) => set(i, 0.32, 0.6));
	FACE_SLIM_INDICES.imageRight.forEach((i) => set(i, 0.68, 0.6));
	set(NOSE_WING_INDICES.imageLeft, 0.46, 0.55);
	set(NOSE_WING_INDICES.imageRight, 0.54, 0.55);
	// image-left eye (RIGHT_EYE list): corners 33 outer, 133 inner
	for (const i of RIGHT_EYE_INDICES) set(i, 0.4, 0.45);
	set(33, 0.36, 0.45);
	set(133, 0.44, 0.45);
	for (const i of LEFT_EYE_INDICES) set(i, 0.6, 0.45);
	set(263, 0.64, 0.45);
	set(362, 0.56, 0.45);
	const box = { x: 0.3 + 0.2 * (1 - scale), y: 0.3, w: 0.4 * scale, h: 0.4 * scale };
	return { points, box };
}

function slot(data: Float32Array, face: number, s: number): number[] {
	const o = (face * WARP_VEC4_PER_FACE + s) * 4;
	return [data[o], data[o + 1], data[o + 2], data[o + 3]];
}

describe("beauty warp packing", () => {
	test("packs eyes in aspect space with corner-based radius", () => {
		const { data, count } = packWarpFaces([syntheticFace()], 2);
		expect(count).toBe(1);
		const left = slot(data, 0, WARP_SLOT.eyeLeft);
		expect(left[0]).toBeCloseTo(0.4 * 2, 5);
		expect(left[1]).toBeCloseTo(0.45, 5);
		// corner distance 0.08 * aspect 2 = 0.16, radius = 1.1x
		expect(left[2]).toBeCloseTo(0.16 * 1.1, 5);
	});

	test("jaw and nose targets lie on the face axis", () => {
		const { data } = packWarpFaces([syntheticFace()], 1);
		for (const s of [WARP_SLOT.jawLeft, WARP_SLOT.jawRight, WARP_SLOT.noseLeft]) {
			const [sx, , tx, ty] = slot(data, 0, s);
			expect(tx).toBeCloseTo(0.5, 5);
			expect(ty).toBeGreaterThan(0.39);
			expect(Math.abs(sx - tx)).toBeGreaterThan(0.01);
		}
		const radii = slot(data, 0, WARP_SLOT.radii);
		expect(radii[0]).toBeCloseTo(0.4 * 0.3, 5); // temple width * JAW_RADIUS_SCALE
		expect(radii[1]).toBeCloseTo(0.08 * 0.9, 5);
	});

	test("keeps the largest faces up to MAX_BEAUTY_FACES", () => {
		const faces = Array.from({ length: MAX_BEAUTY_FACES + 2 }, (_, i) =>
			syntheticFace(0.5 + i * 0.05),
		);
		const { count, data } = packWarpFaces(faces, 1);
		expect(count).toBe(MAX_BEAUTY_FACES);
		// largest face first: widest eye radius
		const r0 = slot(data, 0, WARP_SLOT.eyeLeft)[2];
		const r1 = slot(data, 1, WARP_SLOT.eyeLeft)[2];
		expect(r0).toBeGreaterThan(r1);
	});

	test("skips faces with truncated landmarks", () => {
		const bad = { points: new Float32Array(10), box: { x: 0, y: 0, w: 1, h: 1 } };
		expect(packWarpFaces([bad], 1).count).toBe(0);
	});

	test("skinMaskCoverage", () => {
		expect(skinMaskCoverage(new Uint8Array(0))).toBe(0);
		expect(skinMaskCoverage(new Uint8Array(4))).toBe(0);
		expect(skinMaskCoverage(new Uint8Array([0, 255, 0, 255]))).toBe(0.5);
	});
});
