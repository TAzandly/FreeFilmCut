import { resolveAnimationPathValueAtTime } from "@/animation";
import type { ParamValue, ParamValues } from "@/params";
import type { VisualElement } from "@/timeline";
import {
	DEFAULT_CURVE_POINTS,
	type CurveChannel,
	type CurvePoint,
	parseCurvePoints,
	serializeCurvePoints,
	isLinearCurve,
} from "./curves";

/** CapCut-style Basic adjustment (no skin tone this round). Authoring −100..100. */
export type ColorGradeBasic = {
	temperature: number;
	tint: number;
	saturation: number;
	brightness: number;
	contrast: number;
	exposure: number;
	highlights: number;
	shadows: number;
};

/** Global HSL tweak (not per-band). Authoring −100..100. */
export type ColorGradeHsl = {
	hue: number;
	sat: number;
	luma: number;
};

export type ColorGradeCurves = Record<CurveChannel, CurvePoint[]>;

/** Full clip color grade (single GPU pass). */
export type ColorGradeSettings = {
	basic: ColorGradeBasic;
	hsl: ColorGradeHsl;
	curves: ColorGradeCurves;
};

export const DEFAULT_COLOR_GRADE_BASIC: ColorGradeBasic = {
	temperature: 0,
	tint: 0,
	saturation: 0,
	brightness: 0,
	contrast: 0,
	exposure: 0,
	highlights: 0,
	shadows: 0,
};

export const COLOR_GRADE_BASIC_KEYS = [
	"temperature",
	"tint",
	"saturation",
	"brightness",
	"contrast",
	"exposure",
	"highlights",
	"shadows",
] as const satisfies ReadonlyArray<keyof ColorGradeBasic>;

export const COLOR_GRADE_BASIC_PARAM_KEYS = [
	"colorGrade.temperature",
	"colorGrade.tint",
	"colorGrade.saturation",
	"colorGrade.brightness",
	"colorGrade.contrast",
	"colorGrade.exposure",
	"colorGrade.highlights",
	"colorGrade.shadows",
] as const;

export const COLOR_GRADE_HSL_KEYS = ["hue", "sat", "luma"] as const satisfies ReadonlyArray<
	keyof ColorGradeHsl
>;

export const COLOR_GRADE_HSL_PARAM_KEYS = [
	"colorGrade.hsl.hue",
	"colorGrade.hsl.sat",
	"colorGrade.hsl.luma",
] as const;

export const DEFAULT_COLOR_GRADE_HSL: ColorGradeHsl = {
	hue: 0,
	sat: 0,
	luma: 0,
};

export const DEFAULT_COLOR_GRADE_CURVES: ColorGradeCurves = {
	master: [...DEFAULT_CURVE_POINTS],
	r: [...DEFAULT_CURVE_POINTS],
	g: [...DEFAULT_CURVE_POINTS],
	b: [...DEFAULT_CURVE_POINTS],
};

export const DEFAULT_COLOR_GRADE: ColorGradeSettings = {
	basic: { ...DEFAULT_COLOR_GRADE_BASIC },
	hsl: { ...DEFAULT_COLOR_GRADE_HSL },
	curves: {
		master: [...DEFAULT_CURVE_POINTS],
		r: [...DEFAULT_CURVE_POINTS],
		g: [...DEFAULT_CURVE_POINTS],
		b: [...DEFAULT_CURVE_POINTS],
	},
};

const BASIC_KEYS: Array<keyof ColorGradeBasic> = [...COLOR_GRADE_BASIC_KEYS];

