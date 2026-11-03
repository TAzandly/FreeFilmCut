/**
 * Register embedded text-template.textAnim as a virtual text-anim pack so the
 * compositor can resolve textAnims.{in|out|loop}.packId after apply / refresh.
 * Virtual packs are NOT library presets - flower Animation tab must hide them
 * (see isEmbeddedTextAnimPackId). fcc-tl-flower-16 / fcc-tl-flower-62
 */
import type { LoadedVfxPack, VfxManifest } from "@/vfxpack/types";
import type { TextAnimPackPayload } from "@/vfxpack/text-anim-motion";
import { usePackRegistry } from "@/vfxpack/pack-registry";

export function embeddedTextAnimPackId(templatePackId: string): string {
	return `${templatePackId}::embedded-textanim`;
}

/** True for virtual packs registered from a text-template (not flower library presets). fcc-tl-flower-62 */
export function isEmbeddedTextAnimPackId(packId: string | null | undefined): boolean {
	return typeof packId === "string" && packId.endsWith("::embedded-textanim");
}

function inferCategory(payload: TextAnimPackPayload): "in" | "out" | "loop" {
	const raw = String(payload.category || "").toLowerCase();
	if (raw === "in" || raw === "out" || raw === "loop") return raw;
	const votes = { in: 0, out: 0, loop: 0 };
	for (const c of payload.components || []) {
		if (!c || c.enabled === false) continue;
		const t = String(c.type || "").toLowerCase();
		if (/out|exit|fadeout|charout/.test(t)) votes.out += 1;
		else if (/loop|wave|idle|pulse|breath/.test(t)) votes.loop += 1;
		else if (/in|enter|fadein|charin|wipe|reveal/.test(t)) votes.in += 1;
		else votes.in += 1;
	}
	let best: "in" | "out" | "loop" = "in";
	let n = -1;
	for (const k of ["in", "out", "loop"] as const) {
		if (votes[k] > n) {
			n = votes[k];
			best = k;
		}
	}
	return best;
}

function resolveDuration(payload: TextAnimPackPayload): number {
	if (Number(payload.duration) > 0) return Number(payload.duration);
	let maxT = 0;
	for (const tr of payload.tracks || []) {
		for (const k of tr.keys || []) {
			if (k.t > maxT) maxT = k.t;
		}
	}
	if (maxT > 0.05) return Math.round(maxT * 1000) / 1000;
	// Heuristic from component params / common defaults
	for (const c of payload.components || []) {
		const p = (c?.params || {}) as Record<string, unknown>;
		const d = Number(p.duration);
		if (d > maxT) maxT = d;
	}
	return maxT > 0.05 ? maxT : 1.2;
}

/**
 * Normalize freecapcut.textanim/3 (or pack/1) into TextAnimPackPayload.
 */
export function normalizeEmbeddedTextAnim(
	raw: unknown,
): TextAnimPackPayload | null {
	if (!raw || typeof raw !== "object") return null;
	const o = raw as Record<string, unknown>;
	const components = Array.isArray(o.components) ? o.components : [];
	if (!components.length && !Array.isArray(o.tracks)) return null;
	const payload: TextAnimPackPayload = {
		format: "freecapcut.textanim-pack/1",
		name: typeof o.name === "string" ? o.name : "Embedded text anim",
		components: components as TextAnimPackPayload["components"],
		tracks: (Array.isArray(o.tracks) ? o.tracks : []) as TextAnimPackPayload["tracks"],
	};
	if (typeof o.category === "string") payload.category = o.category;
	if (Number(o.duration) > 0) payload.duration = Number(o.duration);
	if (o.postProcess && typeof o.postProcess === "object") {
		payload.postProcess = o.postProcess as TextAnimPackPayload["postProcess"];
	}
	if (o.background && typeof o.background === "object") {
		payload.background = o.background as TextAnimPackPayload["background"];
	}
	if (o.output && typeof o.output === "object") {
		payload.output = o.output as TextAnimPackPayload["output"];
	}
	const category = inferCategory(payload);
	payload.category = category;
	if (!(Number(payload.duration) > 0)) {
		payload.duration = resolveDuration(payload);
	}
	return payload;
}

export type TextAnimAssignment = {
	in?: { packId: string; duration?: number } | null;
	out?: { packId: string; duration?: number } | null;
	loop?: { packId: string; duration?: number } | null;
};

/**
 * Register (or refresh) a virtual text-anim pack for the embedded payload and
 * return the textAnims assignment pointing at it.
 */

