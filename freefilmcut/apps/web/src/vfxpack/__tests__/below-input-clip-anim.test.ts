import { describe, expect, test } from "bun:test";
import { packNeedsBelowInput } from "@/vfxpack/below-input";

describe("packNeedsBelowInput clip-anim", () => {
	test("clip-anim defaults to needing below when scope omitted", () => {
		expect(packNeedsBelowInput({ type: "clip-anim", scope: null })).toBe(true);
		expect(packNeedsBelowInput({ type: "clip-anim", scope: "" })).toBe(true);
		expect(packNeedsBelowInput({ type: "clip-anim", scope: "below" })).toBe(
			true,
		);
	});

	test("clip-anim stack scope does not need below", () => {
		expect(packNeedsBelowInput({ type: "clip-anim", scope: "stack" })).toBe(
			false,
		);
	});
});
