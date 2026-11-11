import {
	EYE_CORNER_INDICES,
	FACE_AXIS_INDICES,
	FACE_SLIM_INDICES,
	FACE_V_INDICES,
	FACE_WIDTH_INDICES,
	LEFT_EYE_INDICES,
	NOSE_WING_INDICES,
	RIGHT_EYE_INDICES,
} from "../analysis/landmark-indices";
import type { FaceLandmarks } from "../analysis/types";

/**
 * Faces warped per frame. Uniform arrays are fixed-size; extra faces (smallest
 * boxes first dropped) are left unwarped. Smooth/whiten use the skin mask and are
 * not limited by this.
 */
export const MAX_BEAUTY_FACES = 4;

	/** Control points per side for face slim / V-face (must match landmark lists). */
	export const FACE_SLIM_POINT_COUNT = FACE_SLIM_INDICES.imageLeft.length;
	export const FACE_V_POINT_COUNT = FACE_V_INDICES.imageLeft.length;

	/** `vec4` slots per face in the warp uniform array. */
	export const WARP_VEC4_PER_FACE =
		2 + FACE_SLIM_POINT_COUNT * 2 + 2 + 1 + FACE_V_POINT_COUNT * 2;

	/**
	 * Per-face layout (all positions in aspect space: `x * width/height, y`, so
	 * distances are isotropic):
	 *   [0],[1]     eyes     (cx, cy, radius, 0)       image-left, image-right
	 *   [2..6]      slim L   (sx, sy, tx, ty)           FACE_SLIM_INDICES.imageLeft
	 *   [7..11]     slim R   (sx, sy, tx, ty)           FACE_SLIM_INDICES.imageRight
	 *   [12],[13]   nose     (sx, sy, tx, ty)           NOSE_WING_INDICES left, right
	 *   [14]        radii    (jawRadius, noseRadius, vFaceRadius, 0)
	 *   [15..17]    vFace L  (sx, sy, tx, ty)           FACE_V_INDICES.imageLeft
	 *   [18..20]    vFace R  (sx, sy, tx, ty)           FACE_V_INDICES.imageRight
	 * `(tx, ty)` is the closest point on the face axis (nose bridge to chin); the
	 * shader moves content `(t - s) * strength`.
	 */
	export const WARP_SLOT = {
		eyeLeft: 0,
		eyeRight: 1,
		jawLeft: 2,
		jawRight: 2 + FACE_SLIM_POINT_COUNT,
		noseLeft: 2 + FACE_SLIM_POINT_COUNT * 2,
		noseRight: 2 + FACE_SLIM_POINT_COUNT * 2 + 1,
		radii: 2 + FACE_SLIM_POINT_COUNT * 2 + 2,
		vFaceLeft: 2 + FACE_SLIM_POINT_COUNT * 2 + 3,
		vFaceRight: 2 + FACE_SLIM_POINT_COUNT * 2 + 3 + FACE_V_POINT_COUNT,
	} as const;

/** Eye radius as a multiple of the eye-corner distance. */
export const EYE_RADIUS_SCALE = 1.1;
/** Jaw influence radius as a multiple of the temple-to-temple width. */
export const JAW_RADIUS_SCALE = 0.22;
/** Nose influence radius as a multiple of the nostril-wing distance. */
export const NOSE_RADIUS_SCALE = 0.7;
/** V-face influence radius as a multiple of the temple-to-temple width. */
export const V_FACE_RADIUS_SCALE = 0.2;

export type PackedWarpFaces = {
	/** `MAX_BEAUTY_FACES * WARP_VEC4_PER_FACE * 4` floats; unused faces are zero. */
	data: Float32Array;
	count: number;
};

type Vec2 = { x: number; y: number };

const MIN_FACE_POINTS = 478 * 2;

function pt(points: Float32Array, index: number, aspect: number): Vec2 {
	return { x: points[index * 2] * aspect, y: points[index * 2 + 1] };
}

function dist(a: Vec2, b: Vec2): number {
	return Math.hypot(a.x - b.x, a.y - b.y);
}

function closestOnLine(p: Vec2, a: Vec2, b: Vec2): Vec2 {
	const dx = b.x - a.x;
	const dy = b.y - a.y;
	const len2 = dx * dx + dy * dy;
	if (len2 < 1e-12) return { x: a.x, y: a.y };
	const t = ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2;
	return { x: a.x + t * dx, y: a.y + t * dy };
}

