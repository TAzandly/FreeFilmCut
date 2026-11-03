/**
 * FreeFilmCut .anim sampling (shared semantics with Editor FreeCapCutAnimCore.js).
 * Transform + material uniforms + camera post-process params.
 * See docs/animation-format.md
 */
import type * as THREE from "three";

export const ANIM_FORMAT = "freecapcut.anim/1";

export type AnimKey = { t: number; v: number };
export type AnimTrack = {
	path: string;
	interp?: "linear" | "step";
	keys: AnimKey[];
};
export type AnimTarget = {
	objectUuid: string;
	tracks: AnimTrack[];
};
export type FreecapcutAnimClip = {
	format?: string;
	name: string;
	fps: number;
	duration: number;
	loop?: "clamp" | "loop";
	targets: AnimTarget[];
};

export type ApplyAnimOptions = {
	materialsByUuid?: Map<string, THREE.Material>;
	/** Mutable pack post-process stack (sampled params written here before composer rebuild). */
	postProcess?: {
		enabled?: boolean;
		effects: Array<{
			id: string;
			type?: string;
			enabled?: boolean;
			params?: Record<string, number | boolean | string>;
		}>;
	} | null;
};

const TRANSFORM_PATHS = new Set([
	"position.x",
	"position.y",
	"position.z",
	"rotation.x",
	"rotation.y",
	"rotation.z",
	"scale.x",
	"scale.y",
	"scale.z",
]);

export function mapAnimTime(
	t: number,
	duration: number,
	loop: "clamp" | "loop" = "clamp",
): number {
	const d = Math.max(0, Number(duration) || 0);
	if (d <= 0) return 0;
	let x = Number(t) || 0;
	if (loop === "loop") {
		x = x % d;
		if (x < 0) x += d;
		return x;
	}
	return Math.max(0, Math.min(d, x));
}

