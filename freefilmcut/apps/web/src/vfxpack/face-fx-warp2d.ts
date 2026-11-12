/**
 * Face FX warp2d — UV displacement math for bulge / pinch / stretchY / wave.
 * Used by the GPU pass (same formulas) and unit tests.
 */

import type { FaceFxWarpPreset } from "@/vfxpack/face-fx";

export type FaceWarpUvParams = {
	/** Sample UV in 0..1. */
	u: number;
	v: number;
	/** Face / region center in UV. */
	centerU: number;
	centerV: number;
	/** Influence radius in UV space (≈ face half-width). */
	radius: number;
	/** 0..2 authoring strength. */
	strength: number;
	preset: FaceFxWarpPreset;
	/** Seconds; used by `wave`. */
	time?: number;
};

function smoothFalloff(dist: number, radius: number): number {
	if (!(radius > 1e-6)) return 0;
	const t = Math.min(1, Math.max(0, dist / radius));
	const s = 1 - t;
	return s * s * (3 - 2 * s);
}

/**
 * Map a sample UV → source UV for a face-centered warp.
 * Outside the radius (or strength≈0) returns the input unchanged.
 */
export function sampleFaceWarpUv({
	u,
	v,
	centerU,
	centerV,
	radius,
	strength,
	preset,
	time = 0,
}: FaceWarpUvParams): { u: number; v: number } {
	const s = Math.max(0, Math.min(2, strength));
	if (s <= 1e-6) return { u, v };

	const dx = u - centerU;
	const dy = v - centerV;
	const dist = Math.hypot(dx, dy);
	const w = smoothFalloff(dist, Math.max(1e-6, radius));
	if (w <= 1e-6) return { u, v };

	const amp = s * w;

	if (preset === "bulge") {
		// Push samples outward → looks like a balloon when sampling.
		const push = 1 + amp * 0.45;
		return {
			u: centerU + dx / push,
			v: centerV + dy / push,
		};
	}

	if (preset === "pinch") {
		const pull = 1 - amp * 0.35;
		const scale = Math.max(0.15, pull);
		return {
			u: centerU + dx / scale,
			v: centerV + dy / scale,
		};
	}

	if (preset === "stretchY") {
		const sy = 1 - amp * 0.4;
		const scaleY = Math.max(0.2, sy);
		return {
			u,
			v: centerV + dy / scaleY,
		};
	}

	// wave — funhouse ripple along X with time.
	const phase = dist * 18 - time * 6;
	const ripple = Math.sin(phase) * amp * 0.04;
	const ang = Math.atan2(dy, dx);
	return {
		u: u + Math.cos(ang) * ripple,
		v: v + Math.sin(ang) * ripple,
	};
}

/** True when the config has at least one enabled-looking warp2d layer. */
export function faceFxHasWarp2d(
	layers: ReadonlyArray<{ kind?: string; strength?: number }>,
): boolean {
	return layers.some(
		(l) =>
			l &&
			l.kind === "warp2d" &&
			(typeof l.strength !== "number" || l.strength > 0),
	);
}
