import { expect, test } from "bun:test";
import { COLOR_CORRECTION_SHADER_HELPERS } from "@/color-correction/shader-core";
import { injectColorGradeShader } from "../compositor/color-grade-material";

test("injection includes correction before grade", () => {
	const src = `
#include <common>
void main() {
#include <map_fragment>
}
`;
	const out = injectColorGradeShader({ fragmentShader: src });
	expect(out).toContain("applyFccColorCorrection");
	const iCorr = out.indexOf("applyFccColorCorrection");
	const iGrade = out.indexOf("applyFccColorGrade");
	expect(iCorr).toBeGreaterThan(-1);
	expect(iGrade).toBeGreaterThan(iCorr);
	expect(COLOR_CORRECTION_SHADER_HELPERS).toContain(
		"uColorCorrectionEnableContrast",
	);
});
