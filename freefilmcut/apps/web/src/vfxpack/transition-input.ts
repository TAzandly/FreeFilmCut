/**
 * FreeFilmCut: dual sampler2D uniforms for transition .vfxpack shaders.
 *
 * Prefer declaring in GLSL:
 *   uniform sampler2D uTransitionFrom;
 *   uniform sampler2D uTransitionTo;
 *
 * FROM aliases: uFrom, transitionFrom
 * TO aliases: uTo, transitionTo
 *
 * The NLE binds outgoing (A) and incoming (B) cut composites when rendering
 * a transition at a timeline cut.
 */
import * as THREE from "three";

export const TRANSITION_FROM_UNIFORM_NAMES = [
	"uTransitionFrom",
	"uFrom",
	"transitionFrom",
] as const;

export const TRANSITION_TO_UNIFORM_NAMES = [
	"uTransitionTo",
	"uTo",
	"transitionTo",
] as const;

export type TransitionFromUniformName =
	(typeof TRANSITION_FROM_UNIFORM_NAMES)[number];

export type TransitionToUniformName =
	(typeof TRANSITION_TO_UNIFORM_NAMES)[number];

/** Preferred FROM name authors should use in ShaderMaterial. */
export const TRANSITION_FROM_PREFERRED: TransitionFromUniformName =
	"uTransitionFrom";

/** Preferred TO name authors should use in ShaderMaterial. */
export const TRANSITION_TO_PREFERRED: TransitionToUniformName = "uTransitionTo";

const FROM_NAME_SET = new Set<string>(TRANSITION_FROM_UNIFORM_NAMES);
const TO_NAME_SET = new Set<string>(TRANSITION_TO_UNIFORM_NAMES);

export function isTransitionFromUniformName(name: string): boolean {
	return FROM_NAME_SET.has(name);
}

export function isTransitionToUniformName(name: string): boolean {
	return TO_NAME_SET.has(name);
}

/** Names already present on a uniforms dict (FROM), in canonical order. */
export function listTransitionFromUniforms(
	uniforms: Record<string, unknown> | null | undefined,
): TransitionFromUniformName[] {
	if (!uniforms) return [];
	return TRANSITION_FROM_UNIFORM_NAMES.filter((n) => n in uniforms);
}

/** Names already present on a uniforms dict (TO), in canonical order. */
export function listTransitionToUniforms(
	uniforms: Record<string, unknown> | null | undefined,
): TransitionToUniformName[] {
	if (!uniforms) return [];
	return TRANSITION_TO_UNIFORM_NAMES.filter((n) => n in uniforms);
}

const SAMPLER_DECL =
	/\buniform\s+sampler2D\s+(uTransitionFrom|uFrom|transitionFrom|uTransitionTo|uTo|transitionTo)\b/g;

/** Pixel size of the outgoing frame. NLE writes this each frame. */
const FROM_SIZE_UNIFORM_NAMES = ["uTransitionFromSize", "uFromSize"] as const;

/** Pixel size of the incoming frame. NLE writes this each frame. */
const TO_SIZE_UNIFORM_NAMES = ["uTransitionToSize", "uToSize"] as const;

const SIZE_DECL =
	/\buniform\s+vec2\s+(uTransitionFromSize|uFromSize|uTransitionToSize|uToSize)\b/g;

function shaderDeclaresSampler(mat: THREE.ShaderMaterial, name: string): boolean {
	const src = `${mat.vertexShader || ""}\n${mat.fragmentShader || ""}`;
	return new RegExp(`\\buniform\\s+sampler2D\\s+${name}\\b`).test(src);
}

/**
 * Create sampler slots for transition uniforms declared in GLSL.
 * Exporter omits Editor preview textures, so packed scene.json often has no
 * uTransitionFrom / uTransitionTo entries until this runs.
 */
