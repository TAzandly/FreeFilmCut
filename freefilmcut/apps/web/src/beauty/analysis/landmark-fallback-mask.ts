import {
	FACE_OVAL_INDICES,
	LEFT_EYE_INDICES,
	LIPS_INNER_INDICES,
	LIPS_OUTER_INDICES,
	RIGHT_EYE_INDICES,
} from "./landmark-indices";
import type { FaceLandmarks } from "./types";

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
	faces: Pick<FaceLandmarks, "points">[],
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
