/**
 * Apply a freecapcut.textanim-pack/1 (or manifest.textAnim) onto a built
 * flowerText UI group: char-split poses + wipe/bend geom fx.
 * Never writes flowerStyle — clip keeps its own 花字 / Effect stack.
 * Pack postProcess is exposed via resolveActiveTextAnimPack + mergeTextFxWithPackPostProcess.
 */
import type { Object3D } from "three";
import { getFccUI, isUIText } from "@/vfxpack/ui-overlay";
import {
	normalizeTextAnim,
	ensureTextAnimOnUI,
} from "./TextAnim.js";
import "./TextAnimBuiltins.js";
import {
	beginTextAnimTarget,
	setTextAnimOverride,
} from "./TextAnimOverrides.js";
import {
	applyTextAnim,
	clearTextAnimPreview,
	assertTextAnimOriginalsHidden,
} from "./TextAnimRuntime.js";
export { assertTextAnimOriginalsHidden };
import { applyTextGeomFxInScene } from "./TextGeomFx.js";
import {
	textAnimSpans,
	textAnimPackDuration,
	textAnimAuthoredDuration,
	sampleTextAnimPack,
	applyTextPoseToFlowerProps,
	type TextAnimAssignment,
	type TextAnimPackPayload,
	type TextMotionPose,
	TEXT_MOTION_IDENTITY,
} from "@/vfxpack/text-anim-motion";
import { applyAnimEase } from "@/vfxpack/freecapcut-anim";

function sampleKeys(
	keys: Array<{ t: number; v: number; ease?: string }> | undefined,
	time: number,
	interp: string = "linear",
): number | null {
	if (!keys || keys.length === 0) return null;
	if (time <= keys[0].t) return keys[0].v;
	if (time >= keys[keys.length - 1].t) return keys[keys.length - 1].v;
	for (let i = 0; i < keys.length - 1; i++) {
		const a = keys[i];
		const b = keys[i + 1];
		if (time >= a.t && time <= b.t) {
			if (interp === "step" || b.t === a.t) return a.v;
			const u = applyAnimEase(a.ease, (time - a.t) / (b.t - a.t));
			return a.v + (b.v - a.v) * u;
		}
	}
	return keys[keys.length - 1].v;
}

function mapLoopTime(time: number, duration: number, loop: boolean): number {
	const d = Math.max(0.0001, duration);
	let t = Number(time) || 0;
	if (loop) {
		t = t % d;
		if (t < 0) t += d;
		return t;
	}
	return Math.max(0, Math.min(d, t));
}

export function resolveActiveTextAnimPack({
	textAnims,
	localTimeSec,
	clipDurationSec,
	payloadForPack,
}: {
	textAnims: TextAnimAssignment | null | undefined;
	localTimeSec: number;
	clipDurationSec: number;
	payloadForPack: (packId: string) => TextAnimPackPayload | null;
}): {
	payload: TextAnimPackPayload;
	phaseLocalTime: number;
	loop: boolean;
} | null {
	const assignment = textAnims || {};
	const inPayload = assignment.in?.packId ? payloadForPack(assignment.in.packId) : null;
	const outPayload = assignment.out?.packId ? payloadForPack(assignment.out.packId) : null;
	const loopPayload = assignment.loop?.packId ? payloadForPack(assignment.loop.packId) : null;

	const inDur = textAnimPackDuration(
		inPayload ? { manifest: { textAnim: inPayload, duration: inPayload.duration } } : null,
		assignment.in,
	);
	const outDur = textAnimPackDuration(
		outPayload ? { manifest: { textAnim: outPayload, duration: outPayload.duration } } : null,
		assignment.out,
	);
	const loopDur = textAnimPackDuration(
		loopPayload ? { manifest: { textAnim: loopPayload, duration: loopPayload.duration } } : null,
		assignment.loop,
	);
	const spans = textAnimSpans({
		clipDuration: clipDurationSec,
		inDuration: inDur,
		outDuration: outDur,
		hasLoop: !!loopPayload && loopDur > 0,
	});
	const t = Number(localTimeSec) || 0;
	if (inPayload && spans.in && t >= spans.in[0] && t < spans.in[1]) {
		return {
			payload: inPayload,
			phaseLocalTime: t - spans.in[0],
			loop: false,
		};
	}
	if (loopPayload && spans.loop && t >= spans.loop[0] && t < spans.loop[1]) {
		return {
			payload: loopPayload,
			phaseLocalTime: t - spans.loop[0],
			loop: true,
		};
	}
	if (outPayload && spans.out && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
		return {
			payload: outPayload,
			phaseLocalTime: t - spans.out[0],
			loop: false,
		};
	}
	return null;
}

/** ui.* track contribution only (char/wipe handled by runtime + geom fx). */
export function sampleUiOnlyPose(
	payload: TextAnimPackPayload,
	phaseLocalTime: number,
	loop: boolean,
): TextMotionPose {
	const slim: TextAnimPackPayload = {
		...payload,
		components: [],
		tracks: (payload.tracks || []).filter((tr) => tr.path.startsWith("ui.")),
	};
	return sampleTextAnimPack(slim, phaseLocalTime, { loop });
}

