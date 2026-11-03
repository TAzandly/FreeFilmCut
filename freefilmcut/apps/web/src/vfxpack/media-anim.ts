/**
 * Clip-anim (image/video) library assignment + phase time windows.
 * Combo is mutually exclusive with in/out. Overlapping in+out compress symmetrically.
 */

export type MediaAnimSlot = {
	packId: string;
	/** Playback window length in seconds (time-remaps pack native duration). */
	durationSec: number;
};

export type MediaAnimAssignment = {
	in?: MediaAnimSlot | null;
	out?: MediaAnimSlot | null;
	combo?: MediaAnimSlot | null;
};

export type MediaAnimPhase = "in" | "out" | "combo";

export type MediaAnimSpan = [number, number];

export function mediaAnimPackNativeDuration({
	pack,
}: {
	pack:
		| {
				manifest?: { duration?: number };
		  }
		| null
		| undefined;
}): number {
	const d = Number(pack?.manifest?.duration);
	return Number.isFinite(d) && d > 0 ? d : 1;
}

	/**
	 * Resolve in/out/combo spans on a clip.
	 * - combo → [0, durationSec] (clamped to clip length; not the full clip)
	 * - in+out overlap → scale both so they abut without overlapping
	 */
	export function mediaAnimSpans({
		clipDurationSec,
		assignment,
	}: {
		clipDurationSec: number;
		assignment: MediaAnimAssignment | null | undefined;
	}): {
		in: MediaAnimSpan | null;
		out: MediaAnimSpan | null;
		combo: MediaAnimSpan | null;
	} {
		const D = Math.max(0, clipDurationSec);
		const a = assignment ?? {};

		if (a.combo?.packId) {
			const dur = Math.min(Math.max(0, a.combo.durationSec || 0), D);
			return {
				in: null,
				out: null,
				combo: dur > 0 ? [0, dur] : null,
			};
		}

	let inDur = a.in?.packId ? Math.max(0, a.in.durationSec || 0) : 0;
	let outDur = a.out?.packId ? Math.max(0, a.out.durationSec || 0) : 0;
	inDur = Math.min(inDur, D);
	outDur = Math.min(outDur, D);

	if (inDur + outDur > D && inDur + outDur > 0) {
		const scale = D / (inDur + outDur);
		inDur *= scale;
		outDur *= scale;
	}

	return {
		in: inDur > 0 ? [0, inDur] : null,
		out: outDur > 0 ? [D - outDur, D] : null,
		combo: null,
	};
}

/** Map clip-local time inside a span to pack timeline seconds (duration remap). */
export function mediaAnimPackTime({
	localTimeSec,
	span,
	packNativeDurationSec,
}: {
	localTimeSec: number;
	span: MediaAnimSpan;
	packNativeDurationSec: number;
}): number {
	const [start, end] = span;
	const spanLen = Math.max(1e-6, end - start);
	const u = Math.min(1, Math.max(0, (localTimeSec - start) / spanLen));
	return u * Math.max(0.01, packNativeDurationSec);
}

export function activeMediaAnimAtTime({
	assignment,
	localTimeSec,
	clipDurationSec,
}: {
	assignment: MediaAnimAssignment | null | undefined;
	localTimeSec: number;
	clipDurationSec: number;
}): {
	phase: MediaAnimPhase;
	slot: MediaAnimSlot;
	span: MediaAnimSpan;
} | null {
	const spans = mediaAnimSpans({ clipDurationSec, assignment });
	const t = Number(localTimeSec) || 0;
	const a = assignment ?? {};

	if (spans.combo && a.combo?.packId) {
		if (t >= spans.combo[0] && t <= spans.combo[1] + 1e-6) {
			return { phase: "combo", slot: a.combo, span: spans.combo };
		}
	}
	if (spans.in && a.in?.packId && t >= spans.in[0] && t < spans.in[1]) {
		return { phase: "in", slot: a.in, span: spans.in };
	}
	if (spans.out && a.out?.packId && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
		return { phase: "out", slot: a.out, span: spans.out };
	}
	return null;
}
