/**
 * FreeFilmCut: special sampler2D uniforms that the NLE auto-binds to the
 * below-track composite texture when rendering a .vfxpack on the timeline.
 *
 * Prefer declaring in GLSL:
 *   uniform sampler2D uInput;
 *
 * Also accepted (aliases): belowInput, iChannel0
 *
 * Binding runs for pack type filter|effect|clip-anim with scope "below"
 * (the default for those types when scope is omitted from manifest).
 */

export const BELOW_INPUT_UNIFORM_NAMES = [
	"uInput",
	"belowInput",
	"iChannel0",
] as const;

export type BelowInputUniformName =
	(typeof BELOW_INPUT_UNIFORM_NAMES)[number];

/** Preferred name authors should use in ShaderMaterial. */
export const BELOW_INPUT_PREFERRED: BelowInputUniformName = "uInput";

const NAME_SET = new Set<string>(BELOW_INPUT_UNIFORM_NAMES);

export function isBelowInputUniformName(name: string): boolean {
	return NAME_SET.has(name);
}

/**
 * True when this pack should receive the below-track composite as input.
 * filter / effect / clip-anim + scope below (default for those types).
 */
export function packNeedsBelowInput({
	type,
	scope,
}: {
	type?: string | null;
	scope?: string | null;
}): boolean {
	const t = String(type || "")
		.trim()
		.toLowerCase();
	const s = String(scope || "")
		.trim()
		.toLowerCase();
	const usesBelowByType =
		t === "filter" ||
		t === "effect" ||
		t === "post-effect" ||
		t === "posteffect" ||
		t === "clip-anim" ||
		t === "clipanim" ||
		t === "clip_anim";
	if (!usesBelowByType) return false;
	// Missing scope already normalized to "below" in load-pack for these types.
	return s === "below" || s === "";
}

const DECL_RE =
	/\buniform\s+sampler2D\s+(uInput|belowInput|iChannel0)\b/g;

/** Names declared as `uniform sampler2D ...` in GLSL sources. */
export function detectBelowInputNamesInGlsl(
	...sources: Array<string | null | undefined>
): BelowInputUniformName[] {
	const found = new Set<BelowInputUniformName>();
	for (const src of sources) {
		if (!src) continue;
		DECL_RE.lastIndex = 0;
		let m: RegExpExecArray | null;
		while ((m = DECL_RE.exec(src)) !== null) {
			found.add(m[1] as BelowInputUniformName);
		}
	}
	return BELOW_INPUT_UNIFORM_NAMES.filter((n) => found.has(n));
}

/** Names already present on a uniforms dict. */
export function detectBelowInputNamesInUniforms(
	uniforms: Record<string, unknown> | null | undefined,
): BelowInputUniformName[] {
	if (!uniforms) return [];
	return BELOW_INPUT_UNIFORM_NAMES.filter((n) => n in uniforms);
}

/**
 * Ensure ShaderMaterial.uniforms entries exist for every below-input name
 * found in GLSL or already listed. Returns the union of names.
 */
export function ensureBelowInputUniforms({
	uniforms,
	vertexShader,
	fragmentShader,
}: {
	uniforms: Record<string, { value: unknown }>;
	vertexShader?: string | null;
	fragmentShader?: string | null;
}): BelowInputUniformName[] {
	const fromGlsl = detectBelowInputNamesInGlsl(vertexShader, fragmentShader);
	const fromDict = detectBelowInputNamesInUniforms(uniforms);
	const names = BELOW_INPUT_UNIFORM_NAMES.filter(
		(n) => fromGlsl.includes(n) || fromDict.includes(n),
	);
	for (const name of names) {
		if (!uniforms[name]) {
			uniforms[name] = { value: null };
		}
	}
	return names;
}
