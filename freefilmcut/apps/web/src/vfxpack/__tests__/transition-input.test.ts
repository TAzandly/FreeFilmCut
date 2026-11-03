import { describe, expect, test } from "bun:test";
import {
	TRANSITION_FROM_PREFERRED,
	TRANSITION_FROM_UNIFORM_NAMES,
	TRANSITION_TO_PREFERRED,
	TRANSITION_TO_UNIFORM_NAMES,
	isTransitionFromUniformName,
	isTransitionToUniformName,
	listTransitionFromUniforms,
	listTransitionToUniforms,
} from "../transition-input";

describe("transition-input uniform names", () => {
	test("preferred names match canonical first entries", () => {
		expect(TRANSITION_FROM_PREFERRED).toBe("uTransitionFrom");
		expect(TRANSITION_TO_PREFERRED).toBe("uTransitionTo");
		expect(TRANSITION_FROM_UNIFORM_NAMES[0]).toBe(TRANSITION_FROM_PREFERRED);
		expect(TRANSITION_TO_UNIFORM_NAMES[0]).toBe(TRANSITION_TO_PREFERRED);
	});

	test("isTransitionFromUniformName recognizes aliases", () => {
		for (const name of TRANSITION_FROM_UNIFORM_NAMES) {
			expect(isTransitionFromUniformName(name)).toBe(true);
		}
		expect(isTransitionFromUniformName("uInput")).toBe(false);
	});

	test("isTransitionToUniformName recognizes aliases", () => {
		for (const name of TRANSITION_TO_UNIFORM_NAMES) {
			expect(isTransitionToUniformName(name)).toBe(true);
		}
		expect(isTransitionToUniformName("uTransitionFrom")).toBe(false);
	});

	test("listTransitionFromUniforms returns canonical order", () => {
		expect(listTransitionFromUniforms(null)).toEqual([]);
		expect(listTransitionFromUniforms(undefined)).toEqual([]);
		expect(listTransitionFromUniforms({})).toEqual([]);

		expect(
			listTransitionFromUniforms({
				transitionFrom: { value: null },
				uTransitionFrom: { value: null },
				uFrom: { value: null },
				uNoise: { value: 0 },
			}),
		).toEqual(["uTransitionFrom", "uFrom", "transitionFrom"]);
	});

	test("listTransitionToUniforms returns canonical order", () => {
		expect(listTransitionToUniforms(null)).toEqual([]);
		expect(
			listTransitionToUniforms({
				uTo: { value: null },
				uTransitionTo: { value: null },
			}),
		).toEqual(["uTransitionTo", "uTo"]);
	});
});
