import * as THREE from "three";
import type { ColorGradeSettings } from "@/color-grade";
import {
	isColorGradeCurvesIdentity,
	isColorGradeIdentity,
} from "@/color-grade";
import {
	bakeCurveLut,
	curveLutContentHash,
	LUT_SIZE,
} from "@/color-grade/curves";
import { COLOR_GRADE_SHADER_HELPERS } from "@/color-grade/shader-core";
import { packColorGradeUniforms } from "@/color-grade/uniforms";

export type ColorGradeUniforms = {
	uColorGradeEnabled: { value: number };
	uColorGradeTemp: { value: number };
	uColorGradeTint: { value: number };
	uColorGradeSat: { value: number };
	uColorGradeBright: { value: number };
	uColorGradeContrast: { value: number };
	uColorGradeExposure: { value: number };
	uColorGradeHighlights: { value: number };
	uColorGradeShadows: { value: number };
	uColorGradeHslHue: { value: number };
	uColorGradeHslSat: { value: number };
	uColorGradeHslLuma: { value: number };
	uColorGradeLut: { value: THREE.DataTexture | null };
	uColorGradeLutEnabled: { value: number };
};

/** @deprecated Prefer packColorGradeUniforms — kept for Basic-only tests. */
export type ColorGradeUniformValues = {
	temp: number;
	tint: number;
	sat: number;
	bright: number;
	contrast: number;
	exposure: number;
	highlights: number;
	shadows: number;
};

export function resolveColorGradeUniformValues({
	grade,
}: {
	grade: {
		temperature: number;
		tint: number;
		saturation: number;
		brightness: number;
		contrast: number;
		exposure: number;
		highlights: number;
		shadows: number;
	};
}): ColorGradeUniformValues {
	const unit = (v: number) => Math.min(100, Math.max(-100, v)) / 100;
	return {
		temp: unit(grade.temperature),
		tint: unit(grade.tint),
		sat: 1 + unit(grade.saturation),
		bright: unit(grade.brightness) * 0.5,
		contrast: 1 + unit(grade.contrast),
		exposure: unit(grade.exposure) * 2,
		highlights: unit(grade.highlights) * 0.5,
		shadows: unit(grade.shadows) * 0.5,
	};
}

const GRADE_BODY = /* glsl */ `
	diffuseColor.rgb = applyFccColorGrade(diffuseColor.rgb);
`;

const PROGRAM_CACHE_KEY = "fcc-layer-color-grade-v3";
const AFTER_CHROMA_MARKER = "/* fcc-chroma-end */";

const uniformsByMaterial = new WeakMap<THREE.Material, ColorGradeUniforms>();
const lutByMaterial = new WeakMap<
	THREE.Material,
	{ hash: string; texture: THREE.DataTexture }
>();

function identityLutTexture(): THREE.DataTexture {
	const data = new Uint8Array(LUT_SIZE * 4);
	for (let row = 0; row < 4; row++) {
		for (let i = 0; i < LUT_SIZE; i++) {
			data[row * LUT_SIZE + i] = Math.round((i / (LUT_SIZE - 1)) * 255);
		}
	}
	const tex = new THREE.DataTexture(
		data,
		LUT_SIZE,
		4,
		THREE.RedFormat,
		THREE.UnsignedByteType,
	);
	tex.needsUpdate = true;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.colorSpace = THREE.NoColorSpace;
	return tex;
}

export function injectColorGradeShader({
	fragmentShader,
}: {
	fragmentShader: string;
}): string {
	const hasUniformAnchor = fragmentShader.includes("#include <common>");
	if (!hasUniformAnchor) {
		warnMissingAnchorOnce();
		return fragmentShader;
	}

	const withUniforms = fragmentShader.replace(
		"#include <common>",
		`#include <common>\n${COLOR_GRADE_SHADER_HELPERS}`,
	);

	const chromaMarkerAt = withUniforms.lastIndexOf(AFTER_CHROMA_MARKER);
	if (chromaMarkerAt >= 0) {
		const afterMarker = chromaMarkerAt + AFTER_CHROMA_MARKER.length;
		return (
			withUniforms.slice(0, afterMarker) +
			`\n${GRADE_BODY}` +
			withUniforms.slice(afterMarker)
		);
	}

	const bodyAnchor = withUniforms.includes("#include <alphamap_fragment>")
		? "#include <alphamap_fragment>"
		: withUniforms.includes("#include <map_fragment>")
			? "#include <map_fragment>"
			: null;
	if (bodyAnchor === null) {
		warnMissingAnchorOnce();
		return withUniforms;
	}
	const insertAt = withUniforms.lastIndexOf(bodyAnchor);
	if (insertAt < 0) return withUniforms;
	const afterAnchor = insertAt + bodyAnchor.length;
	return (
		withUniforms.slice(0, afterAnchor) +
		`\n${GRADE_BODY}` +
		withUniforms.slice(afterAnchor)
	);
}

let didWarnMissingAnchor = false;

