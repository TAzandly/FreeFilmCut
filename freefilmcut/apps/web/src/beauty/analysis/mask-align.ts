import { buildLandmarkFallbackMask } from "./landmark-fallback-mask";
import type { FaceBox, FaceLandmarks } from "./types";

/** Outer eye corners + chin: a stable triangle for the per-face affine. */
export const MASK_ALIGN_ANCHORS = [33, 263, 152] as const;
/** Region around each target face that receives the re-aligned mask. */
const ALIGN_BOX_EXPAND = 1.5;

type Point = { x: number; y: number };

function anchors(face: FaceLandmarks, width: number, height: number): Point[] {
	return MASK_ALIGN_ANCHORS.map((i) => ({
		x: face.points[i * 2] * width,
		y: face.points[i * 2 + 1] * height,
	}));
}

/**
 * Affine `[a, b, c, d, e, f]` with `from = (a·x + b·y + c, d·x + e·y + f)` for
 * `(x, y)` in `to`, i.e. the inverse mapping used to pull source pixels.
 */
export function solveAffine(to: Point[], from: Point[]): number[] | null {
	const [p1, p2, p3] = to;
	const det =
		p1.x * (p2.y - p3.y) - p1.y * (p2.x - p3.x) + (p2.x * p3.y - p3.x * p2.y);
	if (Math.abs(det) < 1e-6) return null;
	const solve = (v1: number, v2: number, v3: number) => [
		(v1 * (p2.y - p3.y) - p1.y * (v2 - v3) + (v2 * p3.y - v3 * p2.y)) / det,
		(p1.x * (v2 - v3) - v1 * (p2.x - p3.x) + (p2.x * v3 - p3.x * v2)) / det,
		(p1.x * (p2.y * v3 - p3.y * v2) -
			p1.y * (p2.x * v3 - p3.x * v2) +
			v1 * (p2.x * p3.y - p3.x * p2.y)) /
			det,
	];
	return [...solve(from[0].x, from[1].x, from[2].x), ...solve(from[0].y, from[1].y, from[2].y)];
}

function center(box: FaceBox): Point {
	return { x: box.x + box.w / 2, y: box.y + box.h / 2 };
}

/** Closest earlier face of similar size, or null when the face is new. */
function matchFace(
	face: FaceLandmarks,
	candidates: readonly FaceLandmarks[],
): FaceLandmarks | null {
	const c = center(face.box);
	const size = Math.max(face.box.w, face.box.h);
	let best: FaceLandmarks | null = null;
	let bestDist = Number.POSITIVE_INFINITY;
	for (const other of candidates) {
		const otherSize = Math.max(other.box.w, other.box.h);
		if (!(otherSize > size * 0.5 && otherSize < size * 2)) continue;
		const o = center(other.box);
		const dist = Math.hypot(o.x - c.x, o.y - c.y);
		if (dist < size && dist < bestDist) {
			best = other;
			bestDist = dist;
		}
	}
	return best;
}

/**
 * Warp a skin mask computed for `fromFaces` onto `toFaces` (same mask grid),
 * one affine per face. Faces without a counterpart get the landmark polygon.
 * Pixels outside the target faces' expanded boxes are zero.
 */
export function alignSkinMaskToFaces(
	mask: Uint8Array,
	width: number,
	height: number,
	fromFaces: readonly FaceLandmarks[],
	toFaces: readonly FaceLandmarks[],
): Uint8Array {
	const out = new Uint8Array(width * height);
	for (const face of toFaces) {
		const match = matchFace(face, fromFaces);
		const affine = match
			? solveAffine(anchors(face, width, height), anchors(match, width, height))
			: null;
		if (!affine) {
			const fallback = buildLandmarkFallbackMask([face], width, height);
			for (let i = 0; i < out.length; i++) {
				if (fallback[i] > out[i]) out[i] = fallback[i];
			}
			continue;
		}
		const [a, b, c, d, e, f] = affine;
		const { x: cx, y: cy } = center(face.box);
		const hw = (face.box.w * ALIGN_BOX_EXPAND) / 2;
		const hh = (face.box.h * ALIGN_BOX_EXPAND) / 2;
		const x0 = Math.max(0, Math.floor((cx - hw) * width));
		const x1 = Math.min(width, Math.ceil((cx + hw) * width));
		const y0 = Math.max(0, Math.floor((cy - hh) * height));
		const y1 = Math.min(height, Math.ceil((cy + hh) * height));
		for (let y = y0; y < y1; y++) {
			const py = y + 0.5;
			for (let x = x0; x < x1; x++) {
				const px = x + 0.5;
				const sx = Math.floor(a * px + b * py + c);
				const sy = Math.floor(d * px + e * py + f);
				if (sx < 0 || sy < 0 || sx >= width || sy >= height) continue;
				const v = mask[sy * width + sx];
				const i = y * width + x;
				if (v > out[i]) out[i] = v;
			}
		}
	}
	return out;
}
