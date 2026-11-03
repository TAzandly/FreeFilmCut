/**
 * FreeFilmCut .anim sampling (shared semantics with Editor FreeCapCutAnimCore.js).
 * Transform + material uniforms + camera post-process params.
 * See docs/animation-format.md
 */
import type * as THREE from "three";

export const ANIM_FORMAT = "freecapcut.anim/1";

export type AnimKey = { t: number; v: number; ease?: string };
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
	/** Prefer explicit map from pack build (avoids uuid rewrite / cache issues). */
	objectsByUuid?: Map<string, THREE.Object3D>;
	materialsByUuid?: Map<string, THREE.Material>;
	/** Mutable pack post-process stack (sampled params written here before composer rebuild). */
	postProcess?: {
		enabled?: boolean;
		effects: Array<{
			id: string;
			type?: string;
			enabled?: boolean;
			params?: Record<string, number | boolean | string | number[]>;
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

/** Matches editor FreeCapCutAnimCore UI_TRANSFORM_SPEC. Degrees / pixels on fccUI. */
const UI_TRANSFORM_SPEC: Record<
	string,
	{ key: "anchoredPosition" | "localEulerAngles" | "localScale"; index: number; len: number; fill: number }
> = {
	"ui.anchoredPosition.x": { key: "anchoredPosition", index: 0, len: 2, fill: 0 },
	"ui.anchoredPosition.y": { key: "anchoredPosition", index: 1, len: 2, fill: 0 },
	"ui.localEulerAngles.x": { key: "localEulerAngles", index: 0, len: 3, fill: 0 },
	"ui.localEulerAngles.y": { key: "localEulerAngles", index: 1, len: 3, fill: 0 },
	"ui.localEulerAngles.z": { key: "localEulerAngles", index: 2, len: 3, fill: 0 },
	"ui.localScale.x": { key: "localScale", index: 0, len: 3, fill: 1 },
	"ui.localScale.y": { key: "localScale", index: 1, len: 3, fill: 1 },
	"ui.localScale.z": { key: "localScale", index: 2, len: 3, fill: 1 },
};

function setUITransformValue(object: THREE.Object3D, path: string, value: number): boolean {
	const spec = UI_TRANSFORM_SPEC[path];
	if (!spec || !Number.isFinite(value)) return false;
	const ui = (object.userData as { fccUI?: Record<string, unknown> } | undefined)?.fccUI;
	if (!ui || typeof ui !== "object" || !ui.type || ui.type === "canvas") return false;
	let arr = ui[spec.key];
	if (!Array.isArray(arr)) {
		arr = [];
		ui[spec.key] = arr;
	}
	const nums = arr as number[];
	for (let i = 0; i < spec.len; i++) {
		if (!Number.isFinite(Number(nums[i]))) nums[i] = spec.fill;
	}
	nums[spec.index] = value;
	return true;
}

const RAD_TO_DEG = 180 / Math.PI;

function fccUIBag(object: THREE.Object3D): Record<string, unknown> | null {
	const ui = (object.userData as { fccUI?: Record<string, unknown> } | undefined)?.fccUI;
	if (!ui || typeof ui !== "object" || !ui.type || ui.type === "canvas") return null;
	return ui;
}

function ensureUINumberArray(
	ui: Record<string, unknown>,
	key: string,
	len: number,
	fill: number,
): number[] {
	let arr = ui[key];
	if (!Array.isArray(arr)) {
		arr = [];
		ui[key] = arr;
	}
	const nums = arr as number[];
	for (let i = 0; i < len; i++) {
		if (!Number.isFinite(Number(nums[i]))) nums[i] = fill;
	}
	return nums;
}

/** Layout overwrites Object3D TRS. Keep UI keys on fccUI. */
function applyLegacyUIObjectPath(
	object: THREE.Object3D,
	path: string,
	value: number,
): boolean {
	const ui = fccUIBag(object);
	if (!ui || !Number.isFinite(value)) return false;
	const parts = path.split(".");
	if (parts.length !== 2) return false;
	const index = parts[1] === "x" ? 0 : parts[1] === "y" ? 1 : parts[1] === "z" ? 2 : -1;
	if (index < 0) return false;
	if (parts[0] === "rotation") {
		ensureUINumberArray(ui, "localEulerAngles", 3, 0)[index] = value * RAD_TO_DEG;
		return true;
	}
	if (parts[0] === "scale") {
		ensureUINumberArray(ui, "localScale", 3, 1)[index] = value;
		return true;
	}
	if (parts[0] === "position") {
		if (parts[1] === "z") {
			object.position.z = value;
			return true;
		}
		const arr = ensureUINumberArray(ui, "anchoredPosition", 2, 0);
		const currentAnchor = Number(arr[index]) || 0;
		const currentPos = parts[1] === "x" ? object.position.x : object.position.y;
		arr[index] = currentAnchor + (value - currentPos);
		return true;
	}
	return false;
}

function trackPrefixVaries(
	target: { tracks?: { path?: string; keys?: { v?: number; value?: number }[] }[] },
	prefix: string,
): boolean {
	for (const tr of target.tracks || []) {
		if (!tr?.keys || tr.keys.length < 2 || !String(tr.path || "").startsWith(prefix)) continue;
		let first: number | null = null;
		for (const key of tr.keys) {
			const raw = key && (key.v !== undefined ? key.v : key.value);
			const v = Number(raw);
			if (!Number.isFinite(v)) continue;
			if (first === null) first = v;
			else if (Math.abs(v - first) > 1e-4) return true;
		}
	}
	return false;
}

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
			const u = applyAnimEase(a.ease, (t - a.t) / (b.t - a.t));
			return a.v + (b.v - a.v) * u;
		}
	}
	return keys[keys.length - 1].v;
}