function writeTrackOverrides(
	object: Object3D,
	payload: TextAnimPackPayload,
	phaseLocalTime: number,
	loop: boolean,
): void {
	const authored = Math.max(0.1, textAnimAuthoredDuration(payload) || Number(payload.duration) || 0.5);
	const t = mapLoopTime(phaseLocalTime, authored, loop);
	beginTextAnimTarget(object, t);
	for (const tr of payload.tracks || []) {
		if (!tr?.path?.startsWith("textAnim.") || !tr.keys?.length) continue;
		const sub = tr.path.slice("textAnim.".length);
		const v = sampleKeys(tr.keys, t, tr.interp === "step" ? "step" : "linear");
		if (v == null || !Number.isFinite(v)) continue;
		setTextAnimOverride(object, sub, v, tr.keys);
	}
}

/**
 * Merge clip textFxStack with active text-anim pack postProcess (camera PP snapshot).
 * Element flowerStyle is unrelated and never touched here.
 */
/**
 * Apply postProcess.{effectId}.{param} tracks onto a cloned pack PP stack.
 * Static snapshot alone has no intensity animation; tracks drive Bloom/DeepGlow etc.
 */
export function samplePackPostProcess(
	payload: TextAnimPackPayload | null | undefined,
	phaseLocalTime: number,
	loop: boolean,
): TextAnimPackPayload["postProcess"] | null {
	if (!payload?.postProcess?.effects?.length) return payload?.postProcess ?? null;
	const authored = Math.max(0.1, textAnimAuthoredDuration(payload) || Number(payload.duration) || 0.5);
	const t = mapLoopTime(phaseLocalTime, authored, loop);
	const effects = payload.postProcess.effects.map((e) => ({
		...e,
		params: { ...(e.params || {}) },
	}));
	for (const tr of payload.tracks || []) {
		if (!tr?.path?.startsWith("postProcess.") || !tr.keys?.length) continue;
		const m = String(tr.path).match(/^postProcess\.([^.]+)\.([^.]+)$/);
		if (!m) continue;
		const effectId = m[1];
		const param = m[2];
		const v = sampleKeys(tr.keys, t, tr.interp === "step" ? "step" : "linear");
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
	return {
		...payload.postProcess,
		effects,
		// keep enabled from snapshot; tracks only mutate params
	};
}

export function mergeTextFxWithPackPostProcess(
	elementStack: {
		enabled?: boolean;
		effects?: Array<Record<string, unknown>>;
	} | null | undefined,
	packPostProcess: TextAnimPackPayload["postProcess"] | null | undefined,
): {
	enabled: boolean;
	effects: Array<Record<string, unknown>>;
} | null {
	const elEffects = Array.isArray(elementStack?.effects) ? elementStack!.effects! : [];
	const packEffects = Array.isArray(packPostProcess?.effects) ? packPostProcess!.effects! : [];
	if (!elEffects.length && !packEffects.length) return null;
	return {
		enabled:
			(elementStack?.enabled !== false && elEffects.length > 0) ||
			(packPostProcess?.enabled !== false && packEffects.length > 0),
		effects: [...elEffects, ...packEffects] as Array<Record<string, unknown>>,
	};
}

/**
 * Drive char-split + wipe/bend on every UI text under root for the active pack.
 * Returns ui-only pose to bake into TimelineFlowerTextProps (position/scale/…).
 * Does not assign ui.flowerStyle / flowerBaseFontSize.
 */
export function applyActiveTextAnimPack({
	root,
	textAnims,
	localTimeSec,
	clipDurationSec,
	payloadForPack,
	rect,
}: {
	root: Object3D;
	textAnims: TextAnimAssignment | null | undefined;
	localTimeSec: number;
	clipDurationSec: number;
	payloadForPack: (packId: string) => TextAnimPackPayload | null;
	rect?: { w: number; h: number } | null;
}): TextMotionPose {
	const active = resolveActiveTextAnimPack({
		textAnims,
		localTimeSec,
		clipDurationSec,
		payloadForPack,
	});
	if (!active) {
		root.traverse((obj) => {
			if (!isUIText(obj)) return;
			if ((obj.userData as { __fccTextAnimChar?: boolean }).__fccTextAnimChar) return;
			clearTextAnimPreview(obj);
		});
		applyTextGeomFxInScene(root, { enabled: false });
		return { ...TEXT_MOTION_IDENTITY };
	}

	const { payload, phaseLocalTime, loop } = active;
	const components = Array.isArray(payload.components) ? payload.components : [];
	const animDoc = normalizeTextAnim({
		format: "freecapcut.textanim/3",
		enabled: true,
		components,
	});

	root.traverse((obj) => {
		if (!isUIText(obj)) return;
		if ((obj.userData as { __fccTextAnimChar?: boolean }).__fccTextAnimChar) return;
		const ui = getFccUI(obj);
		if (!ui) return;
		// textAnim components/tracks only — leave flowerStyle / Effect stack on the clip.
		ui.textAnim = animDoc;
		ensureTextAnimOnUI(ui);
		writeTrackOverrides(obj, payload, phaseLocalTime, loop);
		const r =
			rect && rect.w > 0
				? rect
				: {
						w: Math.max(1, (Number(ui.fontSize) || 48) * Math.max(4, String(ui.text || "").length)),
						h: Math.max(1, (Number(ui.fontSize) || 48) * 3),
					};
		applyTextAnim(obj, r);
	});

	// Wipe/bend after char poses (editor order).
	applyTextGeomFxInScene(root, { enabled: true });

	return sampleUiOnlyPose(payload, phaseLocalTime, loop);
}

export { applyTextPoseToFlowerProps };
