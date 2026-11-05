import type { ElementParamDefinition } from "@/params/registry";
import { DEFAULT_COLOR_CORRECTION_INTENSITY } from "./settings";

export function buildColorCorrectionParamDefs(): ElementParamDefinition[] {
	return [
		{
			key: "colorCorrection.enabled",
			label: "Color Correction",
			type: "boolean",
			default: false,
			keyframable: false,
		},
		{
			key: "colorCorrection.intensity",
			label: "Correction Intensity",
			type: "number",
			default: DEFAULT_COLOR_CORRECTION_INTENSITY,
			min: 0,
			max: 100,
			step: 1,
			keyframable: true,
			dependencies: [{ param: "colorCorrection.enabled", equals: true }],
		},
	];
}
