/**
 * FreeFilmCut global screen uniforms (Unity-like).
 * Same names/semantics as Editor `GlobalScreenParams.js`.
 *
 *   uResolution      = vec2(width, height)
 *   uScreenTexelSize = vec2(1/width, 1/height)
 *   uScreenParams    = vec4(width, height, 1+1/width, 1+1/height)
 *   _ScreenParams    = same as uScreenParams
 *
 * GLSL must declare the uniforms; we only fill material.uniforms values.
 * Size = compositor / pack render resolution (not CSS).
 */
import * as THREE from "three";

export const GLOBAL_SCREEN_UNIFORM_NAMES = [
	"uResolution",
	"uScreenTexelSize",
	"uScreenParams",
	"_ScreenParams",
] as const;

export type GlobalScreenUniformName =
	(typeof GLOBAL_SCREEN_UNIFORM_NAMES)[number];

const DECL_RE =
	/\buniform\s+(?:highp\s+|mediump\s+|lowp\s+)?(?:vec2|vec4)\s+(uResolution|uScreenTexelSize|uScreenParams|_ScreenParams)\b/g;

export function detectGlobalScreenUniformsInGlsl(
	...sources: Array<string | null | undefined>
): GlobalScreenUniformName[] {
	const found = new Set<GlobalScreenUniformName>();
	for (const src of sources) {
		if (!src) continue;
		DECL_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = DECL_RE.exec(src)) !== null) {
			found.add(m[1] as GlobalScreenUniformName);
		}
	}
	return GLOBAL_SCREEN_UNIFORM_NAMES.filter((n) => found.has(n));
}

export function ensureGlobalScreenUniforms(
	material: THREE.Material,
	opts?: { forceAll?: boolean },
): GlobalScreenUniformName[] {
	const mat = material as THREE.ShaderMaterial;
	if (!mat?.isShaderMaterial && !(mat as THREE.RawShaderMaterial)?.isRawShaderMaterial) {
		return [];
	}
	if (!mat.uniforms) mat.uniforms = {};

	const forceAll = !!opts?.forceAll || !!(mat.userData && mat.userData.freecapcutGlobalScreen);
	const fromGlsl = detectGlobalScreenUniformsInGlsl(mat.vertexShader, mat.fragmentShader);
	const fromDict = GLOBAL_SCREEN_UNIFORM_NAMES.filter((n) => n in mat.uniforms);
	const names = forceAll
		? [...GLOBAL_SCREEN_UNIFORM_NAMES]
		: GLOBAL_SCREEN_UNIFORM_NAMES.filter(
				(n) => fromGlsl.includes(n) || fromDict.includes(n),
			);

	for (const name of names) {
		if (!mat.uniforms[name]) {
			if (name === "uResolution" || name === "uScreenTexelSize") {
				mat.uniforms[name] = { value: new THREE.Vector2(1, 1) };
			} else {
				mat.uniforms[name] = { value: new THREE.Vector4(1, 1, 2, 2) };
			}
		}
	}
	return names;
}

export function applyGlobalScreenParams(
	material: THREE.Material,
	width: number,
	height: number,
): boolean {
	const mat = material as THREE.ShaderMaterial;
	if (!mat) return false;
	const w = Math.max(1, Math.floor(Number(width) || 1));
	const h = Math.max(1, Math.floor(Number(height) || 1));

	const forceAll = !!(mat.userData && mat.userData.freecapcutGlobalScreen);
	ensureGlobalScreenUniforms(mat, { forceAll });
	if (!mat.uniforms) return false;

	const hasAny = GLOBAL_SCREEN_UNIFORM_NAMES.some((n) => !!mat.uniforms[n]);
	if (!hasAny) return false;

	const u = mat.uniforms;
	if (u.uResolution?.value?.isVector2) u.uResolution.value.set(w, h);
	if (u.uScreenTexelSize?.value?.isVector2) {
		u.uScreenTexelSize.value.set(1 / w, 1 / h);
	}
	const sx = 1 + 1 / w;
	const sy = 1 + 1 / h;
	if (u.uScreenParams?.value?.isVector4) {
		u.uScreenParams.value.set(w, h, sx, sy);
	}
	if (u._ScreenParams?.value?.isVector4) {
		u._ScreenParams.value.set(w, h, sx, sy);
	}
	mat.uniformsNeedUpdate = true;
	return true;
}

export function applyGlobalScreenParamsToObject3D(
	root: THREE.Object3D,
	width: number,
	height: number,
): number {
	let n = 0;
	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh && !(obj as THREE.Points).isPoints) return;
		const mats = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
		for (const mat of mats) {
			if (mat && applyGlobalScreenParams(mat, width, height)) n++;
		}
	});
	return n;
}
