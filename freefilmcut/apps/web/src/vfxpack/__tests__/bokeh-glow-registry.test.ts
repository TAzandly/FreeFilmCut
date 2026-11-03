import { describe, expect, test } from "bun:test";
import * as THREE from "three";
import type { Pass } from "three/addons/postprocessing/Pass.js";
import {
	getEffectDescriptor,
	registerBuiltinPostEffects,
} from "@/vfxpack/postprocess/registry";
import {
	BokehGlowPass,
	BokehGlowShaderSources,
} from "@/vfxpack/postprocess/bokeh-glow-pass";

describe("bokehGlow pack postprocess", () => {
	test("registered with pack slider defaults", () => {
		registerBuiltinPostEffects();
		const desc = getEffectDescriptor("bokehGlow");
		expect(desc).not.toBeNull();
		// Defaults from the CapCut pack's extra.json slider values.
		expect(desc?.createDefaultParams()).toEqual({
			size: 1.0,
			number: 0.1,
			intensity: 0.6,
			filter: 0.2,
			timeIntensity: 1.0,
		});
	});

	test("createPasses yields one BokehGlowPass", () => {
		registerBuiltinPostEffects();
		const desc = getEffectDescriptor("bokehGlow");
		if (!desc) throw new Error("bokehGlow descriptor missing");
		const passes: Pass[] = desc.createPasses({ width: 1280, height: 720 });
		expect(passes).toHaveLength(1);
		expect(passes[0]).toBeInstanceOf(BokehGlowPass);
		for (const pass of passes) {
			if (pass instanceof BokehGlowPass) pass.dispose();
		}
	});

	test("applyParams clamps to 0..1 slider range and updates in place", () => {
		registerBuiltinPostEffects();
		const desc = getEffectDescriptor("bokehGlow");
		if (!desc) throw new Error("bokehGlow descriptor missing");
		const pass = new BokehGlowPass(new THREE.Vector2(640, 360));
		desc.applyParams?.([pass], {
			size: 2,
			number: -1,
			intensity: 0.9,
			filter: 5,
			timeIntensity: -0.5,
		});
		expect(pass.size).toBe(1);
		expect(pass.number).toBe(0);
		expect(pass.intensity).toBe(0.9);
		expect(pass.filter).toBe(1);
		expect(pass.timeIntensity).toBe(0);
		pass.dispose();
	});

	test("sizing follows setSize without GL context", () => {
		const pass = new BokehGlowPass(new THREE.Vector2(1000, 400));
		pass.setSize(2000, 800);
		expect(pass.size).toBe(1.0);
		expect(pass.number).toBe(0.1);
		pass.dispose();
	});

	// The pack runs GLES2 in gamma space; our composer feeds linear HalfFloat.
	// Stage 1 must encode per-sample and the output stage must decode, or
	// pow(c,9) collapses midtone weights and the bokeh turns sparse/chunky.
	test("shaders convert linear↔sRGB at chain boundaries", () => {
		const gaussian = BokehGlowShaderSources.gaussian.fragmentShader;
		expect(gaussian).toContain("linearToSRGB");
		expect(gaussian).toContain("sampleSRGB( vUv )");
		expect(BokehGlowShaderSources.output.fragmentShader).toContain(
			"sRGBToLinear",
		);
		// Vert/bokeh stages run verbatim in gamma space — no conversion there.
		expect(BokehGlowShaderSources.vert.fragmentShader).not.toContain(
			"linearToSRGB",
		);
	});
});
