import type { ElementParamDefinition } from "@/params/registry";
import { CURVE_CHANNELS, serializeCurvePoints, DEFAULT_CURVE_POINTS } from "./curves";
import { DEFAULT_COLOR_GRADE_BASIC } from "./settings";

export const COLOR_GRADE_HSL_PARAM_KEYS = [
	"colorGrade.hsl.hue",
	"colorGrade.hsl.sat",
	"colorGrade.hsl.luma",
] as const;

function sliderParam({
	key,
	label,
}: {
	key: string;
	label: string;
}): ElementParamDefinition {
	return {
		key,
		label,
		type: "number",
		control: "slider",
		default: 0,
		min: -100,
		max: 100,
		step: 1,
	};
}

export function buildColorGradeHslParamDefs(): ElementParamDefinition[] {
	return [
		sliderParam({ key: "colorGrade.hsl.hue", label: "Hue" }),
		sliderParam({ key: "colorGrade.hsl.sat", label: "Saturation" }),
		sliderParam({ key: "colorGrade.hsl.luma", label: "Brightness" }),
	];
}

export function buildColorGradeCurvesParamDefs(): ElementParamDefinition[] {
	const linear = serializeCurvePoints(DEFAULT_CURVE_POINTS);
	return CURVE_CHANNELS.map((channel) => ({
		key: `colorGrade.curves.${channel}`,
		label: `Curve ${channel}`,
		type: "text" as const,
		default: linear,
		keyframable: false,
	}));
}

/** Re-export so registry can keep Basic defs local or import. */
export const COLOR_GRADE_BASIC_DEFAULTS = DEFAULT_COLOR_GRADE_BASIC;
