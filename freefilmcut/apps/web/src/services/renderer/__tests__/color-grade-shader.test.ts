import { describe, expect, test } from "bun:test";
import { DEFAULT_COLOR_GRADE_BASIC } from "@/color-grade";
import {
	injectColorGradeShader,
	resolveColorGradeUniformValues,
} from "../compositor/color-grade-material";

function fakeMeshBasicFrag({ withChromaMarker = false } = {}) {
	const chroma = withChromaMarker
		? `
	if (uChromaEnabled > 0.5) { diffuseColor.a *= 1.0; }
	/* fcc-chroma-end */
`
		: "";
	return `
#include <common>
#include <map_pars_fragment>
void main() {
#include <map_fragment>
#include <alphamap_fragment>
${chroma}
}
`;
}

describe("resolveColorGradeUniformValues", () => {
	test("identity maps to neutral shader coeffs", () => {
		const values = resolveColorGradeUniformValues({
			grade: DEFAULT_COLOR_GRADE_BASIC,
		});
		expect(values.temp).toBe(0);
		expect(values.tint).toBe(0);
		expect(values.sat).toBe(1);
		expect(values.bright).toBe(0);
		expect(values.contrast).toBe(1);
		expect(values.exposure).toBe(0);
		expect(values.highlights).toBe(0);
		expect(values.shadows).toBe(0);
	});

	test("full warm / contrast / exposure scale as documented", () => {
		const values = resolveColorGradeUniformValues({
			grade: {
				...DEFAULT_COLOR_GRADE_BASIC,
				temperature: 100,
				contrast: 50,
				exposure: -50,
				saturation: -100,
			},
		});
		expect(values.temp).toBe(1);
		expect(values.contrast).toBe(1.5);
		expect(values.exposure).toBe(-1);
		expect(values.sat).toBe(0);
	});
});

describe("injectColorGradeShader", () => {
	test("injects uniforms and body after chroma marker", () => {
		const out = injectColorGradeShader({
			fragmentShader: fakeMeshBasicFrag({ withChromaMarker: true }),
		});
		expect(out).toContain("uColorGradeEnabled");
		const callSite = "diffuseColor.rgb = applyFccColorGrade";
		expect(out).toContain(callSite);
		const chromaAt = out.indexOf("/* fcc-chroma-end */");
		const gradeAt = out.indexOf(callSite);
		expect(chromaAt).toBeGreaterThan(-1);
		expect(gradeAt).toBeGreaterThan(chromaAt);
	});

	test("falls back to alphamap anchor without chroma marker", () => {
		const out = injectColorGradeShader({
			fragmentShader: fakeMeshBasicFrag({ withChromaMarker: false }),
		});
		const callSite = "diffuseColor.rgb = applyFccColorGrade";
		expect(out).toContain(callSite);
		expect(out.indexOf(callSite)).toBeGreaterThan(
			out.indexOf("#include <alphamap_fragment>"),
		);
	});
});
