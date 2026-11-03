import type { RetimeConfig } from "@/timeline";
import { clampRetimeRate } from "@/retime/rate";
import {
	buildCurveRetime,
	getCurvePreset,
	type RetimeCurvePresetId,
} from "@/retime/curve";

export function buildConstantRetime({
	rate,
	maintainPitch = false,
}: {
	rate: number;
	maintainPitch?: boolean;
}): RetimeConfig {
	return {
		mode: "constant",
		rate: clampRetimeRate({ rate }),
		maintainPitch,
	};
}

export function buildRetimeFromCurvePreset({
	presetId,
	maintainPitch = false,
}: {
	presetId: RetimeCurvePresetId;
	maintainPitch?: boolean;
}): RetimeConfig | undefined {
	if (presetId === "none") {
		return undefined;
	}
	const preset = getCurvePreset({ id: presetId });
	if (!preset) return undefined;
	return buildCurveRetime({
		curveId: presetId,
		keys: preset.keys,
		maintainPitch,
	});
}
