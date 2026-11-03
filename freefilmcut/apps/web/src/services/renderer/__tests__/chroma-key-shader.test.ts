import { describe, expect, test } from "bun:test";
import { ShaderLib } from "three";
import {
	CHROMA_KEY_RANGES,
	injectChromaKeyShader,
	resolveChromaKeyUniformValues,
} from "@/services/renderer/compositor/chroma-key-material";
import {
	type ChromaKeySettings,
	DEFAULT_CHROMA_KEY_EDGE_CLEANUP,
	DEFAULT_CHROMA_KEY_FEATHER,
	DEFAULT_CHROMA_KEY_INTENSITY,
	DEFAULT_CHROMA_KEY_SOFTEN,
} from "@/chroma-key";

/**
 * The real shader comes from three, so these use a stand-in with the same
 * anchors. `injectChromaKeyShader` logs (rather than throwing) when three's
 * layout changes, which is what the "no anchors" case pins down.
 */
const FRAGMENT = `
#include <common>

uniform float opacity;
varying vec2 vMapUv;

void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <map_fragment>
	#include <alphamap_fragment>
	#include <alphatest_fragment>
	gl_FragColor = vec4( diffuseColor.rgb, diffuseColor.a );
}
`;

function settings({
	intensity = DEFAULT_CHROMA_KEY_INTENSITY,
	feather = DEFAULT_CHROMA_KEY_FEATHER,
	soften = DEFAULT_CHROMA_KEY_SOFTEN,
	shadow = 0,
	edgeCleanup = DEFAULT_CHROMA_KEY_EDGE_CLEANUP,
}: Partial<ChromaKeySettings> = {}): ChromaKeySettings {
	return {
		enabled: true,
		keyColor: [0, 1, 0],
		intensity,
		feather,
		soften,
		shadow,
		edgeCleanup,
	};
}

