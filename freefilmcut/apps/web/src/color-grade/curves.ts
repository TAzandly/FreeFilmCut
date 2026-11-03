export type CurvePoint = { x: number; y: number };

export type CurveChannel = "master" | "r" | "g" | "b";

export const CURVE_CHANNELS: CurveChannel[] = ["master", "r", "g", "b"];

export const DEFAULT_CURVE_POINTS: CurvePoint[] = [
	{ x: 0, y: 0 },
	{ x: 1, y: 1 },
];

export const LUT_SIZE = 256;

export function serializeCurvePoints(points: CurvePoint[]): string {
	return JSON.stringify(
		points.map((p) => [
			Math.min(1, Math.max(0, p.x)),
			Math.min(1, Math.max(0, p.y)),
		]),
	);
}

export function parseCurvePoints(raw: string): CurvePoint[] {
	try {
		const parsed = JSON.parse(raw) as unknown;
		if (!Array.isArray(parsed) || parsed.length < 2) {
			return [...DEFAULT_CURVE_POINTS];
		}
		const points: CurvePoint[] = [];
		for (const entry of parsed) {
			if (!Array.isArray(entry) || entry.length < 2) continue;
			const x = Number(entry[0]);
			const y = Number(entry[1]);
			if (!Number.isFinite(x) || !Number.isFinite(y)) continue;
			points.push({
				x: Math.min(1, Math.max(0, x)),
				y: Math.min(1, Math.max(0, y)),
			});
		}
		if (points.length < 2) return [...DEFAULT_CURVE_POINTS];
		points.sort((a, b) => a.x - b.x);
		points[0] = { x: 0, y: points[0]?.y ?? 0 };
		points[points.length - 1] = {
			x: 1,
			y: points[points.length - 1]?.y ?? 1,
		};
		return points;
	} catch {
		return [...DEFAULT_CURVE_POINTS];
	}
}

export function isLinearCurve(points: CurvePoint[]): boolean {
	if (points.length === 2) {
		const a = points[0];
		const b = points[1];
		return (
			!!a &&
			!!b &&
			Math.abs(a.x) < 1e-5 &&
			Math.abs(a.y) < 1e-5 &&
			Math.abs(b.x - 1) < 1e-5 &&
			Math.abs(b.y - 1) < 1e-5
		);
	}
	// More points: still identity if every sample ≈ x
	for (const p of points) {
		if (Math.abs(p.y - p.x) > 1e-3) return false;
	}
	return true;
}

/** Piecewise-linear evaluate. */
export function evaluateCurve({
	points,
	t,
}: {
	points: CurvePoint[];
	t: number;
}): number {
	const x = Math.min(1, Math.max(0, t));
	if (points.length === 0) return x;
	if (points.length === 1) return points[0]?.y ?? x;
	for (let i = 0; i < points.length - 1; i++) {
		const a = points[i];
		const b = points[i + 1];
		if (!a || !b) continue;
		if (x >= a.x && x <= b.x) {
			const span = Math.max(1e-6, b.x - a.x);
			const u = (x - a.x) / span;
			return a.y + (b.y - a.y) * u;
		}
	}
	return points[points.length - 1]?.y ?? x;
}

/**
 * Bake master+RGB curves into a 256×4 R8 LUT (rows: master, r, g, b).
 * Channel curves are applied after master in the shader via separate rows.
 */
export function bakeCurveLut({
	master,
	r,
	g,
	b,
}: {
	master: CurvePoint[];
	r: CurvePoint[];
	g: CurvePoint[];
	b: CurvePoint[];
}): Uint8Array {
	const data = new Uint8Array(LUT_SIZE * 4);
	const channels = [master, r, g, b];
	for (let row = 0; row < 4; row++) {
		const points = channels[row] ?? DEFAULT_CURVE_POINTS;
		for (let i = 0; i < LUT_SIZE; i++) {
			const t = i / (LUT_SIZE - 1);
			const y = evaluateCurve({ points, t });
			data[row * LUT_SIZE + i] = Math.round(
				Math.min(1, Math.max(0, y)) * 255,
			);
		}
	}
	return data;
}

export function curveLutContentHash({
	master,
	r,
	g,
	b,
}: {
	master: CurvePoint[];
	r: CurvePoint[];
	g: CurvePoint[];
	b: CurvePoint[];
}): string {
	return [
		serializeCurvePoints(master),
		serializeCurvePoints(r),
		serializeCurvePoints(g),
		serializeCurvePoints(b),
	].join("|");
}