function warnMissingAnchorOnce(): void {
	if (didWarnMissingAnchor) return;
	didWarnMissingAnchor = true;
	console.error(
		"[color-grade] MeshBasicMaterial shader layout changed; grade was not injected.",
	);
}

export function installColorGradePatch({
	material,
}: {
	material: THREE.MeshBasicMaterial;
}): void {
	const identityLut = identityLutTexture();
	const uniforms: ColorGradeUniforms = {
		uColorGradeEnabled: { value: 0 },
		uColorGradeTemp: { value: 0 },
		uColorGradeTint: { value: 0 },
		uColorGradeSat: { value: 1 },
		uColorGradeBright: { value: 0 },
		uColorGradeContrast: { value: 1 },
		uColorGradeExposure: { value: 0 },
		uColorGradeHighlights: { value: 0 },
		uColorGradeShadows: { value: 0 },
		uColorGradeHslHue: { value: 0 },
		uColorGradeHslSat: { value: 0 },
		uColorGradeHslLuma: { value: 0 },
		uColorGradeLut: { value: identityLut },
		uColorGradeLutEnabled: { value: 0 },
	};
	uniformsByMaterial.set(material, uniforms);

	const previousBeforeCompile = material.onBeforeCompile;
	const previousCacheKey = material.customProgramCacheKey;

	// eslint-disable-next-line opencut/prefer-object-params -- three's onBeforeCompile signature
	material.onBeforeCompile = (shader, ...rest) => {
		previousBeforeCompile.call(material, shader, ...rest);

		for (const [name, slot] of Object.entries(uniforms)) {
			shader.uniforms[name] = slot;
		}

		shader.fragmentShader = injectColorGradeShader({
			fragmentShader: shader.fragmentShader,
		});
	};

	material.customProgramCacheKey = () =>
		`${previousCacheKey?.call(material) ?? ""}+${PROGRAM_CACHE_KEY}`;
}

function readColorGradeUniforms({
	material,
}: {
	material: THREE.Material;
}): ColorGradeUniforms | null {
	return uniformsByMaterial.get(material) ?? null;
}

function ensureLutTexture({
	material,
	grade,
}: {
	material: THREE.Material;
	grade: ColorGradeSettings;
}): THREE.DataTexture | null {
	const uniforms = readColorGradeUniforms({ material });
	if (!uniforms) return null;

	if (isColorGradeCurvesIdentity({ curves: grade.curves })) {
		uniforms.uColorGradeLutEnabled.value = 0;
		return uniforms.uColorGradeLut.value;
	}

	const hash = curveLutContentHash(grade.curves);
	const cached = lutByMaterial.get(material);
	if (cached && cached.hash === hash) {
		uniforms.uColorGradeLut.value = cached.texture;
		uniforms.uColorGradeLutEnabled.value = 1;
		return cached.texture;
	}

	const data = bakeCurveLut(grade.curves);
	const tex = new THREE.DataTexture(
		data,
		LUT_SIZE,
		4,
		THREE.RedFormat,
		THREE.UnsignedByteType,
	);
	tex.needsUpdate = true;
	tex.minFilter = THREE.LinearFilter;
	tex.magFilter = THREE.LinearFilter;
	tex.wrapS = THREE.ClampToEdgeWrapping;
	tex.wrapT = THREE.ClampToEdgeWrapping;
	tex.colorSpace = THREE.NoColorSpace;

	cached?.texture.dispose();
	lutByMaterial.set(material, { hash, texture: tex });
	uniforms.uColorGradeLut.value = tex;
	uniforms.uColorGradeLutEnabled.value = 1;
	return tex;
}

/** Per-frame uniform write. Identity → enabled=0. */
export function applyColorGradeToMaterial({
	material,
	colorGrade,
}: {
	material: THREE.Material;
	colorGrade: ColorGradeSettings | null | undefined;
}): void {
	const uniforms = readColorGradeUniforms({ material });
	if (!uniforms) return;

	if (!colorGrade || isColorGradeIdentity({ grade: colorGrade })) {
		uniforms.uColorGradeEnabled.value = 0;
		uniforms.uColorGradeLutEnabled.value = 0;
		return;
	}

	const values = packColorGradeUniforms({ grade: colorGrade });
	uniforms.uColorGradeEnabled.value = 1;
	uniforms.uColorGradeTemp.value = values.temp;
	uniforms.uColorGradeTint.value = values.tint;
	uniforms.uColorGradeSat.value = values.sat;
	uniforms.uColorGradeBright.value = values.bright;
	uniforms.uColorGradeContrast.value = values.contrast;
	uniforms.uColorGradeExposure.value = values.exposure;
	uniforms.uColorGradeHighlights.value = values.highlights;
	uniforms.uColorGradeShadows.value = values.shadows;
	uniforms.uColorGradeHslHue.value = values.hslHue;
	uniforms.uColorGradeHslSat.value = values.hslSat;
	uniforms.uColorGradeHslLuma.value = values.hslLuma;
	ensureLutTexture({ material, grade: colorGrade });
}
