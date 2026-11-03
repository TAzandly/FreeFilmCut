import * as THREE from "three";
import type { ChromaKeySettings } from "@/chroma-key";

/**
 * Chroma key as a *material patch*, not as an extra render pass.
 *
 * The alternative — keying into an intermediate canvas and re-uploading it as a
 * texture — costs a full-resolution fill plus a texture upload per keyed clip
 * per frame. Patching the layer's own fragment shader costs a branch and a
 * handful of ALU ops on pixels that were already being shaded, and it composes
 * with `opacity` and the mask's `alphaMap` in the right order for free (both are
 * folded into `diffuseColor.a` before the injection point).
 *
 * Colour space: layer textures are tagged `SRGBColorSpace`, so the GPU hands the
 * shader **linear** values. The match itself is done in sRGB because that is the
 * space the eyedropper reads from the preview — comparing in linear squashes
 * the dark end of the ramp and makes one slider value key differently on dark
 * vs bright footage. `uChromaKeyColor` therefore carries raw sRGB 0..1 and is
 * uploaded as a Vector3 to bypass three's automatic colour management.
 *
 * The matcher follows the classic two-knob keyer (similarity / smoothness /
 * spill), i.e. `distance` in the BT.601 chroma plane and a `pow(…, 1.5)` ramp.
 * Two things this replaces were measurably wrong:
 *
 *  - The old ramp width bottomed out at 0.002 of a *hue-normalised* distance,
 *    so every edge was a one-pixel cut with a green fringe and 边缘羽化 had
 *    almost nothing to scale.
 *  - The old distance divided out luma, which made a green screen with a cool
 *    or warm cast sit ~0.3 away from the default key colour. With 强度 at its
 *    default that was outside the radius, so switching the keyer on did
 *    nothing until the eyedropper picked the screen's actual colour.
 *
 * 边缘柔化 is the part colour distance cannot give you: a colour ramp only
 * feathers pixels whose colour is *intermediate*, and a clean green screen has
 * barely any of those, so the matte stays geometrically hard. Soften therefore
 * box-blurs the coverage mask in **texel space**, which is what actually moves
 * the edge.
 */

export type ChromaKeyUniforms = {
	uChromaEnabled: { value: number };
	uChromaKeyColor: { value: THREE.Vector3 };
	uChromaSimilarity: { value: number };
	uChromaSmoothness: { value: number };
	uChromaSoften: { value: number };
	uChromaSpill: { value: number };
	uChromaShadow: { value: number };
	uChromaTexel: { value: THREE.Vector2 };
};

/**
 * Slider (0..100) → shader units. Exported so the ranges can be asserted in a
 * unit test instead of being buried in GLSL literals.
 *
 * The smoothness ceiling is 0.3, not 1.0: a measured green-screen pixel sits
 * ~0.29 from the default key colour and skin sits ~0.57, so a 0.5-wide ramp
 * reaches the subject and turns it semi-transparent (alpha 49/255 at 羽化 100 in
 * the headless probe). 0.3 keeps a useful range without a trap at the top end;
 * the knob that actually softens the edge is 边缘柔化, which is spatial.
 */
export const CHROMA_KEY_RANGES = {
	/** CbCr distance treated as pure background. Green→magenta spans ≈0.9. */
	similarity: { min: 0, max: 0.9 },
	/** Width of the alpha ramp above the radius, in the same units. */
	smoothness: { min: 0.004, max: 0.3 },
	/** Matte blur radius, in source texels. */
	soften: { min: 0, max: 10 },
} as const;

export type ChromaKeyUniformValues = {
	similarity: number;
	smoothness: number;
	soften: number;
	spill: number;
	shadow: number;
};

function percentToRange({
	percent,
	range,
}: {
	percent: number;
	range: { min: number; max: number };
}): number {
	const unit = Math.min(100, Math.max(0, percent)) / 100;
	return range.min + unit * (range.max - range.min);
}

export function resolveChromaKeyUniformValues({
	chromaKey,
}: {
	chromaKey: ChromaKeySettings;
}): ChromaKeyUniformValues {
	return {
		similarity: percentToRange({
			percent: chromaKey.intensity,
			range: CHROMA_KEY_RANGES.similarity,
		}),
		smoothness: percentToRange({
			percent: chromaKey.feather,
			range: CHROMA_KEY_RANGES.smoothness,
		}),
		soften: percentToRange({
			percent: chromaKey.soften,
			range: CHROMA_KEY_RANGES.soften,
		}),
		spill: Math.min(1, Math.max(0, chromaKey.edgeCleanup / 100)),
		shadow: Math.min(1, Math.max(0, chromaKey.shadow / 100)),
	};
}

