import type { RetimeConfig, RetimeCurveKey } from "@/timeline";
import { clampRetimeRate, DEFAULT_RETIME_RATE } from "@/retime/rate";

export type RetimeCurvePresetId =
	| "none"
	| "custom"
	| "montage"
	| "hero"
	| "bullet"
	| "jump"
	| "flashIn"
	| "flashOut";

export type RetimeCurvePreset = {
	id: RetimeCurvePresetId;
	label: string;
	keys: RetimeCurveKey[];
};

/** Preset grid (CapCut-style English labels). t ∈ [0,1] over clip. */
export const RETIME_CURVE_PRESETS: readonly RetimeCurvePreset[] = [
	{ id: "none", label: "None", keys: [{ t: 0, rate: 1 }, { t: 1, rate: 1 }] },
	{
		id: "custom",
		label: "Custom",
		keys: [
			{ t: 0, rate: 1 },
			{ t: 0.5, rate: 1.5 },
			{ t: 1, rate: 1 },
		],
	},
	{
		id: "montage",
		label: "Montage",
		keys: [
			{ t: 0, rate: 1.2 },
			{ t: 0.25, rate: 2.2 },
			{ t: 0.5, rate: 1.4 },
			{ t: 0.75, rate: 2.4 },
			{ t: 1, rate: 1.2 },
		],
	},
	{
		id: "hero",
		label: "Hero moment",
		keys: [
			{ t: 0, rate: 1.6 },
			{ t: 0.35, rate: 1.8 },
			{ t: 0.5, rate: 0.35 },
			{ t: 0.65, rate: 1.8 },
			{ t: 1, rate: 1.4 },
		],
	},
	{
		id: "bullet",
		label: "Bullet time",
		keys: [
			{ t: 0, rate: 1.5 },
			{ t: 0.3, rate: 0.25 },
			{ t: 0.7, rate: 0.25 },
			{ t: 1, rate: 1.5 },
		],
	},
	{
		id: "jump",
		label: "Jump cut",
		keys: [
			{ t: 0, rate: 1 },
			{ t: 0.2, rate: 1 },
			{ t: 0.22, rate: 4 },
			{ t: 0.45, rate: 4 },
			{ t: 0.47, rate: 1 },
			{ t: 1, rate: 1 },
		],
	},
	{
		id: "flashIn",
		label: "Flash in",
		keys: [
			{ t: 0, rate: 3.5 },
			{ t: 0.25, rate: 1.2 },
			{ t: 1, rate: 1 },
		],
	},
	{
		id: "flashOut",
		label: "Flash out",
		keys: [
			{ t: 0, rate: 1 },
			{ t: 0.75, rate: 1.2 },
			{ t: 1, rate: 3.5 },
		],
	},
];

export function isCurveRetime({
	retime,
}: {
	retime?: RetimeConfig | null;
}): boolean {
	return retime?.mode === "curve" && Array.isArray(retime.keys) && retime.keys.length >= 2;
}

function sortKeys(keys: readonly RetimeCurveKey[]): RetimeCurveKey[] {
	return keys
		.map((key) => ({
			t: Math.min(1, Math.max(0, key.t)),
			rate: clampRetimeRate({ rate: key.rate }),
		}))
		.sort((a, b) => a.t - b.t);
}

export function normalizeCurveKeys({
	keys,
}: {
	keys: readonly RetimeCurveKey[];
}): RetimeCurveKey[] {
	const sorted = sortKeys(keys);
	if (sorted.length === 0) {
		return [
			{ t: 0, rate: DEFAULT_RETIME_RATE },
			{ t: 1, rate: DEFAULT_RETIME_RATE },
		];
	}
	if (sorted[0].t > 0) {
		sorted.unshift({ t: 0, rate: sorted[0].rate });
	}
	const last = sorted[sorted.length - 1];
	if (last.t < 1) {
		sorted.push({ t: 1, rate: last.rate });
	}
	return sorted;
}

/** Piecewise-linear rate at normalized clip time u ∈ [0,1]. */
export function sampleCurveRateAt({
	keys,
	u,
}: {
	keys: readonly RetimeCurveKey[];
	u: number;
}): number {
	const normalized = normalizeCurveKeys({ keys });
	const t = Math.min(1, Math.max(0, u));
	for (let i = 0; i < normalized.length - 1; i++) {
		const a = normalized[i];
		const b = normalized[i + 1];
		if (t >= a.t && t <= b.t) {
			const span = b.t - a.t;
			if (span <= 1e-9) return b.rate;
			const w = (t - a.t) / span;
			return clampRetimeRate({ rate: a.rate + (b.rate - a.rate) * w });
		}
	}
	return clampRetimeRate({ rate: normalized[normalized.length - 1].rate });
}

/**
 * ∫_0^u rate(s) ds over normalized clip domain (result in "normalized source units").
 * Multiply by clipDuration to get source ticks consumed.
 */
export function integrateCurveRate({
	keys,
	u,
}: {
	keys: readonly RetimeCurveKey[];
	u: number;
}): number {
	const normalized = normalizeCurveKeys({ keys });
	const end = Math.min(1, Math.max(0, u));
	if (end <= 0) return 0;

	let area = 0;
	for (let i = 0; i < normalized.length - 1; i++) {
		const a = normalized[i];
		const b = normalized[i + 1];
		if (end <= a.t) break;
		const segStart = a.t;
		const segEnd = Math.min(b.t, end);
		if (segEnd <= segStart) continue;
		const span = b.t - a.t;
		if (span <= 1e-9) {
			area += (segEnd - segStart) * b.rate;
			continue;
		}
		const rateAtStart = a.rate + ((segStart - a.t) / span) * (b.rate - a.rate);
		const rateAtEnd = a.rate + ((segEnd - a.t) / span) * (b.rate - a.rate);
		area += ((rateAtStart + rateAtEnd) / 2) * (segEnd - segStart);
	}
	return area;
}

export function meanCurveRate({
	keys,
}: {
	keys: readonly RetimeCurveKey[];
}): number {
	const area = integrateCurveRate({ keys, u: 1 });
	return clampRetimeRate({ rate: area });
}

export function buildCurveRetime({
	curveId,
	keys,
	maintainPitch = false,
}: {
	curveId?: RetimeCurvePresetId;
	keys: readonly RetimeCurveKey[];
	maintainPitch?: boolean;
}): RetimeConfig {
	const normalized = normalizeCurveKeys({ keys });
	return {
		mode: "curve",
		curveId,
		keys: normalized,
		rate: meanCurveRate({ keys: normalized }),
		maintainPitch,
	};
}

export function getCurvePreset({
	id,
}: {
	id: RetimeCurvePresetId;
}): RetimeCurvePreset | null {
	return RETIME_CURVE_PRESETS.find((preset) => preset.id === id) ?? null;
}
