import { describe, expect, test } from "bun:test";
import { ShaderLib } from "three";
import {
	BLEND_MODE_SHADER_INDEX,
	injectBlendModeShader,
} from "@/services/renderer/compositor/blend-mode-material";

/**
 * Stand-in with the same anchors as three's `meshbasic_frag`. The blend body
 * lands after `#include <opaque_fragment`, i.e. on `gl_FragColor`, which by
 * then carries map × tint × opacity × mask × chroma-key alpha.
 */
const FRAGMENT = `
#include <common>
uniform float opacity;
void main() {
	vec4 diffuseColor = vec4( diffuse, opacity );
	#include <map_fragment>
	#include <opaque_fragment>
	#include <colorspace_fragment>
}
`;

const MODE_ENTRIES = Object.entries(BLEND_MODE_SHADER_INDEX);

describe("injectBlendModeShader", () => {
	test("declares the uniforms and splices the body after opaque_fragment", () => {
		const result = injectBlendModeShader({ fragmentShader: FRAGMENT });

		expect(result).toContain("uniform float uBlendEnabled;");
		expect(result).toContain("uniform int uBlendMode;");
		expect(result).toContain("uniform sampler2D uBlendBackdrop;");
		expect(result).toContain("uniform vec2 uBlendTexel;");

		const opaqueIndex = result.indexOf("#include <opaque_fragment>");
		const bodyIndex = result.indexOf("uBlendEnabled > 0.5");
		const colorSpaceIndex = result.indexOf("#include <colorspace_fragment>");

		expect(opaqueIndex).toBeGreaterThan(-1);
		// The body must run before colourspace encoding: it hands three linear
		// values and lets `colorspace_fragment` do the single encode.
		expect(bodyIndex).toBeGreaterThan(opaqueIndex);
		expect(bodyIndex).toBeLessThan(colorSpaceIndex);
	});

	test("injects into three's real MeshBasicMaterial fragment shader", () => {
		const real = ShaderLib.basic.fragmentShader;
		const result = injectBlendModeShader({ fragmentShader: real });

		// Three-upgrade guard: anchors moved → blend modes silently stop working.
		expect(real).toContain("#include <common>");
		expect(real).toContain("#include <opaque_fragment>");
		expect(result).toContain("uniform int uBlendMode;");
		expect(result.indexOf("uBlendEnabled > 0.5")).toBeGreaterThan(
			result.indexOf("#include <opaque_fragment>"),
		);
	});

	test("dispatches every BlendMode value with its own GLSL branch", () => {
		const result = injectBlendModeShader({ fragmentShader: FRAGMENT });

		for (const [, index] of MODE_ENTRIES) {
			if (index === 0) {
				// normal never needs a branch — the uniform write path skips it.
				continue;
			}
			if (index === 6) {
				// plus-lighter is special-cased in the body (premultiplied add),
				// not in the blendModeApply dispatch — covered by its own test.
				expect(result).toContain("uBlendMode == 6");
				continue;
			}
			expect(result).toContain(`mode == ${index}`);
		}
		// Indices must stay unique: a collision would alias one mode onto another.
		const indices = MODE_ENTRIES.map(([, index]) => index);
		expect(new Set(indices).size).toBe(indices.length);
	});

	test("special-cases plus-lighter as a premultiplied add", () => {
		const result = injectBlendModeShader({ fragmentShader: FRAGMENT });
		const plusLighterIndex = result.indexOf("uBlendMode == 6");
		const bodyIndex = result.indexOf("uBlendEnabled > 0.5");

		expect(plusLighterIndex).toBeGreaterThan(bodyIndex);
		// The CSS plus-lighter formula adds premultiplied colours, not straight.
		expect(result.slice(bodyIndex)).toContain("min(Cs * as + Cb * ab, vec3(1.0))");
	});

	test("leaves the shader untouched when three's layout changes", () => {
		const stripped = "void main() { gl_FragColor = vec4( 1.0 ); }";
		expect(injectBlendModeShader({ fragmentShader: stripped })).toBe(stripped);
	});

	test("has no map dependency, so map-less layers still compile", () => {
		const result = injectBlendModeShader({ fragmentShader: FRAGMENT });
		// Unlike the keyer's sampler, nothing here may reference `map` or
		// `vMapUv`: text/colour layers draw without USE_MAP and a reference
		// would be a compile error that draws nothing at all.
		const declarations = result.indexOf("uniform vec2 uBlendTexel;");
		const nextInclude = result.indexOf("#include", declarations);
		expect(result.slice(declarations, nextInclude)).not.toContain("map");
	});
});
