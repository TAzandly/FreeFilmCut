import { resolveAnimationPathValueAtTime } from "@/animation";
import type { ParamValue, ParamValues } from "@/params";
import type { VisualElement } from "@/timeline";
import {
	ANALYSIS_KEYS,
	IDENTITY_ANALYSIS,
	type ColorCorrectionAnalysis,
} from "./math";

export const COLOR_CORRECTION_PARAM_KEYS = {
	enabled: "colorCorrection.enabled",
	intensity: "colorCorrection.intensity",
	analysis: "colorCorrection.analysis",
} as const;

export const DEFAULT_COLOR_CORRECTION_INTENSITY = 80;

export type ColorCorrectionSettings = {
	enabled: boolean;
	intensity: number;
	analysis: ColorCorrectionAnalysis | null;
};

/** Active for GPU when enabled + analysis present. */
export type ResolvedColorCorrection = {
	enabled: true;
	intensity: number;
	analysis: ColorCorrectionAnalysis;
};

export function serializeColorCorrectionAnalysis({
	analysis,
}: {
	analysis: ColorCorrectionAnalysis;
}): string {
	return JSON.stringify(ANALYSIS_KEYS.map((k) => analysis[k]));
}

export function parseColorCorrectionAnalysis({
	raw,
}: {
	raw: unknown;
}): ColorCorrectionAnalysis | null {
	let parsed: unknown = raw;
	if (typeof raw === "string") {
		try {
			parsed = JSON.parse(raw);
		} catch {
			return null;
		}
	}
	if (!Array.isArray(parsed) || parsed.length !== ANALYSIS_KEYS.length) {
		return null;
	}
	const out: ColorCorrectionAnalysis = { ...IDENTITY_ANALYSIS };
	for (let i = 0; i < ANALYSIS_KEYS.length; i++) {
		const v = parsed[i];
		if (typeof v !== "number" || !Number.isFinite(v)) return null;
		out[ANALYSIS_KEYS[i]!] = v;
	}
	return out;
}

function clampIntensity(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(0, value));
}

function readNumber({
	params,
	key,
	fallback,
}: {
	params: ParamValues;
	key: string;
	fallback: number;
}): number {
	const value = params[key];
	return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function readBoolean({
	value,
	fallback,
}: {
	value: ParamValue | undefined;
	fallback: boolean;
}): boolean {
	return typeof value === "boolean" ? value : fallback;
}

export function readColorCorrectionFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ColorCorrectionSettings {
	const safe = params ?? {};
	const rawAnalysis = safe[COLOR_CORRECTION_PARAM_KEYS.analysis];
	const analysis =
		typeof rawAnalysis === "string"
			? parseColorCorrectionAnalysis({ raw: rawAnalysis })
			: null;

	return {
		enabled: readBoolean({
			value: safe[COLOR_CORRECTION_PARAM_KEYS.enabled],
			fallback: false,
		}),
		intensity: clampIntensity(
			readNumber({
				params: safe,
				key: COLOR_CORRECTION_PARAM_KEYS.intensity,
				fallback: DEFAULT_COLOR_CORRECTION_INTENSITY,
			}),
		),
		analysis,
	};
}

function sampleIntensity({
	animations,
	localTime,
	fallback,
}: {
	animations: VisualElement["animations"] | undefined;
	localTime: Parameters<typeof resolveAnimationPathValueAtTime>[0]["localTime"];
	fallback: number;
}): number {
	const value: ParamValue = resolveAnimationPathValueAtTime({
		animations,
		propertyPath: COLOR_CORRECTION_PARAM_KEYS.intensity,
		localTime,
		fallbackValue: fallback,
	});
	return clampIntensity(typeof value === "number" ? value : fallback);
}

export function resolveColorCorrectionAtTime({
	base,
	animations,
	localTime,
}: {
	base: ColorCorrectionSettings;
	animations: VisualElement["animations"] | undefined;
	localTime: Parameters<typeof resolveAnimationPathValueAtTime>[0]["localTime"];
}): ResolvedColorCorrection | null {
	if (!base.enabled || base.analysis === null) return null;

	return {
		enabled: true,
		intensity: sampleIntensity({
			animations,
			localTime,
			fallback: base.intensity,
		}),
		analysis: base.analysis,
	};
}

export function isColorCorrectionActive({
	correction,
}: {
	correction: ResolvedColorCorrection | null;
}): boolean {
	return correction !== null;
}
