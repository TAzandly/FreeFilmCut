/**
 * Face FX driver helpers: bind targets → MediaPipe landmark indices / NDC points.
 * Shared by editor preview and NLE runtime.
 */

import {
	EYE_CORNER_INDICES,
	FACE_AXIS_INDICES,
	FACE_OVAL_INDICES,
} from "@/beauty/analysis/landmark-indices";
import type { FaceLandmarks } from "@/beauty/analysis/types";
import type { FaceFxBindTarget } from "@/vfxpack/face-fx";

/**
 * MediaPipe iris centers (478-landmark model with iris).
 * MediaPipe Left/Right = subject's Left/Right; image-left is subject's right.
 */
export const FACE_FX_IRIS_INDICES = {
	/** Image-left eye (subject's right iris). */
	imageLeft: 473,
	/** Image-right eye (subject's left iris). */
	imageRight: 468,
} as const;

/**
 * Primary landmark index (or indices to average) for each bind target.
 * `faceMatrix` has no point index — callers use `transformationMatrix` instead.
 */
export const FACE_FX_BIND_LANDMARKS: Record<
	Exclude<FaceFxBindTarget, "faceMatrix">,
	readonly number[]
> = {
	/** Top of face oval (forehead center). */
	forehead: [FACE_OVAL_INDICES[0]],
	/** Nose bridge on the facial axis. */
	noseBridge: [FACE_AXIS_INDICES[0]],
	/** Image-left eye: iris, else outer/inner corners. */
	leftEye: [
		FACE_FX_IRIS_INDICES.imageLeft,
		...EYE_CORNER_INDICES.imageLeft,
	],
	/** Image-right eye. */
	rightEye: [
		FACE_FX_IRIS_INDICES.imageRight,
		...EYE_CORNER_INDICES.imageRight,
	],
	/** Midpoint of both eye centers (resolved at runtime). */
	eyesCenter: [
		FACE_FX_IRIS_INDICES.imageLeft,
		FACE_FX_IRIS_INDICES.imageRight,
	],
};

export type FaceFxBindPoint = {
	/** Normalized image x (0..1). */
	x: number;
	/** Normalized image y (0..1). */
	y: number;
	/** True when the point came from landmarks (false for faceMatrix without matrix). */
	ok: boolean;
};

function readLandmarkXY(
	points: Float32Array,
	index: number,
): { x: number; y: number } | null {
	const o = index * 2;
	if (o + 1 >= points.length) return null;
	const x = points[o];
	const y = points[o + 1];
	if (!Number.isFinite(x) || !Number.isFinite(y)) return null;
	return { x, y };
}

/** Average the first available landmarks in `indices` (skip missing). */
export function averageLandmarkIndices(
	points: Float32Array,
	indices: readonly number[],
): FaceFxBindPoint {
	let sx = 0;
	let sy = 0;
	let n = 0;
	for (const idx of indices) {
		const p = readLandmarkXY(points, idx);
		if (!p) continue;
		sx += p.x;
		sy += p.y;
		n++;
	}
	if (n === 0) return { x: 0.5, y: 0.5, ok: false };
	return { x: sx / n, y: sy / n, ok: true };
}

/**
 * Resolve a semantic bind target to a normalized image point.
 * For `faceMatrix`, returns face box center when matrix is absent (ok=false
 * unless `transformationMatrix` is present — then ok=true with box center as
 * a 2D fallback until 3D pose is applied by the runtime).
 */
export function resolveFaceFxBindPoint({
	face,
	bind,
}: {
	face: FaceLandmarks;
	bind: FaceFxBindTarget;
}): FaceFxBindPoint {
	if (bind === "faceMatrix") {
		const box = face.box;
		const hasMatrix =
			face.transformationMatrix instanceof Float32Array &&
			face.transformationMatrix.length >= 16;
		return {
			x: box.x + box.w / 2,
			y: box.y + box.h / 2,
			ok: hasMatrix || (box.w > 0 && box.h > 0),
		};
	}

	if (bind === "leftEye") {
		const iris = readLandmarkXY(face.points, FACE_FX_IRIS_INDICES.imageLeft);
		if (iris) return { ...iris, ok: true };
		return averageLandmarkIndices(face.points, EYE_CORNER_INDICES.imageLeft);
	}

	if (bind === "rightEye") {
		const iris = readLandmarkXY(face.points, FACE_FX_IRIS_INDICES.imageRight);
		if (iris) return { ...iris, ok: true };
		return averageLandmarkIndices(face.points, EYE_CORNER_INDICES.imageRight);
	}

	if (bind === "eyesCenter") {
		const left = resolveFaceFxBindPoint({ face, bind: "leftEye" });
		const right = resolveFaceFxBindPoint({ face, bind: "rightEye" });
		if (!left.ok && !right.ok) return { x: 0.5, y: 0.5, ok: false };
		if (!left.ok) return right;
		if (!right.ok) return left;
		return {
			x: (left.x + right.x) / 2,
			y: (left.y + right.y) / 2,
			ok: true,
		};
	}

	return averageLandmarkIndices(face.points, FACE_FX_BIND_LANDMARKS[bind]);
}

/** Landmark index list for a bind (empty for faceMatrix). */
export function faceFxBindLandmarkIndices(
	bind: FaceFxBindTarget,
): readonly number[] {
	if (bind === "faceMatrix") return [];
	return FACE_FX_BIND_LANDMARKS[bind];
}
