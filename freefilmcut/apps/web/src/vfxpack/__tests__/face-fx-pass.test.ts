import { describe, expect, test } from "bun:test";
import { MEDIAPIPE_FACE_LANDMARK_COUNT } from "@/beauty/analysis/mediapipe-face";
import type { FaceLandmarks } from "@/beauty/analysis/types";
import { FACE_FX_IRIS_INDICES } from "@/vfxpack/face-fx-driver";
import {
	packEarAnchors,
	packEyeRays,
	packWarpFaces,
} from "@/vfxpack/face-fx-pass";
import { faceFxWarpPresetId } from "@/vfxpack/face-fx-shaders";

function faceAt(cx: number, cy: number, w = 0.3, h = 0.4): FaceLandmarks {
	const points = new Float32Array(MEDIAPIPE_FACE_LANDMARK_COUNT * 2);
	points[10 * 2] = cx;
	points[10 * 2 + 1] = cy - h * 0.35;
	points[168 * 2] = cx;
	points[168 * 2 + 1] = cy;
	points[FACE_FX_IRIS_INDICES.imageLeft * 2] = cx - w * 0.2;
	points[FACE_FX_IRIS_INDICES.imageLeft * 2 + 1] = cy - h * 0.05;
	points[FACE_FX_IRIS_INDICES.imageRight * 2] = cx + w * 0.2;
	points[FACE_FX_IRIS_INDICES.imageRight * 2 + 1] = cy - h * 0.05;
	return {
		points,
		box: { x: cx - w / 2, y: cy - h / 2, w, h },
	};
}

describe("face-fx pack uniforms", () => {
	test("packWarpFaces fills center/radius/strength", () => {
		const { count, data } = packWarpFaces([faceAt(0.5, 0.5)], 0.8);
		expect(count).toBe(1);
		expect(data[0]).toBeCloseTo(0.5);
		expect(data[1]).toBeCloseTo(0.5);
		expect(data[2]).toBeGreaterThan(0);
		expect(data[3]).toBeCloseTo(0.8);
	});

	test("packEyeRays emits two rays from a face", () => {
		const { count, data } = packEyeRays([faceAt(0.5, 0.5)]);
		expect(count).toBe(2);
		expect(data[0]).toBeLessThan(0.5);
		expect(data[4]).toBeGreaterThan(0.5);
	});

	test("packEarAnchors uses forehead", () => {
		const { count, data } = packEarAnchors([faceAt(0.5, 0.55)]);
		expect(count).toBe(1);
		expect(data[0]).toBeCloseTo(0.5);
		expect(data[2]).toBeCloseTo(0.3);
	});

	test("faceFxWarpPresetId mapping", () => {
		expect(faceFxWarpPresetId("bulge")).toBe(0);
		expect(faceFxWarpPresetId("pinch")).toBe(1);
		expect(faceFxWarpPresetId("stretchY")).toBe(2);
		expect(faceFxWarpPresetId("wave")).toBe(3);
	});
});
