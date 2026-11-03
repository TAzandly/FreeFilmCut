/**
 * Clip-side 文字动画 library motion.
 * Parallel to sticker-motion.ts: phase spans + pack sampling → whole-text pose.
 *
 * Pack payload: freecapcut.textanim-pack/1 on manifest.textAnim
 * (components + tracks). Char-split / wipe runtime is not ported yet —
 * we approximate charIn/charOut/wave as whole-text opacity/offset/scale,
 * and honor ui.* relative tracks the same way sticker honors sticker.*.
 */

import { stickerAnimSpans, type StickerAnimSpan } from "@/vfxpack/sticker-motion";
import { applyAnimEase } from "@/vfxpack/freecapcut-anim";

export type TextAnimAssignment = {
	in?: { packId: string; duration?: number } | null;
	out?: { packId: string; duration?: number } | null;
	loop?: { packId: string; duration?: number } | null;
};

export type TextAnimPackPayload = {
	format?: string;
	name?: string;
	category?: "in" | "out" | "loop" | string;
	duration?: number;
	components?: Array<{
		id?: string;
		type?: string;
		scope?: string;
		enabled?: boolean;
		params?: Record<string, unknown>;
		channels?: Record<string, boolean>;
		selector?: Record<string, unknown>;
	}>;
	tracks?: Array<{
		path: string;
		interp?: string;
		relative?: "add" | "mul" | string;
		keys: Array<{ t: number; v: number; ease?: string }>;
	}>;
	/** Camera PP snapshot from editor (Bloom/DeepGlow/…). Never flowerStyle. */
	postProcess?: {
		enabled?: boolean;
		effects?: Array<{
			id?: string;
			type: string;
			enabled?: boolean;
			params?: Record<string, number | boolean | string>;
			exposed?: Record<string, boolean>;
		}>;
	};
	/**
	 * Editor scene beauty background snapshot (BeautyClear contract).
	 * Default → transparent clear (lower clips show).
	 * Color → opaque clear + scene.background so bloom matches editor.
	 */
	background?: {
		type?: "Default" | "Color" | string;
		color?: string;
	};
	/** Editor project tone mapping applied in OutputPass (default Neutral). */
	output?: {
		toneMapping?: string | number;
		toneMappingExposure?: number;
	};
};

export type TextMotionPose = {
	opacity: number;
	scale: number;
	rotate: number;
	positionX: number;
	positionY: number;
};

export const TEXT_MOTION_IDENTITY: TextMotionPose = {
	opacity: 1,
	scale: 1,
	rotate: 0,
	positionX: 0,
	positionY: 0,
};

export type TextAnimSpan = StickerAnimSpan;

function sampleKeys(
	keys: Array<{ t: number; v: number; ease?: string }> | undefined,
	time: number,
	interp: string = "linear",
): number | null {
	if (!keys || keys.length === 0) return null;
	const sorted = keys;
	if (time <= sorted[0].t) return sorted[0].v;
	if (time >= sorted[sorted.length - 1].t) return sorted[sorted.length - 1].v;
	for (let i = 0; i < sorted.length - 1; i++) {
		const a = sorted[i];
		const b = sorted[i + 1];
		if (time >= a.t && time <= b.t) {
			if (interp === "step" || b.t === a.t) return a.v;
			const u = applyAnimEase(a.ease, (time - a.t) / (b.t - a.t));
			return a.v + (b.v - a.v) * u;
		}
	}
	return sorted[sorted.length - 1].v;
}

function mapTime(time: number, duration: number, loop: boolean): number {
	const d = Math.max(0.0001, duration);
	let t = Number(time) || 0;
	if (loop) {
		t = t % d;
		if (t < 0) t += d;
		return t;
	}
	return Math.max(0, Math.min(d, t));
}

function num(v: unknown, fallback: number): number {
	const n = Number(v);
	return Number.isFinite(n) ? n : fallback;
}

function lerp(a: number, b: number, u: number): number {
	return a + (b - a) * u;
}