describe("injectChromaKeyShader", () => {
	test("declares the uniforms and splices the keyer after the alphamap", () => {
		const result = injectChromaKeyShader({ fragmentShader: FRAGMENT });

		expect(result).toContain("uniform float uChromaEnabled;");
		expect(result).toContain("uniform vec3 uChromaKeyColor;");
		expect(result).toContain("uniform float uChromaSoften;");
		expect(result).toContain("diffuseColor.a *= keyAlpha;");

		// Body must land after alphaMap so the keyer multiplies mask × opacity.
		const alphaMapIndex = result.indexOf("#include <alphamap_fragment>");
		const keyerIndex = result.indexOf("uChromaEnabled > 0.5");
		const alphaTestIndex = result.indexOf("#include <alphatest_fragment>");

		expect(alphaMapIndex).toBeGreaterThan(-1);
		expect(keyerIndex).toBeGreaterThan(alphaMapIndex);
		expect(keyerIndex).toBeLessThan(alphaTestIndex);
	});

	test("injects into three's real MeshBasicMaterial fragment shader", () => {
		const real = ShaderLib.basic.fragmentShader;
		const result = injectChromaKeyShader({ fragmentShader: real });

		// Guards against a three upgrade moving the anchors: if this fails, the
		// keyer silently stops applying at runtime unless the anchors are updated.
		expect(real).toContain("#include <common>");
		expect(real).toContain("#include <alphamap_fragment>");
		expect(result).toContain("uniform vec3 uChromaKeyColor;");
		expect(result.indexOf("uChromaEnabled > 0.5")).toBeGreaterThan(
			result.indexOf("#include <alphamap_fragment>"),
		);
	});

	test("keeps the keyer out of the vertex stage's include", () => {
		const result = injectChromaKeyShader({ fragmentShader: FRAGMENT });
		// Exactly one declaration block, not one per include occurrence.
		expect(result.split("uniform float uChromaEnabled;")).toHaveLength(2);
	});

	test("falls back to the map include when alphaMap is absent", () => {
		const result = injectChromaKeyShader({
			fragmentShader: FRAGMENT.replace("#include <alphamap_fragment>", ""),
		});
		const mapIndex = result.indexOf("#include <map_fragment>");
		expect(result.indexOf("uChromaEnabled > 0.5")).toBeGreaterThan(mapIndex);
	});

	test("leaves the shader untouched when three's layout changes", () => {
		const stripped = "void main() { gl_FragColor = vec4( 1.0 ); }";
		expect(injectChromaKeyShader({ fragmentShader: stripped })).toBe(stripped);
	});

	test("guards the matte blur with USE_MAP so a map-less layer still compiles", () => {
		const result = injectChromaKeyShader({ fragmentShader: FRAGMENT });
		const softenBranch = result.indexOf("uChromaSoften > 0.01");
		const useMap = result.indexOf("#ifdef USE_MAP", softenBranch);

		expect(softenBranch).toBeGreaterThan(-1);
		expect(useMap).toBeGreaterThan(softenBranch);
		// Every neighbour sample lives inside the guarded region.
		expect(result.slice(softenBranch, useMap)).not.toContain("texture2D");
	});

	test("declares the matte sampler at file scope, after map_pars and before main", () => {
		const result = injectChromaKeyShader({ fragmentShader: FRAGMENT });
		const helper = result.indexOf("vec3 chromaSampleSrgb(vec2 uv)");
		const main = result.search(/void\s+main\s*\(\s*\)\s*\{/);

		// `map` does not exist until `#include <map_pars_fragment>`, which three
		// places after `#include <common>`, and a function cannot be defined
		// inside main(). Either mistake is a compile error, and a shader that
		// fails to compile draws nothing at all.
		expect(helper).toBeGreaterThan(-1);
		expect(helper).toBeLessThan(main);
		expect(result.slice(0, helper)).not.toContain(
			"vec3 chromaSampleSrgb(vec2 uv)",
		);
		// The sampler only exists when `map` does.
		const guard = result.lastIndexOf("#ifdef USE_MAP", helper);
		expect(guard).toBeGreaterThan(-1);
		expect(result.slice(guard, helper)).not.toContain("#endif");
	});
});

describe("resolveChromaKeyUniformValues", () => {
	test("maps the default sliders onto a ramp wide enough to see", () => {
		const values = resolveChromaKeyUniformValues({ chromaKey: settings() });

		// A colour ramp thinner than this is a one-pixel cut, which is the
		// "边缘太硬" report this mapping exists to fix.
		expect(values.smoothness).toBeGreaterThanOrEqual(0.05);
		expect(values.similarity).toBeGreaterThanOrEqual(0.35);
		expect(values.soften).toBeGreaterThan(0);
	});

	test("spans the exported ranges end to end", () => {
		expect(
			resolveChromaKeyUniformValues({ chromaKey: settings({ intensity: 0 }) })
				.similarity,
		).toBe(CHROMA_KEY_RANGES.similarity.min);
		expect(
			resolveChromaKeyUniformValues({ chromaKey: settings({ intensity: 100 }) })
				.similarity,
		).toBe(CHROMA_KEY_RANGES.similarity.max);
		expect(
			resolveChromaKeyUniformValues({ chromaKey: settings({ feather: 0 }) })
				.smoothness,
		).toBe(CHROMA_KEY_RANGES.smoothness.min);
		expect(
			resolveChromaKeyUniformValues({ chromaKey: settings({ feather: 100 }) })
				.smoothness,
		).toBe(CHROMA_KEY_RANGES.smoothness.max);
		expect(
			resolveChromaKeyUniformValues({ chromaKey: settings({ soften: 100 }) })
				.soften,
		).toBe(CHROMA_KEY_RANGES.soften.max);
	});

	test("each softness slider drives its own uniform and leaves the others", () => {
		const base = resolveChromaKeyUniformValues({ chromaKey: settings() });

		const highFeather = resolveChromaKeyUniformValues({
			chromaKey: settings({ feather: 90 }),
		});
		expect(highFeather.smoothness).toBeGreaterThan(base.smoothness);
		expect(highFeather.similarity).toBe(base.similarity);
		expect(highFeather.soften).toBe(base.soften);

		const highSoften = resolveChromaKeyUniformValues({
			chromaKey: settings({ soften: 90 }),
		});
		expect(highSoften.soften).toBeGreaterThan(base.soften);
		expect(highSoften.similarity).toBe(base.similarity);
		expect(highSoften.smoothness).toBe(base.smoothness);

		const highIntensity = resolveChromaKeyUniformValues({
			chromaKey: settings({ intensity: 90 }),
		});
		expect(highIntensity.similarity).toBeGreaterThan(base.similarity);
		expect(highIntensity.smoothness).toBe(base.smoothness);
		expect(highIntensity.soften).toBe(base.soften);
	});

	test("clamps instead of trusting the project file", () => {
		const values = resolveChromaKeyUniformValues({
			chromaKey: settings({ intensity: 400, feather: -50, soften: 400 }),
		});
		expect(values.similarity).toBe(CHROMA_KEY_RANGES.similarity.max);
		expect(values.smoothness).toBe(CHROMA_KEY_RANGES.smoothness.min);
		expect(values.soften).toBe(CHROMA_KEY_RANGES.soften.max);
	});
});