const UNIFORM_DECLARATIONS = /* glsl */ `
uniform float uChromaEnabled;
uniform vec3 uChromaKeyColor;
uniform float uChromaSimilarity;
uniform float uChromaSmoothness;
uniform float uChromaSoften;
uniform float uChromaSpill;
uniform float uChromaShadow;
uniform vec2 uChromaTexel;

vec3 chromaToSrgb(vec3 c) {
	vec3 low = c * 12.92;
	vec3 high = 1.055 * pow(max(c, vec3(0.0)), vec3(0.41666667)) - 0.055;
	return mix(low, high, step(vec3(0.0031308), c));
}

vec3 chromaToLinear(vec3 c) {
	vec3 low = c / 12.92;
	vec3 high = pow(max((c + 0.055) / 1.055, vec3(0.0)), vec3(2.4));
	return mix(low, high, step(vec3(0.04045), c));
}

// BT.601 chroma plane, biased to 0..1. This is the space the reference keyer
// measures in: hue and saturation move, brightness barely does, so one 强度
// works on a bright screen and on its shadowed side.
vec2 chromaUv(vec3 srgb) {
	return vec2(
		srgb.r * -0.169 + srgb.g * -0.331 + srgb.b * 0.5 + 0.5,
		srgb.r * 0.5 + srgb.g * -0.419 + srgb.b * -0.081 + 0.5
	);
}

// 0 = pure background, 1 = keep. The 1.5 exponent keeps the ramp from looking
// linear (and therefore grey/foggy) in the semi-transparent band.
float chromaRamp(float chromaDistance) {
	float aboveThreshold = chromaDistance - uChromaSimilarity;
	return pow(clamp(aboveThreshold / max(uChromaSmoothness, 0.0001), 0.0, 1.0), 1.5);
}
`;

/**
 * Declared at file scope, right before `main()`.
 *
 * It reads the `map` sampler, and `map` only exists after
 * `#include <map_pars_fragment>` — which sits *below* `#include <common>` in
 * three's `meshbasic_frag`. Putting this helper in the uniform block therefore
 * fails to compile with "'map' : undeclared identifier", and a failed program
 * draws nothing at all: the clip disappears instead of keying. (`#include
 * <alphamap_fragment>` is below `map_pars_fragment`, but a function definition
 * cannot live inside `main()`.)
 */
const SAMPLER_HELPERS = /* glsl */ `
#ifdef USE_MAP
vec3 chromaSampleSrgb(vec2 uv) {
	vec4 sampled = texture2D(map, clamp(uv, 0.0, 1.0));
	#ifdef DECODE_VIDEO_TEXTURE
	sampled.rgb = mix(
		pow(sampled.rgb * 0.9478672986 + vec3(0.0521327014), vec3(2.4)),
		sampled.rgb * 0.0773993808,
		vec3(lessThanEqual(sampled.rgb, vec3(0.04045)))
	);
	#endif
	return chromaToSrgb(clamp(sampled.rgb, 0.0, 1.0));
}
#endif
`;

