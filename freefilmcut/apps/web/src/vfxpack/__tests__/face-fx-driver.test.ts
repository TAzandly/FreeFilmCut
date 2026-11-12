import { describe, expect, test } from "bun:test";
import type { FaceLandmarks } from "@/beauty/analysis/types";
import { MEDIAPIPE_FACE_LANDMARK_COUNT } from "@/beauty/analysis/mediapipe-face";
import {
	FACE_FX_BIND_LANDMARKS,
	FACE_FX_IRIS_INDICES,
	faceFxBindLandmarkIndices,
	resolveFaceFxBindPoint,
} from "@/vfxpack/face-fx-driver";

function faceWith(
	sets: Array<{ index: number; x: number; y: number }>,
	extra?: Partial<FaceLandmarks>,
): FaceLandmarks {
	const points = new Float32Array(MEDIAPIPE_FACE_LANDMARK_COUNT * 2);
	for (const { index, x, y } of sets) {
		points[index * 2] = x;
		points[index * 2 + 1] = y;
	}
	return {
		points,
		box: { x: 0.2, y: 0.2, w: 0.4, h: 0.5 },
		...extra,
	};
}

describe("face-fx bind landmarks", () => {
	test("forehead / noseBridge map to known indices", () => {
		expect(FACE_FX_BIND_LANDMARKS.forehead).toEqual([10]);
		expect(FACE_FX_BIND_LANDMARKS.noseBridge).toEqual([168]);
		expect(faceFxBindLandmarkIndices("faceMatrix")).toEqual([]);
	});

	test("resolveFaceFxBindPoint uses iris when present", () => {
		const face = faceWith([
			{ index: FACE_FX_IRIS_INDICES.imageLeft, x: 0.35, y: 0.4 },
			{ index: FACE_FX_IRIS_INDICES.imageRight, x: 0.65, y: 0.42 },
			{ index: 10, x: 0.5, y: 0.15 },
			{ index: 168, x: 0.5, y: 0.45 },
		]);
		const left = resolveFaceFxBindPoint({ face, bind: "leftEye" });
		expect(left.ok).toBe(true);
		expect(left.x).toBeCloseTo(0.35);
		expect(left.y).toBeCloseTo(0.4);
		const right = resolveFaceFxBindPoint({ face, bind: "rightEye" });
		expect(right.ok).toBe(true);
		expect(right.x).toBeCloseTo(0.65);
		expect(right.y).toBeCloseTo(0.42);
		const center = resolveFaceFxBindPoint({ face, bind: "eyesCenter" });
		expect(center.ok).toBe(true);
		expect(center.x).toBeCloseTo(0.5);
		expect(center.y).toBeCloseTo(0.41);
		const forehead = resolveFaceFxBindPoint({ face, bind: "forehead" });
		expect(forehead.ok).toBe(true);
		expect(forehead.x).toBeCloseTo(0.5);
		expect(forehead.y).toBeCloseTo(0.15);
		const nose = resolveFaceFxBindPoint({ face, bind: "noseBridge" });
		expect(nose.ok).toBe(true);
		expect(nose.x).toBeCloseTo(0.5);
		expect(nose.y).toBeCloseTo(0.45);
	});

	test("faceMatrix prefers matrix presence and falls back to box center", () => {
		const bare = faceWith([]);
		const p = resolveFaceFxBindPoint({ face: bare, bind: "faceMatrix" });
		expect(p.x).toBeCloseTo(0.4);
		expect(p.y).toBeCloseTo(0.45);
		expect(p.ok).toBe(true);

		const withMat = faceWith([], {
			transformationMatrix: new Float32Array(16),
		});
		expect(
			resolveFaceFxBindPoint({ face: withMat, bind: "faceMatrix" }).ok,
		).toBe(true);
	});
});
