import {
	FACE_OVAL_INDICES,
	LEFT_EYE_INDICES,
	LIPS_INNER_INDICES,
	LIPS_OUTER_INDICES,
	RIGHT_EYE_INDICES,
} from "./landmark-indices";
import type { FaceBox, FaceLandmarks } from "./types";

type PixelPoint = { x: number; y: number };

function landmarkToPixel(
	points: Float32Array,
	index: number,
	width: number,
	height: number,
): PixelPoint {
	return {
		x: points[index * 2] * width,
		y: points[index * 2 + 1] * height,
	};
}

function polygonFromIndices(
	points: Float32Array,
	indices: readonly number[],
	width: number,
	height: number,
): PixelPoint[] {
	const out: PixelPoint[] = [];
	for (const idx of indices) {
		out.push(landmarkToPixel(points, idx, width, height));
	}
	return out;
}

/** Scanline polygon fill (non-zero winding); `value` 0 clears, 255 fills. */
function fillPolygon(
	mask: Uint8Array,
	width: number,
	height: number,
	polygon: PixelPoint[],
	value: number,
): void {
	const n = polygon.length;
	if (n < 3) return;

	const edges: Array<{ y0: number; y1: number; x0: number; x1: number }> = [];
	for (let i = 0; i < n; i++) {
		const a = polygon[i];
		const b = polygon[(i + 1) % n];
		let y0 = a.y;
		let y1 = b.y;
		let x0 = a.x;
		let x1 = b.x;
		if (y0 === y1) continue;
		if (y0 > y1) {
			[y0, y1] = [y1, y0];
			[x0, x1] = [x1, x0];
		}
		edges.push({ y0, y1, x0, x1 });
	}

	const yMin = Math.max(0, Math.floor(Math.min(...polygon.map((p) => p.y))));
	const yMax = Math.min(height - 1, Math.ceil(Math.max(...polygon.map((p) => p.y))));

	for (let y = yMin; y <= yMax; y++) {
		const scanY = y + 0.5;
		const crossings: number[] = [];
		for (const e of edges) {
			if (scanY < e.y0 || scanY >= e.y1) continue;
			const t = (scanY - e.y0) / (e.y1 - e.y0);
			crossings.push(e.x0 + t * (e.x1 - e.x0));
		}
		crossings.sort((a, b) => a - b);
		for (let i = 0; i + 1 < crossings.length; i += 2) {
			const x0 = Math.max(0, Math.ceil(crossings[i]));
			const x1 = Math.min(width - 1, Math.floor(crossings[i + 1]));
			for (let x = x0; x <= x1; x++) {
				mask[y * width + x] = value;
			}
		}
	}
}

function rasterizeFaceLandmarks(
	mask: Uint8Array,
	points: Float32Array,
	width: number,
	height: number,
): void {
	fillPolygon(
		mask,
		width,
		height,
		polygonFromIndices(points, FACE_OVAL_INDICES, width, height),
		255,
	);
	for (const indices of [
		LEFT_EYE_INDICES,
		RIGHT_EYE_INDICES,
		LIPS_OUTER_INDICES,
		LIPS_INNER_INDICES,
	]) {
		fillPolygon(
			mask,
			width,
			height,
			polygonFromIndices(points, indices, width, height),
			0,
		);
	}
}

/**
 * Build an R8 skin mask from face landmarks when segmentation is unavailable.
 * Fills the face oval and clears eye and lip regions.
 */
export function buildLandmarkFallbackMask(
	faces: readonly Pick<FaceLandmarks, "points">[],
	width: number,
	height: number,
): Uint8Array {
	const mask = new Uint8Array(width * height);
	if (width <= 0 || height <= 0 || faces.length === 0) return mask;
	for (const face of faces) {
		if (face.points.length < 478 * 2) continue;
		rasterizeFaceLandmarks(mask, face.points, width, height);
	}
	return mask;
}

/**
 * Soft elliptical head mask from detector boxes — used when MediaPipe mesh is
 * missing (side faces) and selfie segmentation is unavailable.
 */
export function buildBoxFallbackMask(
	boxes: readonly FaceBox[],
	width: number,
	height: number,
): Uint8Array {
	const mask = new Uint8Array(width * height);
	if (width <= 0 || height <= 0 || boxes.length === 0) return mask;
	for (const box of boxes) {
		const cx = (box.x + box.w / 2) * width;
		const cy = (box.y + box.h / 2) * height;
		const rx = Math.max(1, (box.w * width) / 2);
		const ry = Math.max(1, (box.h * height) / 2);
		const x0 = Math.max(0, Math.floor(cx - rx));
		const x1 = Math.min(width, Math.ceil(cx + rx));
		const y0 = Math.max(0, Math.floor(cy - ry));
		const y1 = Math.min(height, Math.ceil(cy + ry));
		for (let y = y0; y < y1; y++) {
			const ny = (y + 0.5 - cy) / ry;
			for (let x = x0; x < x1; x++) {
				const nx = (x + 0.5 - cx) / rx;
				const q = nx * nx + ny * ny;
				if (q > 1) continue;
				// Soft rim so smooth/whiten do not hard-cut the cheek edge.
				const v = q < 0.7 ? 255 : Math.round(255 * (1 - (q - 0.7) / 0.3));
				const i = y * width + x;
				if (v > mask[i]) mask[i] = v;
			}
		}
	}
	return mask;
}

/**
 * Keep only mask pixels inside a slightly padded face oval (drops neck / shirt
 * that selfie face-skin still leaks onto).
 */
export function clipMaskToFaceOvals(
	mask: Uint8Array,
	width: number,
	height: number,
	faces: readonly Pick<FaceLandmarks, "points">[],
	pad = 1.06,
): Uint8Array {
	const allowed = new Uint8Array(width * height);
	for (const face of faces) {
		if (face.points.length < 478 * 2) continue;
		const oval = polygonFromIndices(face.points, FACE_OVAL_INDICES, width, height);
		let cx = 0;
		let cy = 0;
		for (const p of oval) {
			cx += p.x;
			cy += p.y;
		}
		cx /= oval.length;
		cy /= oval.length;
		const padded = oval.map((p) => ({
			x: cx + (p.x - cx) * pad,
			y: cy + (p.y - cy) * pad,
		}));
		fillPolygon(allowed, width, height, padded, 1);
	}
	const out = new Uint8Array(mask.length);
	for (let i = 0; i < mask.length; i++) out[i] = allowed[i] ? mask[i] : 0;
	return out;
}