/** Mirrors editor js/anim/AnimEase.js. */
export function applyAnimEase(name: string | undefined, u: number): number {
	const x = u <= 0 ? 0 : u >= 1 ? 1 : u;
	switch (name) {
		case "easeIn":
			return x * x * x;
		case "easeOut":
			return 1 - (1 - x) ** 3;
		case "easeInOut":
			return x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2;
		case "back": {
			const c1 = 1.70158;
			const c3 = c1 + 1;
			return 1 + c3 * (x - 1) ** 3 + c1 * (x - 1) ** 2;
		}
		case "elastic":
			if (x === 0 || x === 1) return x;
			return 2 ** (-10 * x) * Math.sin((x * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;
		case "bounce": {
			const n1 = 7.5625;
			const d1 = 2.75;
			let y = x;
			if (y < 1 / d1) return n1 * y * y;
			if (y < 2 / d1) {
				y -= 1.5 / d1;
				return n1 * y * y + 0.75;
			}
			if (y < 2.5 / d1) {
				y -= 2.25 / d1;
				return n1 * y * y + 0.9375;
			}
			y -= 2.625 / d1;
			return n1 * y * y + 0.984375;
		}
		case "step":
			return x >= 1 ? 1 : 0;
		default:
			return x;
	}
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
): { effectId: string; param: string; comp: string | null } | null {
	// Editor PP diamonds write component tracks: .r/.g/.b (color) or .x/.y/.z/.w (vec).
	const m = String(path || "").match(
		/^postProcess\.([^.]+)\.([^.]+)(?:\.(x|y|z|w|r|g|b))?$/,
	);
	if (!m) return null;
	return { effectId: m[1], param: m[2], comp: m[3] || null };
}

function hexToRgb01(hex: string): { r: number; g: number; b: number } {
	const h = String(hex || "#ffffff").replace("#", "");
	const full =
		h.length === 3
			? h
					.split("")
					.map((c) => c + c)
					.join("")
			: h.slice(0, 6);
	const n = Number.parseInt(full, 16);
	if (!Number.isFinite(n)) return { r: 1, g: 1, b: 1 };
	return {
		r: ((n >> 16) & 255) / 255,
		g: ((n >> 8) & 255) / 255,
		b: (n & 255) / 255,
	};
}

function rgb01ToHex(r: number, g: number, b: number): string {
	const to = (v: number) =>
		Math.max(0, Math.min(255, Math.round(Number(v) * 255)))
			.toString(16)
			.padStart(2, "0");
	return `#${to(r)}${to(g)}${to(b)}`;
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
	const comp = parsed.comp;

	if (comp === "r" || comp === "g" || comp === "b") {
		const rgb = hexToRgb01(typeof prev === "string" ? prev : "#ffffff");
		rgb[comp] = value;
		entry.params[parsed.param] = rgb01ToHex(rgb.r, rgb.g, rgb.b);
		return true;
	}

	if (comp === "x" || comp === "y" || comp === "z" || comp === "w") {
		const idx = { x: 0, y: 1, z: 2, w: 3 }[comp];
		const arr = Array.isArray(prev) ? prev.slice() : [0, 0, 0, 0];
		while (arr.length <= idx) arr.push(0);
		arr[idx] = value;
		entry.params[parsed.param] = arr;
		return true;
	}

	if (typeof prev === "boolean") {
		entry.params[parsed.param] = value >= 0.5;
		return true;
	}
	entry.params[parsed.param] = value;
	return true;
}

let _animLogMissingOnce = false;

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
		const obj =
			opts.objectsByUuid?.get(target.objectUuid) ||
			root.getObjectByProperty("uuid", target.objectUuid);
		if (!obj && !_animLogMissingOnce) {
			_animLogMissingOnce = true;
			console.warn(
				"[FreeFilmCut anim] target uuid not found in pack scene",
				target.objectUuid,
			);
		}
		let touched = false;
		const uiPosVaries = trackPrefixVaries(target, "ui.anchoredPosition.");
		const uiRotVaries = trackPrefixVaries(target, "ui.localEulerAngles.");
		const uiScaleVaries = trackPrefixVaries(target, "ui.localScale.");
		const legacyPosVaries = trackPrefixVaries(target, "position.");
		const legacyRotVaries = trackPrefixVaries(target, "rotation.");
		const legacyScaleVaries = trackPrefixVaries(target, "scale.");
		for (const track of target.tracks || []) {
			const v = sampleKeys(track.keys, tc, track.interp || "linear");
			if (v === null) continue;

			if (obj && fccUIBag(obj) && TRANSFORM_PATHS.has(track.path)) {
				const channel = track.path.split(".")[0];
				if (channel === "position" && uiPosVaries) continue;
				if (channel === "rotation" && uiRotVaries) continue;
				if (channel === "scale" && uiScaleVaries) continue;
				if (applyLegacyUIObjectPath(obj, track.path, v)) n++;
				continue;
			}

			if (UI_TRANSFORM_SPEC[track.path]) {
				if (!obj) continue;
				const p = track.path;
				if (p.startsWith("ui.anchoredPosition.") && !uiPosVaries && legacyPosVaries) continue;
				if (p.startsWith("ui.localEulerAngles.") && !uiRotVaries && legacyRotVaries) continue;
				if (p.startsWith("ui.localScale.") && !uiScaleVaries && legacyScaleVaries) continue;
				if (setUITransformValue(obj, track.path, v)) n++;
				continue;
			}

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
				const key: AnimKey = { t: kt, v: kv };
				if (typeof kk.ease === "string" && kk.ease !== "linear") key.ease = kk.ease;
				keys.push(key);
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

