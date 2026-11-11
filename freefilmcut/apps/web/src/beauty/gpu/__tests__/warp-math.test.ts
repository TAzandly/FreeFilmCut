import { describe, expect, test } from "bun:test";

type Vec2 = { x: number; y: number };
type Ctrl = { sx: number; sy: number; tx: number; ty: number };

/** Mirrors soft weight in `BEAUTY_WARP_FRAGMENT_SHADER`. */
function softWeight(p: Vec2, c: Ctrl, amount: number, r: number): { w: number; m: Vec2 } {
	const m = { x: (c.tx - c.sx) * amount, y: (c.ty - c.sy) * amount };
	const mm = m.x * m.x + m.y * m.y;
	if (mm < 1e-12 || r <= 0) return { w: 0, m };
	const dx = p.x - c.sx;
	const dy = p.y - c.sy;
	const dd = dx * dx + dy * dy;
	const r2 = r * r;
	if (dd >= r2) return { w: 0, m };
	const t = 1 - dd / r2;
	return { w: t * t, m };
}

/** `p -= sum(w*m) / max(sum(w), 1)` — keeps falloff, caps overlap stacking. */
function blend(p: Vec2, controls: Ctrl[], amount: number, r: number): Vec2 {
	let nx = 0;
	let ny = 0;
	let den = 0;
	for (const c of controls) {
		const { w, m } = softWeight(p, c, amount, r);
		nx += w * m.x;
		ny += w * m.y;
		den += w;
	}
	if (den < 1e-8) return p;
	const inv = 1 / Math.max(den, 1);
	return { x: p.x - nx * inv, y: p.y - ny * inv };
}

/** Bug: `p -= sum(w*m)/sum(w)` cancels falloff for a single control. */
function blendCancelFalloff(p: Vec2, controls: Ctrl[], amount: number, r: number): Vec2 {
	let nx = 0;
	let ny = 0;
	let den = 0;
	for (const c of controls) {
		const { w, m } = softWeight(p, c, amount, r);
		nx += w * m.x;
		ny += w * m.y;
		den += w;
	}
	if (den < 1e-8) return p;
	return { x: p.x - nx / den, y: p.y - ny / den };
}

describe("soft slim warp blend", () => {
	const left: Ctrl = { sx: 0.35, sy: 0.55, tx: 0.5, ty: 0.55 };
	const right: Ctrl = { sx: 0.65, sy: 0.55, tx: 0.5, ty: 0.55 };
	const midJaw: Ctrl = { sx: 0.38, sy: 0.62, tx: 0.5, ty: 0.62 };

	test("midline stays put under opposing left/right pulls", () => {
		const p = { x: 0.5, y: 0.55 };
		const out = blend(p, [left, right], 0.3, 0.2);
		expect(out.x).toBeCloseTo(0.5, 5);
		expect(out.y).toBeCloseTo(0.55, 5);
	});

	test("edge of radius moves much less than the center (soft region)", () => {
		const amount = 0.25;
		const r = 0.2;
		const center = { x: left.sx, y: left.sy };
		const nearEdge = { x: left.sx + r * 0.92, y: left.sy };
		const cOut = blend(center, [left], amount, r);
		const eOut = blend(nearEdge, [left], amount, r);
		const cDist = Math.hypot(cOut.x - center.x, cOut.y - center.y);
		const eDist = Math.hypot(eOut.x - nearEdge.x, eOut.y - nearEdge.y);
		expect(cDist).toBeGreaterThan(1e-4);
		expect(eDist).toBeLessThan(cDist * 0.2);
	});

	test("dividing by den alone makes the edge as hard as the center", () => {
		const amount = 0.25;
		const r = 0.2;
		const nearEdge = { x: left.sx + r * 0.92, y: left.sy };
		const soft = blend(nearEdge, [left], amount, r);
		const hard = blendCancelFalloff(nearEdge, [left], amount, r);
		const softDist = Math.hypot(soft.x - nearEdge.x, soft.y - nearEdge.y);
		const hardDist = Math.hypot(hard.x - nearEdge.x, hard.y - nearEdge.y);
		expect(hardDist).toBeGreaterThan(softDist * 5);
	});

	test("overlapping same-side controls do not stack unboundedly", () => {
		const p = { x: 0.36, y: 0.58 };
		const amount = 0.25;
		const r = 0.2;
		const one = blend(p, [left], amount, r);
		const many = blend(p, [left, midJaw], amount, r);
		const oneDist = Math.hypot(one.x - p.x, one.y - p.y);
		const manyDist = Math.hypot(many.x - p.x, many.y - p.y);
		expect(manyDist).toBeLessThanOrEqual(oneDist * 1.35);
	});
});
