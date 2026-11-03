import { describe, expect, test } from "bun:test";
import {
	getEffectDescriptor,
	registerBuiltinPostEffects,
} from "@/vfxpack/postprocess/registry";
import { BOKEH_GLOW_CUSTOM } from "@/vfxpack/postprocess/presets/bokeh-glow-custom";

describe("custom:bokeh-glow P4 preset", () => {
	test("registers beside handwritten bokehGlow", () => {
		registerBuiltinPostEffects();
		const hand = getEffectDescriptor("bokehGlow");
		const cfg = getEffectDescriptor("custom:bokeh-glow");
		expect(hand).toBeTruthy();
		expect(cfg).toBeTruthy();
		expect(cfg?.type).toBe("custom:bokeh-glow");
		expect(cfg?.__customDefinition?.id).toBe("bokeh-glow");
	});

	test("defaults match handwritten slider pack (filter→filterIns for GLSL)", () => {
		registerBuiltinPostEffects();
		const hand = getEffectDescriptor("bokehGlow")!.createDefaultParams();
		const cfg = getEffectDescriptor("custom:bokeh-glow")!.createDefaultParams();
		expect(cfg.size).toBe(hand.size);
		expect(cfg.number).toBe(hand.number);
		expect(cfg.intensity).toBe(hand.intensity);
		expect(cfg.filterIns).toBe(hand.filter);
		expect(cfg.timeIntensity).toBe(hand.timeIntensity);
	});

	test("definition has 5 passes + 0.55 bokeh scale + two textures", () => {
		expect(BOKEH_GLOW_CUSTOM.passes).toHaveLength(5);
		expect(BOKEH_GLOW_CUSTOM.passes?.[2]?.resolutionScale).toBe(0.55);
		expect(BOKEH_GLOW_CUSTOM.passes?.[3]?.resolutionScale).toBe(0.55);
		expect(BOKEH_GLOW_CUSTOM.textures).toHaveLength(2);
		expect(BOKEH_GLOW_CUSTOM.params?.map((p) => p.key)).toEqual([
			"timeIntensity",
			"size",
			"number",
			"intensity",
			"filterIns",
		]);
	});

	test("createPasses builds 5 ConfigurablePass stages", () => {
		registerBuiltinPostEffects();
		const desc = getEffectDescriptor("custom:bokeh-glow")!;
		const passes = desc.createPasses({ width: 1280, height: 720 });
		expect(passes).toHaveLength(5);
		const b0 = passes[2] as {
			_resolutionScale?: number;
			outputRT?: { width: number; height: number };
		};
		expect(b0._resolutionScale).toBeCloseTo(0.55);
		expect(b0.outputRT?.width).toBe(Math.floor(1280 * 0.55));
		expect(b0.outputRT?.height).toBe(Math.floor(720 * 0.55));
		for (const p of passes) (p as { dispose?: () => void }).dispose?.();
	});
});
