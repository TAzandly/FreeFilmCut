import { describe, expect, test } from "bun:test";
import { buildLandmarkFallbackMask } from "@/beauty/analysis/landmark-fallback-mask";
import {
	FACE_OVAL_INDICES,
	LEFT_EYE_INDICES,
	LIPS_OUTER_INDICES,
	RIGHT_EYE_INDICES,
} from "@/beauty/analysis/landmark-indices";
import type { FaceLandmarks } from "@/beauty/analysis/types";

const POINT_COUNT = 478;

function setPoint(
	points: Float32Array,
	index: number,
	x: number,
	y: number,
): void {
	points[index * 2] = x;
	points[index * 2 + 1] = y;
}

/** Synthetic face: oval around center; eyes and lips punched in unit tests. */
function syntheticFace(): FaceLandmarks {
	const points = new Float32Array(POINT_COUNT * 2);
	const cx = 0.5;
	const cy = 0.5;
	const rx = 0.22;
	const ry = 0.3;

	for (let i = 0; i < FACE_OVAL_INDICES.length; i++) {
		const t = (i / FACE_OVAL_INDICES.length) * Math.PI * 2;
		setPoint(
			points,
			FACE_OVAL_INDICES[i],
			cx + Math.cos(t) * rx,
			cy + Math.sin(t) * ry,
		);
	}

	const placeRing = (
		indices: readonly number[],
		cx: number,
		cy: number,
		r: number,
	) => {
		for (let i = 0; i < indices.length; i++) {
			const t = (i / indices.length) * Math.PI * 2;
			setPoint(
				points,
				indices[i],
				cx + Math.cos(t) * r,
				cy + Math.sin(t) * r,
			);
		}
	};
	placeRing(LEFT_EYE_INDICES, 0.38, 0.42, 0.04);
	placeRing(RIGHT_EYE_INDICES, 0.62, 0.42, 0.04);
	placeRing(LIPS_OUTER_INDICES, 0.5, 0.62, 0.05);

	return {
		points,
		box: { x: cx - rx, y: cy - ry, w: rx * 2, h: ry * 2 },
	};
}

describe("landmark fallback mask", () => {
	test("produces nonzero skin pixels for synthetic face oval", () => {
		const w = 128;
		const h = 128;
		const mask = buildLandmarkFallbackMask([syntheticFace()], w, h);
		expect(mask.length).toBe(w * h);
		let nonzero = 0;
		for (let i = 0; i < mask.length; i++) {
			if (mask[i] > 0) nonzero++;
		}
		expect(nonzero).toBeGreaterThan(100);
	});

	test("punches eye and lip regions to zero", () => {
		const w = 128;
		const h = 128;
		const mask = buildLandmarkFallbackMask([syntheticFace()], w, h);
		const eyeX = Math.round(0.38 * w);
		const eyeY = Math.round(0.42 * h);
		const lipX = Math.round(0.5 * w);
		const lipY = Math.round(0.62 * h);
		expect(mask[eyeY * w + eyeX]).toBe(0);
		expect(mask[eyeY * w + (w - eyeX)]).toBe(0);
		expect(mask[lipY * w + lipX]).toBe(0);
	});
});