function clampSlider(value: number): number {
	if (!Number.isFinite(value)) return 0;
	return Math.min(100, Math.max(-100, value));
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

export function readColorGradeBasicFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ColorGradeBasic {
	const safe = params ?? {};
	const out = { ...DEFAULT_COLOR_GRADE_BASIC };
	for (const key of BASIC_KEYS) {
		out[key] = clampSlider(
			readNumber({
				params: safe,
				key: `colorGrade.${key}`,
				fallback: DEFAULT_COLOR_GRADE_BASIC[key],
			}),
		);
	}
	return out;
}

export function readColorGradeHslFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ColorGradeHsl {
	const safe = params ?? {};
	return {
		hue: clampSlider(
			readNumber({
				params: safe,
				key: "colorGrade.hsl.hue",
				fallback: 0,
			}),
		),
		sat: clampSlider(
			readNumber({
				params: safe,
				key: "colorGrade.hsl.sat",
				fallback: 0,
			}),
		),
		luma: clampSlider(
			readNumber({
				params: safe,
				key: "colorGrade.hsl.luma",
				fallback: 0,
			}),
		),
	};
}

export function readColorGradeCurvesFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ColorGradeCurves {
	const safe = params ?? {};
	const readChannel = (channel: CurveChannel): CurvePoint[] => {
		const raw = safe[`colorGrade.curves.${channel}`];
		if (typeof raw === "string") return parseCurvePoints(raw);
		return [...DEFAULT_CURVE_POINTS];
	};
	return {
		master: readChannel("master"),
		r: readChannel("r"),
		g: readChannel("g"),
		b: readChannel("b"),
	};
}

export function readColorGradeFromParams({
	params,
}: {
	params: ParamValues | undefined;
}): ColorGradeSettings {
	return {
		basic: readColorGradeBasicFromParams({ params }),
		hsl: readColorGradeHslFromParams({ params }),
		curves: readColorGradeCurvesFromParams({ params }),
	};
}

export function isColorGradeBasicIdentity({
	grade,
}: {
	grade: ColorGradeBasic;
}): boolean {
	return BASIC_KEYS.every((key) => Math.abs(grade[key]) < 1e-5);
}

export function isColorGradeHslIdentity({
	hsl,
}: {
	hsl: ColorGradeHsl;
}): boolean {
	return (
		Math.abs(hsl.hue) < 1e-5 &&
		Math.abs(hsl.sat) < 1e-5 &&
		Math.abs(hsl.luma) < 1e-5
	);
}

export function isColorGradeCurvesIdentity({
	curves,
}: {
	curves: ColorGradeCurves;
}): boolean {
	return (
		isLinearCurve(curves.master) &&
		isLinearCurve(curves.r) &&
		isLinearCurve(curves.g) &&
		isLinearCurve(curves.b)
	);
}

export function isColorGradeIdentity({
	grade,
}: {
	grade: ColorGradeSettings;
}): boolean {
	return (
		isColorGradeBasicIdentity({ grade: grade.basic }) &&
		isColorGradeHslIdentity({ hsl: grade.hsl }) &&
		isColorGradeCurvesIdentity({ curves: grade.curves })
	);
}

function sampleSlider({
	animations,
	propertyPath,
	localTime,
	fallback,
}: {
	animations: VisualElement["animations"] | undefined;
	propertyPath: string;
	localTime: Parameters<typeof resolveAnimationPathValueAtTime>[0]["localTime"];
	fallback: number;
}): number {
	const value: ParamValue = resolveAnimationPathValueAtTime({
		animations,
		propertyPath,
		localTime,
		fallbackValue: fallback,
	});
	return clampSlider(typeof value === "number" ? value : fallback);
}

/**
 * Samples grade at clip-local time. Curve shapes stay static (JSON params);
 * Basic / HSL follow normal keyframe channels.
 */
export function resolveColorGradeAtTime({
	base,
	animations,
	localTime,
}: {
	base: ColorGradeSettings;
	animations: VisualElement["animations"] | undefined;
	localTime: Parameters<typeof resolveAnimationPathValueAtTime>[0]["localTime"];
}): ColorGradeSettings {
	const basic = { ...DEFAULT_COLOR_GRADE_BASIC };
	for (const key of BASIC_KEYS) {
		basic[key] = sampleSlider({
			animations,
			propertyPath: `colorGrade.${key}`,
			localTime,
			fallback: base.basic[key],
		});
	}

	const hsl: ColorGradeHsl = {
		hue: sampleSlider({
			animations,
			propertyPath: "colorGrade.hsl.hue",
			localTime,
			fallback: base.hsl.hue,
		}),
		sat: sampleSlider({
			animations,
			propertyPath: "colorGrade.hsl.sat",
			localTime,
			fallback: base.hsl.sat,
		}),
		luma: sampleSlider({
			animations,
			propertyPath: "colorGrade.hsl.luma",
			localTime,
			fallback: base.hsl.luma,
		}),
	};

	return {
		basic,
		hsl,
		curves: {
			master: base.curves.master.map((p) => ({ ...p })),
			r: base.curves.r.map((p) => ({ ...p })),
			g: base.curves.g.map((p) => ({ ...p })),
			b: base.curves.b.map((p) => ({ ...p })),
		},
	};
}

/** @deprecated Prefer resolveColorGradeAtTime — kept for Basic-only call sites. */
export function resolveColorGradeBasicAtTime({
	base,
	animations,
	localTime,
}: {
	base: ColorGradeBasic;
	animations: VisualElement["animations"] | undefined;
	localTime: Parameters<typeof resolveAnimationPathValueAtTime>[0]["localTime"];
}): ColorGradeBasic {
	return resolveColorGradeAtTime({
		base: { ...DEFAULT_COLOR_GRADE, basic: base },
		animations,
		localTime,
	}).basic;
}

export function curvePointsToParamValue(points: CurvePoint[]): string {
	return serializeCurvePoints(points);
}