/** Authored pack length (ignores clip Duration override). */
export function textAnimAuthoredDuration(
	payload: TextAnimPackPayload | null | undefined,
): number {
	if (!payload) return 0;
	if (Number(payload.duration) > 0) return Number(payload.duration);
	let maxT = 0;
	for (const tr of payload.tracks || []) {
		for (const k of tr.keys || []) {
			if (k.t > maxT) maxT = k.t;
		}
	}
	return maxT > 0.05 ? maxT : 0;
}

/**
 * Pack play / phase duration on the clip: animation resource timeline only.
 * Assignment Duration overrides are ignored (Duration UI removed).
 */
export function textAnimPackDuration(
	pack: { manifest?: { duration?: number; textAnim?: TextAnimPackPayload; phase?: string } } | null | undefined,
	_assignment?: { duration?: number } | null,
): number {
	void _assignment;
	const ta = pack?.manifest?.textAnim;
	const authored = textAnimAuthoredDuration(ta);
	if (authored > 0) return authored;
	if (pack?.manifest && Number(pack.manifest.duration) > 0) return Number(pack.manifest.duration);
	return 0;
}

export function textAnimSpans(args: {
	clipDuration: number;
	inDuration: number;
	outDuration: number;
	hasLoop: boolean;
}): { in: TextAnimSpan | null; out: TextAnimSpan | null; loop: TextAnimSpan | null } {
	return stickerAnimSpans(args);
}

function sampleUiTracks(
	tracks: TextAnimPackPayload["tracks"],
	t: number,
	pose: TextMotionPose,
): void {
	if (!tracks) return;
	for (const tr of tracks) {
		if (!tr?.path || !tr.keys?.length) continue;
		const v = sampleKeys(tr.keys, t, tr.interp === "step" ? "step" : "linear");
		if (v == null || !Number.isFinite(v)) continue;
		const p = tr.path;
		// Keys are authored as channel values (same as sticker-motion). relative:add
		// means "delta from rest" when combining with the live clip transform — the
		// pose itself stores the sampled channel contribution.
		if (p === "ui.opacity" || p === "ui.anchoredOpacity") {
			pose.opacity = v;
		} else if (p === "ui.localScale.x" || p === "ui.localScale.y" || p === "ui.localScale.z") {
			pose.scale = v;
		} else if (p === "ui.localEulerAngles.z") {
			pose.rotate = v;
		} else if (p === "ui.anchoredPosition.x") {
			pose.positionX = v;
		} else if (p === "ui.anchoredPosition.y") {
			pose.positionY = v;
		}
	}
}

/**
 * Approximate char-scope components as whole-text pose using progress tracks.
 * progress 0 = far/rest start, 1 = resting pose (for in) — matches editor CapCut-style mix.
 */
function sampleComponentApprox(
	payload: TextAnimPackPayload,
	t: number,
	pose: TextMotionPose,
): void {
	const tracks = payload.tracks || [];
	const values = new Map<string, number>();
	for (const tr of tracks) {
		if (!tr?.path?.startsWith("textAnim.")) continue;
		const v = sampleKeys(tr.keys, t, tr.interp === "step" ? "step" : "linear");
		if (v != null && Number.isFinite(v)) values.set(tr.path, v);
	}

	for (const comp of payload.components || []) {
		if (!comp || comp.enabled === false || !comp.id || !comp.type) continue;
		const progressPath = `textAnim.${comp.id}.progress`;
		let progress = values.has(progressPath) ? (values.get(progressPath) as number) : 1;
		progress = Math.max(0, Math.min(1, progress));
		const params = comp.params || {};
		const ch = comp.channels || {};
		const type = String(comp.type);

		if (type === "charIn" || type === "typewriter") {
			const u = progress; // 0 far → 1 rest
			if (ch.opacity !== false) {
				const far = num(params.opacity, 0);
				pose.opacity *= lerp(far, 1, u);
			}
			if (ch.scale !== false) {
				const far = num(params.scale, 1);
				pose.scale *= lerp(far, 1, u);
			}
			if (ch.offsetX) pose.positionX += lerp(num(params.offsetX, 0), 0, u);
			if (ch.offsetY !== false) pose.positionY += lerp(num(params.offsetY, 0), 0, u);
			if (ch.rotateZ) pose.rotate += lerp(num(params.rotateZ, 0), 0, u) * (180 / Math.PI);
		} else if (type === "charOut") {
			const u = progress; // 0 rest → 1 far (out)
			if (ch.opacity !== false) {
				const far = num(params.opacity, 0);
				pose.opacity *= lerp(1, far, u);
			}
			if (ch.scale !== false) {
				const far = num(params.scale, 1);
				pose.scale *= lerp(1, far, u);
			}
			if (ch.offsetX) pose.positionX += lerp(0, num(params.offsetX, 0), u);
			if (ch.offsetY !== false) pose.positionY += lerp(0, num(params.offsetY, 0), u);
			if (ch.rotateZ) pose.rotate += lerp(0, num(params.rotateZ, 0), u) * (180 / Math.PI);
		} else if (type === "wave" || type === "jitter") {
			const amp = num(params.amp ?? params.ampY, type === "wave" ? 12 : 4);
			const speed = num(params.speed, type === "wave" ? 1 : 12);
			const phase = num(params.phase, 0);
			pose.positionY += Math.sin(t * Math.PI * 2 * speed + phase) * amp * progress;
		}
		// wipeReveal / bend / text-scope: not approximated here (needs TextGeomFx / char split)
	}
}

