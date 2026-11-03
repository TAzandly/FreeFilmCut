import type { ColorGradeSettings } from "./settings";

export type ColorGradePackedUniforms = {
	temp: number;
	tint: number;
	sat: number;
	bright: number;
	contrast: number;
	exposure: number;
	highlights: number;
	shadows: number;
	/** Global HSL offsets in −1..1 */
	hslHue: number;
	hslSat: number;
	hslLuma: number;
};

function unit(v: number): number {
	return Math.min(100, Math.max(-100, v)) / 100;
}

/** Map authoring −100..100 into shader coefficients. */
export function packColorGradeUniforms({
	grade,
}: {
	grade: ColorGradeSettings;
}): ColorGradePackedUniforms {
	const b = grade.basic;
	return {
		temp: unit(b.temperature),
		tint: unit(b.tint),
		sat: 1 + unit(b.saturation),
		bright: unit(b.brightness) * 0.5,
		contrast: 1 + unit(b.contrast),
		exposure: unit(b.exposure) * 2,
		highlights: unit(b.highlights) * 0.5,
		shadows: unit(b.shadows) * 0.5,
		hslHue: unit(grade.hsl.hue),
		hslSat: unit(grade.hsl.sat),
		hslLuma: unit(grade.hsl.luma),
	};
}