export function sampleKeys(
	keys: AnimKey[],
	t: number,
	interp: "linear" | "step" = "linear",
): number | null {
	if (!keys?.length) return null;
	if (t <= keys[0].t) return keys[0].v;
	if (t >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
	for (let i = 0; i < keys.length - 1; i++) {
		const a = keys[i];
		const b = keys[i + 1];
		if (t >= a.t && t <= b.t) {
			if (interp === "step" || b.t === a.t) return a.v;
			const u = (t - a.t) / (b.t - a.t);
			return a.v + (b.v - a.v) * u;
		}
	}
	return keys[keys.length - 1].v;
}

export function parseMaterialPath(
	path: string,
): { materialUuid: string; uniform: string; comp: string | null } | null {
	const m = String(path || "").match(
		/^material\.([^.]+)\.uniforms\.([^.]+)(?:\.(x|y|z|w|r|g|b))?$/,
	);
	if (!m) return null;
	return { materialUuid: m[1], uniform: m[2], comp: m[3] || null };
}

export function parsePostProcessPath(
	path: string,
): { effectId: string; param: string } | null {
	const m = String(path || "").match(/^postProcess\.([^.]+)\.([^.]+)$/);
	if (!m) return null;
	return { effectId: m[1], param: m[2] };
}

function setObjectPathValue(
	object: THREE.Object3D,
	path: string,
	value: number,
): boolean {
	const parts = path.split(".");
	if (parts.length === 2) {
		const bag = (object as unknown as Record<string, { [k: string]: number }>)[
			parts[0]
		];
		if (bag && typeof bag[parts[1]] === "number") {
			bag[parts[1]] = value;
			return true;
		}
	}
	return false;
}

function findMaterial(
	root: THREE.Object3D,
	materialsByUuid: Map<string, THREE.Material> | undefined,
	uuid: string,
): THREE.Material | null {
	if (materialsByUuid?.has(uuid)) return materialsByUuid.get(uuid)!;
	let found: THREE.Material | null = null;
	root.traverse((obj) => {
		if (found) return;
		const mesh = obj as THREE.Mesh;
		const mat = mesh.material;
		if (!mat) return;
		const mats = Array.isArray(mat) ? mat : [mat];
		for (const m of mats) {
			if (m?.uuid === uuid) {
				found = m;
				return;
			}
		}
	});
	return found;
}

function writeUniformComponent(
	uniformBag: { value: unknown },
	comp: string | null,
	value: number,
): boolean {
	const cur = uniformBag.value;
	if (typeof cur === "number") {
		if (comp) return false;
		uniformBag.value = value;
		return true;
	}
	if (typeof cur === "boolean") {
		if (comp) return false;
		uniformBag.value = value >= 0.5;
		return true;
	}
	if (cur && typeof cur === "object" && comp && typeof (cur as Record<string, unknown>)[comp] === "number") {
		(cur as Record<string, number>)[comp] = value;
		return true;
	}
	return false;
}

function applyMaterialPath(
	root: THREE.Object3D,
	path: string,
	value: number,
	materialsByUuid?: Map<string, THREE.Material>,
): boolean {
	const parsed = parseMaterialPath(path);
	if (!parsed) return false;
	const mat = findMaterial(root, materialsByUuid, parsed.materialUuid) as
		| THREE.ShaderMaterial
		| null;
	if (!mat?.uniforms?.[parsed.uniform]) return false;
	const ok = writeUniformComponent(
		mat.uniforms[parsed.uniform],
		parsed.comp,
		value,
	);
	if (ok) mat.needsUpdate = true;
	return ok;
}

function applyPostProcessPath(
	root: THREE.Object3D,
	objectUuid: string,
	path: string,
	value: number,
	postProcess: ApplyAnimOptions["postProcess"],
): boolean {
	const parsed = parsePostProcessPath(path);
	if (!parsed) return false;
	let stack = postProcess || null;
	if (!stack) {
		const cam = root.getObjectByProperty("uuid", objectUuid) as THREE.Camera | undefined;
		const ud = cam?.userData as { postProcessStack?: ApplyAnimOptions["postProcess"] } | undefined;
		stack = ud?.postProcessStack || null;
		if (!stack) {
			root.traverse((obj) => {
				if (stack) return;
				const c = obj as THREE.Camera;
				if (c.isCamera) {
					const s = (c.userData as { postProcessStack?: ApplyAnimOptions["postProcess"] })
						?.postProcessStack;
					if (s) stack = s;
				}
			});
		}
	}
	if (!stack?.effects) return false;
	const entry = stack.effects.find((e) => e && e.id === parsed.effectId);
	if (!entry) return false;
	if (!entry.params || typeof entry.params !== "object") entry.params = {};
	const prev = entry.params[parsed.param];
	if (typeof prev === "boolean") {
		entry.params[parsed.param] = value >= 0.5;
		return true;
	}
	entry.params[parsed.param] = value;
	return true;
}

export function applyAnimToRoot(
	root: THREE.Object3D,
	clip: FreecapcutAnimClip,
	t: number,
	opts: ApplyAnimOptions = {},
): number {
	if (!root || !clip) return 0;
	const tc = mapAnimTime(t, clip.duration, clip.loop || "clamp");
	let n = 0;
	for (const target of clip.targets || []) {
		const obj = root.getObjectByProperty("uuid", target.objectUuid);
		let touched = false;
		for (const track of target.tracks || []) {
			const v = sampleKeys(track.keys, tc, track.interp || "linear");
			if (v === null) continue;

			if (TRANSFORM_PATHS.has(track.path)) {
				if (!obj) continue;
				if (setObjectPathValue(obj, track.path, v)) {
					touched = true;
					n++;
				}
				continue;
			}

			if (parseMaterialPath(track.path)) {
				if (applyMaterialPath(root, track.path, v, opts.materialsByUuid)) n++;
				continue;
			}

			if (parsePostProcessPath(track.path)) {
				if (
					applyPostProcessPath(
						root,
						target.objectUuid,
						track.path,
						v,
						opts.postProcess,
					)
				) {
					n++;
				}
				continue;
			}
		}
		if (
			touched &&
			obj &&
			(obj as THREE.Camera).isCamera &&
			typeof (obj as THREE.PerspectiveCamera).updateProjectionMatrix === "function"
		) {
			(obj as THREE.PerspectiveCamera).updateProjectionMatrix();
		}
	}
	return n;
}

export function normalizeAnim(raw: unknown): FreecapcutAnimClip | null {
	if (!raw || typeof raw !== "object") return null;
	const r = raw as Record<string, unknown>;
	const targetsIn = Array.isArray(r.targets) ? r.targets : [];
	const targets: AnimTarget[] = [];
	for (const t of targetsIn) {
		if (!t || typeof t !== "object") continue;
		const tt = t as Record<string, unknown>;
		if (!tt.objectUuid) continue;
		const tracksIn = Array.isArray(tt.tracks) ? tt.tracks : [];
		const tracks: AnimTrack[] = [];
		for (const tr of tracksIn) {
			if (!tr || typeof tr !== "object") continue;
			const trr = tr as Record<string, unknown>;
			if (!trr.path) continue;
			const keysIn = Array.isArray(trr.keys) ? trr.keys : [];
			const keys: AnimKey[] = [];
			for (const k of keysIn) {
				if (!k || typeof k !== "object") continue;
				const kk = k as Record<string, unknown>;
				const kt = Number(kk.t);
				const kv = Number(kk.v);
				if (!Number.isFinite(kt) || !Number.isFinite(kv)) continue;
				keys.push({ t: kt, v: kv });
			}
			keys.sort((a, b) => a.t - b.t);
			tracks.push({
				path: String(trr.path),
				interp: trr.interp === "step" ? "step" : "linear",
				keys,
			});
		}
		targets.push({ objectUuid: String(tt.objectUuid), tracks });
	}
	return {
		format: String(r.format || ANIM_FORMAT),
		name: String(r.name || "Animation"),
		fps: Number(r.fps) || 30,
		duration: Math.max(0, Number(r.duration) || 0),
		loop: r.loop === "loop" ? "loop" : "clamp",
		targets,
	};
}

