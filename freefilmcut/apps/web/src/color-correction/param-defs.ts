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
			label: "Intensity",
			type: "number",
			control: "slider",
			default: DEFAULT_COLOR_CORRECTION_INTENSITY,
			min: 0,
			max: 100,
			step: 1,
			keyframable: true,
			// Visibility is owned by ColorCorrectionSection (enabled gate). Do not
			// depend on colorCorrection.enabled here: ElementParamFields only
			// builds values for the params it is given, so the dependency would
			// always fail when intensity is passed alone.
		},
	];
}