const KEYER_BODY = /* glsl */ `
	if (uChromaEnabled > 0.5) {
		vec3 centerSrgb = chromaToSrgb(clamp(diffuseColor.rgb, 0.0, 1.0));
		vec2 keyUv = chromaUv(uChromaKeyColor);
		float centerDistance = distance(chromaUv(centerSrgb), keyUv);
		float keyAlpha = chromaRamp(centerDistance);

		// 边缘柔化 — a 3x3 Gaussian-ish blur of the *matte*, in texel space.
		// Colour distance cannot soften a clean green-screen edge because only
		// a pixel or two are ever intermediate; averaging the coverage over a
		// small neighbourhood is what actually moves the edge. Weights 4/2/1
		// (not a flat 1/9 box) matter: on an axis-aligned edge a box gives 3
		// possible alphas per side, the weighted kernel gives 5, and the ramp
		// stops looking stepped. Uniform branch, so keyers and layers that do
		// not need it pay nothing.
		if (uChromaSoften > 0.01) {
			#ifdef USE_MAP
			vec2 texelStep = uChromaTexel * uChromaSoften;
			float accumulated = keyAlpha * 4.0;
			accumulated += 2.0 * chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv + vec2(texelStep.x, 0.0))), keyUv));
			accumulated += 2.0 * chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv - vec2(texelStep.x, 0.0))), keyUv));
			accumulated += 2.0 * chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv + vec2(0.0, texelStep.y))), keyUv));
			accumulated += 2.0 * chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv - vec2(0.0, texelStep.y))), keyUv));
			accumulated += chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv + texelStep)), keyUv));
			accumulated += chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv - texelStep)), keyUv));
			accumulated += chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv + vec2(texelStep.x, -texelStep.y))), keyUv));
			accumulated += chromaRamp(distance(chromaUv(chromaSampleSrgb(vMapUv + vec2(-texelStep.x, texelStep.y))), keyUv));
			keyAlpha = accumulated / 16.0;
			#endif
		}

		// 阴影 — dark pixels stay opaque so the shadow a subject casts on the
		// screen is not eaten along with the screen.
		float luma = dot(centerSrgb, vec3(0.299, 0.587, 0.114));
		float darkness = 1.0 - smoothstep(0.0, 0.35, luma);
		keyAlpha = mix(keyAlpha, 1.0, darkness * uChromaShadow);

		diffuseColor.a *= keyAlpha;

		// 边缘清除 — pull the key hue out of pixels that are *near* the
		// threshold. The previous version keyed this off the alpha rim, which
		// meant it did nothing at all on a hard key (there was no rim): the
		// fringe that survives a hard key is opaque, so it has to be found by
		// colour, not by alpha.
		if (uChromaSpill > 0.001) {
			float spillBand = max(uChromaSpill * 0.7, 0.001);
			float keyness = 1.0 - smoothstep(
				0.0,
				spillBand,
				max(centerDistance - uChromaSimilarity, 0.0)
			);
			vec3 desaturated = vec3(luma);
			diffuseColor.rgb = chromaToLinear(
				mix(centerSrgb, desaturated, keyness)
			);
		}
	}
	/* fcc-chroma-end */
`;

const PROGRAM_CACHE_KEY = "fcc-layer-chroma-v2";

/**
 * Material → uniforms. A WeakMap instead of `material.userData`: `userData` is
 * `Record<string, any>`, so reading it back needs an unsafe assertion, and this
 * runs per layer per frame.
 */
const uniformsByMaterial = new WeakMap<THREE.Material, ChromaKeyUniforms>();

/**
 * Splices the keyer into three's `MeshBasicMaterial` fragment shader.
 *
 * Three anchors, all of which exist in `meshbasic_frag` for three 0.186:
 * `#include <common>` for the uniform declarations and the pure helpers,
 * `void main()` for the matte sampler (it needs `map`, declared further down by
 * `#include <map_pars_fragment>`), and `#include <alphamap_fragment>` for the
 * body — after that include `diffuseColor` already carries `map` × `color` and
 * `opacity` × `alphaMap`, which is exactly the surface the keyer should
 * modulate.
 *
 * If an anchor ever disappears (three upgrade), this logs once instead of
 * silently compiling a shader that references undeclared uniforms.
 */