export function sampleTextAnimPack(
	payload: TextAnimPackPayload | null | undefined,
	time: number,
	opts?: { loop?: boolean },
): TextMotionPose {
	const pose: TextMotionPose = { ...TEXT_MOTION_IDENTITY };
	if (!payload) return pose;
	const authored = Math.max(0.1, textAnimAuthoredDuration(payload) || Number(payload.duration) || 0.5);
	const loop = opts?.loop ?? payload.category === "loop";
	const t = mapTime(time, authored, loop);
	sampleUiTracks(payload.tracks, t, pose);
	sampleComponentApprox(payload, t, pose);
	return pose;
}

export function combineTextPoses(poses: TextMotionPose[]): TextMotionPose {
	const pose: TextMotionPose = { ...TEXT_MOTION_IDENTITY };
	for (const part of poses) {
		pose.opacity *= part.opacity;
		pose.scale *= part.scale;
		pose.rotate += part.rotate;
		pose.positionX += part.positionX;
		pose.positionY += part.positionY;
	}
	return pose;
}

export function resolveAppliedTextPose({
	textAnims,
	localTimeSec,
	clipDurationSec,
	payloadForPack,
}: {
	textAnims: TextAnimAssignment | null | undefined;
	localTimeSec: number;
	clipDurationSec: number;
	payloadForPack: (packId: string) => TextAnimPackPayload | null;
}): TextMotionPose {
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
	const parts: TextMotionPose[] = [];
	if (inPayload && spans.in && t >= spans.in[0] && t < spans.in[1]) {
		parts.push(
			sampleTextAnimPack(inPayload, t - spans.in[0], {
				loop: false,
			}),
		);
	}
	if (loopPayload && spans.loop && t >= spans.loop[0] && t < spans.loop[1]) {
		parts.push(
			sampleTextAnimPack(loopPayload, t - spans.loop[0], {
				loop: true,
			}),
		);
	}
	if (outPayload && spans.out && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
		parts.push(
			sampleTextAnimPack(outPayload, t - spans.out[0], {
				loop: false,
			}),
		);
	}
	return combineTextPoses(parts);
}

/** Apply editor-Y-up pose onto canvas-Y-down TimelineFlowerTextProps fields. */
export function applyTextPoseToFlowerProps<
	T extends {
		opacity: number;
		scaleX: number;
		scaleY: number;
		rotate: number;
		positionX: number;
		positionY: number;
	},
>(props: T, pose: TextMotionPose): T {
	return {
		...props,
		opacity: props.opacity * pose.opacity,
		scaleX: props.scaleX * pose.scale,
		scaleY: props.scaleY * pose.scale,
		rotate: props.rotate + pose.rotate,
		positionX: props.positionX + pose.positionX,
		positionY: props.positionY - pose.positionY,
	};
}