/** Parse animations/*.anim in the pack for textAnim./ui./postProcess. tracks. */
export function extractTextAnimTracksFromPack(
	pack: LoadedVfxPack,
	objectUuid?: string | null,
): { tracks: NonNullable<TextAnimPackPayload["tracks"]>; durationHint: number } {
	const out: NonNullable<TextAnimPackPayload["tracks"]> = [];
	let maxT = 0;
	const decode = (bytes: Uint8Array) => new TextDecoder("utf-8").decode(bytes);
	const seen = new Set<string>();

	const tryParse = (rel: string, bytes: Uint8Array) => {
		if (seen.has(rel)) return;
		seen.add(rel);
		let json: {
			targets?: Array<{
				objectUuid?: string;
				tracks?: Array<{
					path?: string;
					interp?: string;
					relative?: string;
					keys?: Array<{ t: number; v: number; ease?: string }>;
				}>;
			}>;
		};
		try {
			json = JSON.parse(decode(bytes));
		} catch {
			return;
		}
		for (const target of json.targets || []) {
			if (!target) continue;
			const foreign =
				!!objectUuid &&
				!!target.objectUuid &&
				target.objectUuid !== objectUuid;
			for (const tr of target.tracks || []) {
				if (!tr?.path || !tr.keys?.length) continue;
				const p = String(tr.path);
				// Other objects: only harvest postProcess.* (camera PP keys).
				if (foreign && !p.startsWith("postProcess.")) continue;
				const keep =
					p.startsWith("textAnim.") ||
					p.startsWith("ui.") ||
					p.startsWith("postProcess.");
				if (!keep) continue;
				const track: NonNullable<TextAnimPackPayload["tracks"]>[number] = {
					path: p,
					keys: tr.keys.map((k) => {
						const o: { t: number; v: number; ease?: string } = {
							t: Number(k.t) || 0,
							v: Number(k.v) || 0,
						};
						if (k.ease) o.ease = k.ease;
						return o;
					}),
				};
				if (tr.interp === "step") track.interp = "step";
				if (p.startsWith("ui.")) track.relative = "add";
				out.push(track);
				for (const k of track.keys) {
					if (k.t > maxT) maxT = k.t;
				}
			}
		}
	};

	for (const [key, bytes] of pack.files.entries()) {
		const rel = key.replace(/^pack\//, "");
		if (!/^animations\/.+\.anim$/i.test(rel)) continue;
		tryParse(rel, bytes);
	}
	// Prefer matching text object first: also scan without uuid filter if empty
	if (!out.length && objectUuid) {
		return extractTextAnimTracksFromPack(pack, null);
	}
	return { tracks: out, durationHint: maxT };
}

/**
 * Ensure embedded freecapcut.textanim/3 (or pack/1) carries progress tracks.
 * Generic VfxPackExporter leaves progress only in animations/*.anim — without
 * these tracks TextAnimEngine defaults progress=1 (end state): no wipe / charIn.
 */
export function enrichTextAnimWithPackTracks(
	pack: LoadedVfxPack,
	textAnim: unknown,
	objectUuid?: string | null,
): unknown {
	if (!textAnim || typeof textAnim !== "object") return textAnim;
	const o = textAnim as Record<string, unknown>;
	const existing = Array.isArray(o.tracks) ? (o.tracks as Array<{ path?: string }>) : [];
	// fcc-tl-flower-21: always merge missing tracks (camera postProcess.* included).
	const { tracks, durationHint } = extractTextAnimTracksFromPack(pack, objectUuid);
	if (!tracks.length) return textAnim;

	const merged = [...existing];
	const have = new Set(
		existing.map((tr) => String(tr?.path || "")).filter(Boolean),
	);
	for (const tr of tracks) {
		if (have.has(tr.path)) continue;
		merged.push(tr);
		have.add(tr.path);
	}
	const out: Record<string, unknown> = { ...o, tracks: merged };
	if (!(Number(out.duration) > 0) && durationHint > 0.05) {
		out.duration = Math.round(durationHint * 1000) / 1000;
	}
	// Promote to pack format when components present
	if (!out.format || String(out.format).includes("textanim/3")) {
		out.format = "freecapcut.textanim-pack/1";
	}
	return out;
}

export function registerEmbeddedTextAnimPack({
	templatePackId,
	displayName,
	textAnim,
	animRefs,
	postProcess,
	background,
	output,
}: {
	templatePackId: string;
	displayName?: string;
	textAnim: unknown;
	animRefs?: { in?: string | null; out?: string | null; loop?: string | null } | null;
	postProcess?: TextAnimPackPayload["postProcess"] | null;
	background?: TextAnimPackPayload["background"] | null;
	output?: TextAnimPackPayload["output"] | null;
}): { packId: string; textAnims: TextAnimAssignment; category: "in" | "out" | "loop" } | null {
	// Prefer explicit library refs when present.
	if (animRefs && (animRefs.in || animRefs.out || animRefs.loop)) {
		const textAnims: TextAnimAssignment = {};
		if (animRefs.in) textAnims.in = { packId: animRefs.in };
		if (animRefs.out) textAnims.out = { packId: animRefs.out };
		if (animRefs.loop) textAnims.loop = { packId: animRefs.loop };
		const category = animRefs.in ? "in" : animRefs.out ? "out" : "loop";
		return { packId: animRefs[category] || "", textAnims, category };
	}

	const payload = normalizeEmbeddedTextAnim(textAnim);
	if (!payload) return null;
	if (postProcess && !payload.postProcess) payload.postProcess = postProcess;
	if (background && !payload.background) payload.background = background;
	if (output && !payload.output) payload.output = output;

	const category = inferCategory(payload);
	payload.category = category;
	const packId = embeddedTextAnimPackId(templatePackId);
	const manifest: VfxManifest = {
		schema: "freecapcut.vfxpack/1",
		id: packId,
		version: "1.0.0",
		displayName:
			(displayName ? `${displayName} · anim` : null) ||
			payload.name ||
			"Embedded text anim",
		type: "text-anim",
		phase: category,
		textAnim: payload as VfxManifest["textAnim"],
		duration: payload.duration,
	} as VfxManifest & { duration?: number };
	if (payload.postProcess) {
		(manifest as { postProcess?: unknown }).postProcess = payload.postProcess;
	}
	if (payload.background) {
		(manifest as { background?: unknown }).background = payload.background;
	}
	if (payload.output) {
		(manifest as { output?: unknown }).output = payload.output;
	}

	const virtualPack: LoadedVfxPack = {
		id: packId,
		displayName: manifest.displayName,
		type: "text-anim",
		scope: "stack",
		manifest,
		scene: null,
		files: new Map(),
		objectUrls: new Map(),
		sourceFileName: `${packId}.embedded`,
	};

	try {
		usePackRegistry.getState().registerPack(virtualPack);
	} catch (err) {
		console.warn("[FreeFilmCut] register embedded textAnim failed", err);
	}

	const textAnims: TextAnimAssignment = {
		[category]: { packId },
	};
	return { packId, textAnims, category };
}

/**
 * Sample postProcess.* keys from animations/*.anim onto a stack using clip-local time.
 * Text-template camera PP lives on PerspectiveCamera.anim, not only on textAnim payload.
 * fcc-tl-flower-21
 */
export function samplePackAnimPostProcess(
	pack: LoadedVfxPack,
	base: TextAnimPackPayload["postProcess"] | null | undefined,
	clipLocalTimeSec: number,
): TextAnimPackPayload["postProcess"] | null {
	if (!base?.effects?.length) return base ?? null;
	const { tracks } = extractTextAnimTracksFromPack(pack, null);
	const ppTracks = tracks.filter((tr) => tr.path.startsWith("postProcess."));
	if (!ppTracks.length) return base;

	const effects = base.effects.map((e) => ({
		...e,
		params: { ...(e.params || {}) },
	}));
	const t = Math.max(0, Number(clipLocalTimeSec) || 0);

	const sampleKeys = (
		keys: Array<{ t: number; v: number }>,
		time: number,
	): number | null => {
		if (!keys.length) return null;
		const sorted = keys.slice().sort((a, b) => a.t - b.t);
		if (time <= sorted[0].t) return sorted[0].v;
		const last = sorted[sorted.length - 1];
		if (time >= last.t) return last.v;
		for (let i = 0; i < sorted.length - 1; i++) {
			const a = sorted[i];
			const b = sorted[i + 1];
			if (time < a.t || time > b.t) continue;
			const span = b.t - a.t;
			const u = span > 1e-9 ? (time - a.t) / span : 0;
			return a.v + (b.v - a.v) * u;
		}
		return last.v;
	};

	for (const tr of ppTracks) {
		const m = String(tr.path).match(/^postProcess\.([^.]+)\.([^.]+)$/);
		if (!m || !tr.keys?.length) continue;
		const effectId = m[1];
		const param = m[2];
		const v = sampleKeys(tr.keys, t);
		if (v == null || !Number.isFinite(v)) continue;
		const entry = effects.find((e) => e && e.id === effectId);
		if (!entry) continue;
		const prev = entry.params?.[param];
		if (typeof prev === "boolean") {
			entry.params![param] = v >= 0.5;
		} else {
			entry.params![param] = v;
		}
	}
	return { ...base, effects };
}

