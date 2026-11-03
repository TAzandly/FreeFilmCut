import * as THREE from "three";

/**
 * Three.js `alphaMap` always multiplies by the green channel — it has no invert
 * flag. Rust's mask pass does `select(mask, 1.0 - mask, inverted)`. This patch
 * replaces `#include <alphamap_fragment>` with the same mix so invert works for
 * hard and feathered masks without baking `1-coverage` into the texture (that
 * bake path went fully black after JFA / getImageData).
 *
 * Installed last in the layer-material chain so chroma / grade / blend still see
 * the alphamap include (or its replacement site) in the order they expect.
 */

const PROGRAM_CACHE_KEY = "opencut-mask-invert-v1";

export type MaskInvertUniforms = {
	uMaskInverted: { value: number };
};

const uniformsByMaterial = new WeakMap<THREE.Material, MaskInvertUniforms>();

const UNIFORM_DECLARATIONS = /* glsl */ `uniform float uMaskInverted;`;

/** Same contract as three's alphamap_fragment, plus rust-style invert. */
const ALPHAMAP_INVERT_BODY = /* glsl */ `
#ifdef USE_ALPHAMAP
	float maskCoverage = texture2D( alphaMap, vAlphaMapUv ).g;
	diffuseColor.a *= mix( maskCoverage, 1.0 - maskCoverage, uMaskInverted );
#endif
`;

export function injectMaskInvertShader({
	fragmentShader,
}: {
	fragmentShader: string;
}): string {
	if (!fragmentShader.includes("#include <alphamap_fragment>")) {
		warnMissingAnchorOnce();
		return fragmentShader;
	}

	let next = fragmentShader;
	if (fragmentShader.includes("#include <common>")) {
		next = next.replace(
			"#include <common>",
			`#include <common>\n${UNIFORM_DECLARATIONS}`,
		);
	}

	return next.replace("#include <alphamap_fragment>", ALPHAMAP_INVERT_BODY);
}

let didWarnMissingAnchor = false;

function warnMissingAnchorOnce(): void {
	if (didWarnMissingAnchor) return;
	didWarnMissingAnchor = true;
	console.error(
		"[mask-invert] MeshBasicMaterial shader layout changed; invert was not injected. Expected '#include <alphamap_fragment>'.",
	);
}

export function installMaskInvertPatch({
	material,
}: {
	material: THREE.MeshBasicMaterial;
}): void {
	const uniforms: MaskInvertUniforms = {
		uMaskInverted: { value: 0 },
	};
	uniformsByMaterial.set(material, uniforms);

	const previousBeforeCompile = material.onBeforeCompile;
	const previousCacheKey = material.customProgramCacheKey;

	// eslint-disable-next-line opencut/prefer-object-params -- three's onBeforeCompile signature
	material.onBeforeCompile = (shader, ...rest) => {
		previousBeforeCompile.call(material, shader, ...rest);

		shader.uniforms["uMaskInverted"] = uniforms.uMaskInverted;
		shader.fragmentShader = injectMaskInvertShader({
			fragmentShader: shader.fragmentShader,
		});
	};

	material.customProgramCacheKey = () =>
		`${previousCacheKey?.call(material) ?? ""}+${PROGRAM_CACHE_KEY}`;
}

export function applyMaskInvertToMaterial({
	material,
	inverted,
}: {
	material: THREE.Material;
	inverted: boolean;
}): void {
	const uniforms = uniformsByMaterial.get(material);
	if (!uniforms) return;
	uniforms.uMaskInverted.value = inverted ? 1 : 0;
}