export function injectChromaKeyShader({
	fragmentShader,
}: {
	fragmentShader: string;
}): string {
	const hasUniformAnchor = fragmentShader.includes("#include <common>");
	const alphaAnchor = fragmentShader.includes("#include <alphamap_fragment>")
		? "#include <alphamap_fragment>"
		: fragmentShader.includes("#include <map_fragment>")
			? "#include <map_fragment>"
			: null;
	const mainAnchor = /void\s+main\s*\(\s*\)\s*\{/.exec(fragmentShader);

	if (!hasUniformAnchor || alphaAnchor === null || mainAnchor === null) {
		warnMissingAnchorOnce();
		return fragmentShader;
	}

	return fragmentShader
		.replace(
			"#include <common>",
			`#include <common>\n${UNIFORM_DECLARATIONS}`,
		)
		.replace(mainAnchor[0], `${SAMPLER_HELPERS}${mainAnchor[0]}`)
		.replace(alphaAnchor, `${alphaAnchor}\n${KEYER_BODY}`);
}

let didWarnMissingAnchor = false;

function warnMissingAnchorOnce(): void {
	if (didWarnMissingAnchor) return;
	didWarnMissingAnchor = true;
	console.error(
		"[chroma-key] three's MeshBasicMaterial shader layout changed; the keyer was not injected. Expected '#include <common>' and '#include <alphamap_fragment>' in meshbasic_frag.",
	);
}

/**
 * Installs the keyer on a layer material. Every material in the layer pool goes
 * through this, so the whole pool shares one program and switching a clip's
 * keyer on/off never recompiles anything — it just flips a uniform.
 */
export function installChromaKeyPatch({
	material,
}: {
	material: THREE.MeshBasicMaterial;
}): void {
	const uniforms: ChromaKeyUniforms = {
		uChromaEnabled: { value: 0 },
		uChromaKeyColor: { value: new THREE.Vector3(0, 1, 0) },
		uChromaSimilarity: { value: 0.4 },
		uChromaSmoothness: { value: 0.08 },
		uChromaSoften: { value: 0 },
		uChromaSpill: { value: 0 },
		uChromaShadow: { value: 0 },
		uChromaTexel: { value: new THREE.Vector2(1 / 1920, 1 / 1080) },
	};
	uniformsByMaterial.set(material, uniforms);

	material.onBeforeCompile = (shader) => {
		shader.uniforms["uChromaEnabled"] = uniforms.uChromaEnabled;
		shader.uniforms["uChromaKeyColor"] = uniforms.uChromaKeyColor;
		shader.uniforms["uChromaSimilarity"] = uniforms.uChromaSimilarity;
		shader.uniforms["uChromaSmoothness"] = uniforms.uChromaSmoothness;
		shader.uniforms["uChromaSoften"] = uniforms.uChromaSoften;
		shader.uniforms["uChromaSpill"] = uniforms.uChromaSpill;
		shader.uniforms["uChromaShadow"] = uniforms.uChromaShadow;
		shader.uniforms["uChromaTexel"] = uniforms.uChromaTexel;

		shader.fragmentShader = injectChromaKeyShader({
			fragmentShader: shader.fragmentShader,
		});
	};

	/**
	 * An explicit key keeps these programs from aliasing any other
	 * MeshBasicMaterial in the app (the compositor also uses one for the final
	 * present), which would silently share a program compiled without the
	 * injected uniforms.
	 */
	material.customProgramCacheKey = () => PROGRAM_CACHE_KEY;
}

function readChromaKeyUniforms({
	material,
}: {
	material: THREE.Material;
}): ChromaKeyUniforms | null {
	return uniformsByMaterial.get(material) ?? null;
}

/**
 * Per-frame uniform write. O(1) per layer and allocation-free — the same
 * material object is reused from the pool, so nothing is created here.
 *
 * `texelSize` is 1/width, 1/height of the layer's source texture. Without it
 * the matte blur has no scale, so 边缘柔化 degrades to "off" rather than to a
 * wrong-looking blur.
 */
export function applyChromaKeyToMaterial({
	material,
	chromaKey,
	texelSize,
}: {
	material: THREE.Material;
	chromaKey: ChromaKeySettings | null | undefined;
	texelSize?: readonly [number, number] | null;
}): void {
	const uniforms = readChromaKeyUniforms({ material });
	if (!uniforms) return;

	if (!chromaKey?.enabled) {
		uniforms.uChromaEnabled.value = 0;
		return;
	}

	const values = resolveChromaKeyUniformValues({ chromaKey });

	uniforms.uChromaEnabled.value = 1;
	uniforms.uChromaKeyColor.value.set(
		chromaKey.keyColor[0],
		chromaKey.keyColor[1],
		chromaKey.keyColor[2],
	);
	uniforms.uChromaSimilarity.value = values.similarity;
	uniforms.uChromaSmoothness.value = values.smoothness;
	uniforms.uChromaSpill.value = values.spill;
	uniforms.uChromaShadow.value = values.shadow;

	const hasTexelSize =
		texelSize !== null &&
		texelSize !== undefined &&
		Number.isFinite(texelSize[0]) &&
		Number.isFinite(texelSize[1]) &&
		texelSize[0] > 0 &&
		texelSize[1] > 0;
	if (hasTexelSize) {
		uniforms.uChromaTexel.value.set(texelSize[0], texelSize[1]);
	}
	uniforms.uChromaSoften.value = hasTexelSize ? values.soften : 0;
}
