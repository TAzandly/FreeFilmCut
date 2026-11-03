import type { RetimeConfig } from "@/timeline";
import { clampRetimeRate } from "@/retime/rate";
import {
	integrateCurveRate,
	isCurveRetime,
	meanCurveRate,
	sampleCurveRateAt,
} from "@/retime/curve";

function getSafeRate({ rate }: { rate: number }): number {
	return clampRetimeRate({ rate });
}

function getMeanRate({ retime }: { retime?: RetimeConfig }): number {
	if (isCurveRetime({ retime }) && retime?.keys) {
		return meanCurveRate({ keys: retime.keys });
	}
	return getSafeRate({ rate: retime?.rate ?? 1 });
}

/**
 * Maps clip-local time → source-local delta.
 *
 * For curves, pass `clipDuration` (same units as `clipTime`) so rate keys can
 * be normalized. Without it, falls back to the mean/constant rate.
 */
export function getSourceTimeAtClipTime({
	clipTime,
	retime,
	clipDuration,
}: {
	clipTime: number;
	retime?: RetimeConfig;
	clipDuration?: number;
}): number {
	if (clipTime <= 0) return 0;

	if (
		isCurveRetime({ retime }) &&
		retime?.keys &&
		typeof clipDuration === "number" &&
		clipDuration > 0
	) {
		const u = Math.min(1, Math.max(0, clipTime / clipDuration));
		return clipDuration * integrateCurveRate({ keys: retime.keys, u });
	}

	return clipTime * getMeanRate({ retime });
}

export function getClipTimeAtSourceTime({
	sourceTime,
	retime,
	clipDuration,
}: {
	sourceTime: number;
	retime?: RetimeConfig;
	clipDuration?: number;
}): number {
	if (sourceTime <= 0) return 0;

	if (
		isCurveRetime({ retime }) &&
		retime?.keys &&
		typeof clipDuration === "number" &&
		clipDuration > 0
	) {
		const target = sourceTime / clipDuration;
		let lo = 0;
		let hi = 1;
		for (let i = 0; i < 28; i++) {
			const mid = (lo + hi) / 2;
			const area = integrateCurveRate({ keys: retime.keys, u: mid });
			if (area < target) lo = mid;
			else hi = mid;
		}
		return ((lo + hi) / 2) * clipDuration;
	}

	return sourceTime / getMeanRate({ retime });
}

export function getEffectiveRateAt({
	retime,
	clipTime,
	clipDuration,
}: {
	clipTime?: number;
	clipDuration?: number;
	retime?: RetimeConfig;
}): number {
	if (
		isCurveRetime({ retime }) &&
		retime?.keys &&
		typeof clipTime === "number" &&
		typeof clipDuration === "number" &&
		clipDuration > 0
	) {
		return sampleCurveRateAt({
			keys: retime.keys,
			u: clipTime / clipDuration,
		});
	}
	return getMeanRate({ retime });
}

export function getTimelineDurationForSourceSpan({
	sourceSpan,
	retime,
}: {
	sourceSpan: number;
	retime?: RetimeConfig;
}): number {
	if (sourceSpan <= 0) {
		return 0;
	}
	return sourceSpan / getMeanRate({ retime });
}
