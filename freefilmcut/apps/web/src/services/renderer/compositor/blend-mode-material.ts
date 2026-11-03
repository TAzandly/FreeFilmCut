import * as THREE from "three";
import type { BlendMode } from "@/rendering";

/**
 * Blend modes as a *material patch* with a backdrop sample, not as fixed
 * function GL blending.
 *
 * Why not three's built-in `MultiplyBlending` / `AdditiveBlending` / etc.: the
 * GL fixed pipeline can only express `dst·f(src, dst)` with per-factor
 * equations, which covers roughly multiply / screen / plus-lighter / min / max.
 * Overlay, soft-light, color-dodge/burn, difference, exclusion and the four
 * HSL modes (hue / saturation / color / luminosity) need to *read* the backdrop
 * per pixel — impossible without a backdrop texture — and even the expressible
 * ones misbehave on semi-transparent edges because the fixed factors ignore
 * backdrop alpha.
 *
 * The compositor already draws one layer at a time onto `accumRT`
 * (`compositeOneLayer`), and `snapshotBelowSource()` copies that target —
 * so at the moment a blended layer is about to draw, the backdrop is exactly
 * "everything below this layer". We snapshot it, hand it to the layer's own
 * fragment shader, evaluate the CSS `mix-blend-mode` formulas there and write
 * the finished composite with blending disabled. One snapshot blit per blended
 * layer per frame; un-blended layers pay nothing.
 *
 * Colour space: `accumRT` stores colourspace-encoded (sRGB) values and layer
 * `map` texels arrive linear, so the shader converts the layer colour to sRGB,
 * blends in sRGB (the space the CSS spec and every reference implementation
 * use), converts back, and lets three's `colorspace_fragment` re-encode on
 * output. `#include <opaque_fragment>` is the injection point: `gl_FragColor`
 * there already carries map × tint × opacity × mask × chroma-key alpha, which
 * is exactly the source the blend should see.
 */

/** Dispatch indices shared between the GLSL if-chain and the CPU side. */
export const BLEND_MODE_SHADER_INDEX: Record<BlendMode, number> = {
	normal: 0,
	darken: 1,
	multiply: 2,
	"color-burn": 3,
	lighten: 4,
	screen: 5,
	"plus-lighter": 6,
	"color-dodge": 7,
	overlay: 8,
	"soft-light": 9,
	"hard-light": 10,
	difference: 11,
	exclusion: 12,
	hue: 13,
	saturation: 14,
	color: 15,
	luminosity: 16,
};

export type BlendModeUniforms = {
	uBlendEnabled: { value: number };
	uBlendMode: { value: number };
	uBlendBackdrop: { value: THREE.Texture | null };
	uBlendTexel: { value: THREE.Vector2 };
};