export function ensureTransitionInputUniforms({
	uniforms,
	vertexShader,
	fragmentShader,
}: {
	uniforms: Record<string, { value: unknown }>;
	vertexShader?: string | null;
	fragmentShader?: string | null;
}): void {
	const src = `${vertexShader || ""}\n${fragmentShader || ""}`;
	const found = new Set<string>();
	SAMPLER_DECL.lastIndex = 0;
	let match: RegExpExecArray | null;
	while ((match = SAMPLER_DECL.exec(src)) !== null) {
		found.add(match[1]);
	}
	for (const name of found) {
		if (!uniforms[name]) uniforms[name] = { value: null };
	}
	SIZE_DECL.lastIndex = 0;
	while ((match = SIZE_DECL.exec(src)) !== null) {
		if (!uniforms[match[1]]) {
			uniforms[match[1]] = { value: new THREE.Vector2(1, 1) };
		}
	}
}

function texturePixelSize(texture: THREE.Texture): { w: number; h: number } {
	const image = texture.image as { width?: number; height?: number } | undefined;
	const w = Number(image?.width) || 1;
	const h = Number(image?.height) || 1;
	return { w, h };
}

function shaderDeclaresUniform(mat: THREE.ShaderMaterial, name: string): boolean {
	const src = `${mat.vertexShader || ""}\n${mat.fragmentShader || ""}`;
	return new RegExp(`\\buniform\\s+\\w+\\s+${name}\\b`).test(src);
}

function writeTextureSize(
	shader: THREE.ShaderMaterial,
	names: readonly string[],
	texture: THREE.Texture,
): boolean {
	const { w, h } = texturePixelSize(texture);
	let touched = false;
	for (const name of names) {
		if (!shader.uniforms[name] && !shaderDeclaresUniform(shader, name)) continue;
		if (!shader.uniforms[name]) {
			shader.uniforms[name] = { value: new THREE.Vector2(w, h) };
		} else if (shader.uniforms[name].value?.isVector2) {
			shader.uniforms[name].value.set(w, h);
		} else {
			shader.uniforms[name].value = new THREE.Vector2(w, h);
		}
		touched = true;
	}
	return touched;
}

function applyTransitionTexturesToMaterial(
	mat: THREE.Material | null | undefined,
	texFrom: THREE.Texture,
	texTo: THREE.Texture,
): void {
	const shader = mat as THREE.ShaderMaterial;
	if (!shader?.isShaderMaterial || !shader.uniforms) return;

	let touched = false;

	for (const name of TRANSITION_FROM_UNIFORM_NAMES) {
		const declared =
			!!shader.uniforms[name] || shaderDeclaresSampler(shader, name);
		if (!declared) continue;
		if (!shader.uniforms[name]) shader.uniforms[name] = { value: null };
		shader.uniforms[name].value = texFrom;
		touched = true;
	}

	for (const name of TRANSITION_TO_UNIFORM_NAMES) {
		const declared =
			!!shader.uniforms[name] || shaderDeclaresSampler(shader, name);
		if (!declared) continue;
		if (!shader.uniforms[name]) shader.uniforms[name] = { value: null };
		shader.uniforms[name].value = texTo;
		touched = true;
	}

	if (writeTextureSize(shader, FROM_SIZE_UNIFORM_NAMES, texFrom)) touched = true;
	if (writeTextureSize(shader, TO_SIZE_UNIFORM_NAMES, texTo)) touched = true;

	if (touched) {
		shader.uniformsNeedUpdate = true;
	}
}

/**
 * Bind cut A/B composites into every transition input sampler on pack materials.
 * Traverses mesh materials on `root` and every entry in `materialsByUuid`.
 */
export function bindTransitionInputTextures({
	root,
	materialsByUuid,
	texFrom,
	texTo,
}: {
	root: THREE.Object3D;
	materialsByUuid?: Map<string, THREE.Material> | null;
	texFrom: THREE.Texture;
	texTo: THREE.Texture;
}): void {
	const visitMaterial = (mat: THREE.Material | null | undefined) => {
		applyTransitionTexturesToMaterial(mat, texFrom, texTo);
	};

	root.traverse((obj) => {
		const mesh = obj as THREE.Mesh;
		if (!mesh.isMesh) return;
		const materials = Array.isArray(mesh.material)
			? mesh.material
			: [mesh.material];
		for (const mat of materials) visitMaterial(mat);
	});

	if (materialsByUuid) {
		for (const mat of materialsByUuid.values()) {
			visitMaterial(mat);
		}
	}
}