function centroid(points: Float32Array, indices: readonly number[], aspect: number): Vec2 {
	let x = 0;
	let y = 0;
	for (const i of indices) {
		x += points[i * 2];
		y += points[i * 2 + 1];
	}
	return { x: (x / indices.length) * aspect, y: y / indices.length };
}

function writeVec4(
	data: Float32Array,
	base: number,
	slot: number,
	x: number,
	y: number,
	z: number,
	w: number,
): void {
	const o = base + slot * 4;
	data[o] = x;
	data[o + 1] = y;
	data[o + 2] = z;
	data[o + 3] = w;
}

/** Pack one face into `data` at face index `faceIndex`. */
export function packWarpFace(
	data: Float32Array,
	faceIndex: number,
	face: Pick<FaceLandmarks, "points">,
	aspect: number,
): void {
	const base = faceIndex * WARP_VEC4_PER_FACE * 4;
	const p = face.points;
	const axisA = pt(p, FACE_AXIS_INDICES[0], aspect);
	const axisB = pt(p, FACE_AXIS_INDICES[1], aspect);

	const eye = (slot: number, contour: readonly number[], corners: readonly number[]) => {
		const c = centroid(p, contour, aspect);
		const w = dist(pt(p, corners[0], aspect), pt(p, corners[1], aspect));
		writeVec4(data, base, slot, c.x, c.y, w * EYE_RADIUS_SCALE, 0);
	};
	// MediaPipe names eyes after the subject: RIGHT_EYE (33…) is on the viewer's left.
	eye(WARP_SLOT.eyeLeft, RIGHT_EYE_INDICES, EYE_CORNER_INDICES.imageLeft);
	eye(WARP_SLOT.eyeRight, LEFT_EYE_INDICES, EYE_CORNER_INDICES.imageRight);

	const drag = (slot: number, index: number) => {
		const s = pt(p, index, aspect);
		const t = closestOnLine(s, axisA, axisB);
		writeVec4(data, base, slot, s.x, s.y, t.x, t.y);
	};
	FACE_SLIM_INDICES.imageLeft.forEach((idx, i) => drag(WARP_SLOT.jawLeft + i, idx));
	FACE_SLIM_INDICES.imageRight.forEach((idx, i) => drag(WARP_SLOT.jawRight + i, idx));
	drag(WARP_SLOT.noseLeft, NOSE_WING_INDICES.imageLeft);
	drag(WARP_SLOT.noseRight, NOSE_WING_INDICES.imageRight);
	FACE_V_INDICES.imageLeft.forEach((idx, i) => drag(WARP_SLOT.vFaceLeft + i, idx));
	FACE_V_INDICES.imageRight.forEach((idx, i) => drag(WARP_SLOT.vFaceRight + i, idx));

	const faceWidth = dist(
		pt(p, FACE_WIDTH_INDICES[0], aspect),
		pt(p, FACE_WIDTH_INDICES[1], aspect),
	);
	const noseWidth = dist(
		pt(p, NOSE_WING_INDICES.imageLeft, aspect),
		pt(p, NOSE_WING_INDICES.imageRight, aspect),
	);
	writeVec4(
		data,
		base,
		WARP_SLOT.radii,
		faceWidth * JAW_RADIUS_SCALE,
		noseWidth * NOSE_RADIUS_SCALE,
		faceWidth * V_FACE_RADIUS_SCALE,
		0,
	);
}

/**
 * Pack up to `MAX_BEAUTY_FACES` faces (largest boxes first) for the warp
 * shader. Faces with truncated landmark arrays are skipped.
 */
export function packWarpFaces(
	faces: readonly Pick<FaceLandmarks, "points" | "box">[],
	aspect: number,
): PackedWarpFaces {
	const data = new Float32Array(MAX_BEAUTY_FACES * WARP_VEC4_PER_FACE * 4);
	const usable = faces
		.filter((f) => f.points.length >= MIN_FACE_POINTS)
		.sort((a, b) => b.box.w * b.box.h - a.box.w * a.box.h)
		.slice(0, MAX_BEAUTY_FACES);
	usable.forEach((face, i) => packWarpFace(data, i, face, aspect));
	return { data, count: usable.length };
}

/** Fraction of mask bytes that are skin (> 0), for cheap no-op detection. */
export function skinMaskCoverage(mask: Uint8Array): number {
	if (mask.length === 0) return 0;
	let n = 0;
	for (let i = 0; i < mask.length; i++) if (mask[i] > 0) n++;
	return n / mask.length;
}