const UNIFORM_DECLARATIONS = /* glsl */ `
uniform float uBlendEnabled;
uniform int uBlendMode;
uniform sampler2D uBlendBackdrop;
uniform vec2 uBlendTexel;

vec3 blendToSrgb(vec3 c) {
	vec3 low = c * 12.92;
	vec3 high = 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666667)) - 0.055;
	return mix(low, high, step(vec3(0.0031308), c));
}

vec3 blendToLinear(vec3 c) {
	vec3 low = c / 12.92;
	vec3 high = pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4));
	return mix(low, high, step(vec3(0.04045), c));
}

float blendLum(vec3 c) {
	return dot(c, vec3(0.3, 0.59, 0.11));
}

float blendSat(vec3 c) {
	return max(max(c.r, c.g), c.b) - min(min(c.r, c.g), c.b);
}

vec3 blendClipColor(vec3 c) {
	float l = blendLum(c);
	float n = min(min(c.r, c.g), c.b);
	float x = max(max(c.r, c.g), c.b);
	if (n < 0.0) c = l + (c - l) * l / max(l - n, 1e-5);
	if (x > 1.0) c = l + (c - l) * (1.0 - l) / max(x - l, 1e-5);
	return c;
}

vec3 blendSetLum(vec3 c, float l) {
	return blendClipColor(c + (l - blendLum(c)));
}

// W3C setSat: sort the channels, give the smallest 0, the largest s and scale
// the middle between them, then put the values back on their channels. Ties
// (two channels sharing the max or the min) resolve to the W3C order too.
vec3 blendSetSat(vec3 c, float s) {
	float mn = min(min(c.r, c.g), c.b);
	float mx = max(max(c.r, c.g), c.b);
	float mid = c.r + c.g + c.b - mn - mx;
	float newMid = (mid - mn) * s / max(mx - mn, 1e-5);
	vec3 isMax = step(vec3(mx - 1e-5), c);
	vec3 isMin = step(c, vec3(mn + 1e-5));
	vec3 result = vec3(newMid);
	result = mix(result, vec3(s), isMax);
	result = mix(result, vec3(0.0), isMin * (1.0 - isMax));
	return result;
}

vec3 blendColorBurn(vec3 Cs, vec3 Cb) {
	return vec3(1.0) - min(vec3(1.0), (vec3(1.0) - Cb) / max(Cs, vec3(1e-4)));
}

vec3 blendColorDodge(vec3 Cs, vec3 Cb) {
	return min(vec3(1.0), Cb / max(vec3(1.0) - Cs, vec3(1e-4)));
}

// HardLight(a, b): a decides multiply vs screen, b is the operand. The CSS
// spec derives overlay as HardLight(Cs, Cb) and hard-light as
// HardLight(Cb, Cs), so both come from this one function.
vec3 blendHardLight(vec3 a, vec3 b) {
	vec3 multiply = 2.0 * a * b;
	vec3 screen = vec3(1.0) - 2.0 * (1.0 - a) * (1.0 - b);
	return mix(multiply, screen, step(vec3(0.5), a));
}

vec3 blendSoftLight(vec3 Cs, vec3 Cb) {
	vec3 g = mix(
		((16.0 * Cb - 12.0) * Cb + 4.0) * Cb,
		sqrt(clamp(Cb, vec3(0.0), vec3(1.0))),
		step(vec3(0.25), Cb)
	);
	vec3 dark = Cb - (1.0 - 2.0 * Cs) * Cb * (1.0 - Cb);
	vec3 light = Cb + (2.0 * Cs - 1.0) * (g - Cb);
	return mix(dark, light, step(vec3(0.5), Cs));
}

// Indices come from BLEND_MODE_SHADER_INDEX; normal never reaches here.
vec3 blendModeApply(vec3 Cs, vec3 Cb, int mode) {
	if (mode == 1) return min(Cs, Cb);                       // darken
	if (mode == 2) return Cs * Cb;                            // multiply
	if (mode == 3) return blendColorBurn(Cs, Cb);             // color-burn
	if (mode == 4) return max(Cs, Cb);                        // lighten
	if (mode == 5) return Cs + Cb - Cs * Cb;                  // screen
	if (mode == 7) return blendColorDodge(Cs, Cb);            // color-dodge
	if (mode == 8) return blendHardLight(Cs, Cb);             // overlay
	if (mode == 9) return blendSoftLight(Cs, Cb);             // soft-light
	if (mode == 10) return blendHardLight(Cb, Cs);            // hard-light
	if (mode == 11) return abs(Cb - Cs);                      // difference
	if (mode == 12) return Cb + Cs - 2.0 * Cb * Cs;           // exclusion
	if (mode == 13)                                           // hue
		return blendSetLum(blendSetSat(Cs, blendSat(Cb)), blendLum(Cb));
	if (mode == 14)                                           // saturation
		return blendSetLum(blendSetSat(Cb, blendSat(Cs)), blendLum(Cb));
	if (mode == 15) return blendSetLum(Cs, blendLum(Cb));     // color
	if (mode == 16) return blendSetLum(Cb, blendLum(Cs));     // luminosity
	return Cs;
}
`;

const BLEND_BODY = /* glsl */ `
	if (uBlendEnabled > 0.5) {
		// The snapshot was taken right before this layer drew, so it holds
		// every layer below at full resolution. Values are sRGB-encoded.
		vec4 backdropSample = texture2D(
			uBlendBackdrop,
			clamp(gl_FragCoord.xy * uBlendTexel, vec2(0.0), vec2(1.0))
		);
		vec3 Cb = backdropSample.rgb;
		float ab = backdropSample.a;
		vec3 Cs = blendToSrgb(clamp(gl_FragColor.rgb, vec3(0.0), vec3(1.0)));
		float as = gl_FragColor.a;

		vec3 outColor;
		float outAlpha;
		if (uBlendMode == 6) {
			// plus-lighter adds *premultiplied* values (canvas2d semantics).
			float pa = min(as + ab, 1.0);
			outColor = min(Cs * as + Cb * ab, vec3(1.0)) / max(pa, 1e-4);
			outAlpha = pa;
		} else {
			// CSS compositing: Co = αs(1−αb)Cs + αs·αb·B(Cb,Cs) + (1−αs)αbCb.
			vec3 blended = blendModeApply(Cs, Cb, uBlendMode);
			outColor = as * (1.0 - ab) * Cs
				+ as * ab * blended
				+ (1.0 - as) * ab * Cb;
			outAlpha = as + ab * (1.0 - as);
		}
		// colorspace_fragment re-encodes below, so hand it linear.
		gl_FragColor.rgb = blendToLinear(clamp(outColor, vec3(0.0), vec3(1.0)));
		gl_FragColor.a = outAlpha;
	}
`;

const PROGRAM_CACHE_KEY = "fcc-layer-blend-v1";

const uniformsByMaterial = new WeakMap<THREE.Material, BlendModeUniforms>();

let didWarnMissingAnchor = false;

