import { describe, expect, test } from "bun:test";
import { ShaderLib } from "three";
import { injectChromaKeyShader } from "@/services/renderer/compositor/chroma-key-material";
import { injectMaskInvertShader } from "@/services/renderer/compositor/mask-invert-material";

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

describe("injectMaskInvertShader", () => {
	test("replaces alphamap with rust-style 1-mask mix", () => {
		const result = injectMaskInvertShader({ fragmentShader: FRAGMENT });

		expect(result).toContain("uniform float uMaskInverted;");
		expect(result).toContain("1.0 - maskCoverage");
		expect(result).toContain("uMaskInverted");
		expect(result).not.toContain("#include <alphamap_fragment>");
	});

	test("still works after chroma appends after alphamap (install order)", () => {
		const withChroma = injectChromaKeyShader({ fragmentShader: FRAGMENT });
		expect(withChroma).toContain("#include <alphamap_fragment>");

		const result = injectMaskInvertShader({ fragmentShader: withChroma });
		expect(result).not.toContain("#include <alphamap_fragment>");
		expect(result).toContain("1.0 - maskCoverage");
		// Chroma body must remain after the inverted alphamap.
		const invertIndex = result.indexOf("uMaskInverted");
		const keyerIndex = result.indexOf("uChromaEnabled > 0.5");
		expect(keyerIndex).toBeGreaterThan(invertIndex);
	});

	test("injects into three's real MeshBasicMaterial fragment shader", () => {
		const real = ShaderLib.basic.fragmentShader;
		expect(real).toContain("#include <alphamap_fragment>");
		const result = injectMaskInvertShader({ fragmentShader: real });
		expect(result).toContain("1.0 - maskCoverage");
		expect(result).not.toContain("#include <alphamap_fragment>");
	});
});