function warnMissingAnchorOnce(): void {
	if (didWarnMissingAnchor) return;
	didWarnMissingAnchor = true;
	console.error(
		"[blend-mode] three's MeshBasicMaterial shader layout changed; blend modes were not injected. Expected '#include <common>' and '#include <opaque_fragment>' in meshbasic_frag.",
	);
}

/**
 * Splices the blender into three's `MeshBasicMaterial` fragment shader.
 *
 * `#include <common>` carries the declarations (no `map` dependency, unlike the
 * keyer), `#include <opaque_fragment>` carries the body — at that point
 * `gl_FragColor` = `(outgoingLight, diffuseColor.a)` already includes map,
 * tint, opacity, the mask `alphaMap` and the chroma-key alpha.
 */
export function injectBlendModeShader({
	fragmentShader,
}: {
	fragmentShader: string;
}): string {
	const hasUniformAnchor = fragmentShader.includes("#include <common>");
	const bodyAnchor = fragmentShader.includes("#include <opaque_fragment>")
		? "#include <opaque_fragment>"
		: null;

	if (!hasUniformAnchor || bodyAnchor === null) {
		warnMissingAnchorOnce();
		return fragmentShader;
	}

	return fragmentShader
		.replace(
			"#include <common>",
			`#include <common>\n${UNIFORM_DECLARATIONS}`,
		)
		.replace(bodyAnchor, `${bodyAnchor}\n${BLEND_BODY}`);
}

/**
 * Installs the blender on a layer material. Runs after `installChromaKeyPatch`
 * on every pooled material, so it must *chain* the previous `onBeforeCompile`
 * and `customProgramCacheKey` instead of overwriting them.
 */
export function installBlendModePatch({
	material,
}: {
	material: THREE.MeshBasicMaterial;
}): void {
	const uniforms: BlendModeUniforms = {
		uBlendEnabled: { value: 0 },
		uBlendMode: { value: BLEND_MODE_SHADER_INDEX.normal },
		uBlendBackdrop: { value: null },
		uBlendTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
	};
	uniformsByMaterial.set(material, uniforms);

	const previousBeforeCompile = material.onBeforeCompile;
	const previousCacheKey = material.customProgramCacheKey;

	// eslint-disable-next-line opencut/prefer-object-params -- three's onBeforeCompile signature is (shader, renderer); the previous patch must be forwarded verbatim.
	material.onBeforeCompile = (shader, ...rest) => {
		previousBeforeCompile.call(material, shader, ...rest);

		shader.uniforms["uBlendEnabled"] = uniforms.uBlendEnabled;
		shader.uniforms["uBlendMode"] = uniforms.uBlendMode;
		shader.uniforms["uBlendBackdrop"] = uniforms.uBlendBackdrop;
		shader.uniforms["uBlendTexel"] = uniforms.uBlendTexel;

		shader.fragmentShader = injectBlendModeShader({
			fragmentShader: shader.fragmentShader,
		});
	};

	material.customProgramCacheKey = () =>
		`${previousCacheKey?.call(material) ?? ""}+${PROGRAM_CACHE_KEY}`;
}

/**
 * Per-layer-per-frame uniform write, allocation-free (pooled material).
 *
 * When active, the material must draw with blending **disabled**: the shader
 * computes the full Porter–Duff composite itself and every pixel it writes
 * (including transparent ones, which rewrite the backdrop unchanged) replaces
 * the backdrop. GL blending on top would apply the composite twice.
 */
export function applyBlendModeToMaterial({
	material,
	blendMode,
	backdrop,
	backdropTexel,
}: {
	material: THREE.Material;
	blendMode: BlendMode;
	backdrop: THREE.Texture | null;
	backdropTexel?: readonly [number, number] | null;
}): void {
	const uniforms = uniformsByMaterial.get(material);

	// Not a patched material (or the pool is gone): fall back to GL blending so
	// at least the expressible modes still do something rather than nothing.
	if (!uniforms) {
		material.blending =
			blendMode === "normal" ? THREE.NormalBlending : THREE.CustomBlending;
		return;
	}

	if (blendMode === "normal" || !backdrop) {
		uniforms.uBlendEnabled.value = 0;
		uniforms.uBlendBackdrop.value = null;
		material.blending = THREE.NormalBlending;
		return;
	}

	uniforms.uBlendEnabled.value = 1;
	uniforms.uBlendMode.value = BLEND_MODE_SHADER_INDEX[blendMode];
	uniforms.uBlendBackdrop.value = backdrop;
	if (
		backdropTexel &&
		Number.isFinite(backdropTexel[0]) &&
		Number.isFinite(backdropTexel[1]) &&
		backdropTexel[0] > 0 &&
		backdropTexel[1] > 0
	) {
		uniforms.uBlendTexel.value.set(backdropTexel[0], backdropTexel[1]);
	}
	material.blending = THREE.NoBlending;
}
