/**
 * Sticker-library motion. Applied to the finished sticker picture.
 * Missing tracks leave that channel at identity.
 */

export const STICKER_MOTION_PATHS = [
	"sticker.opacity",
	"sticker.scale",
	"sticker.rotate",
	"sticker.positionX",
	"sticker.positionY",
] as const;

export type StickerMotionPath = (typeof STICKER_MOTION_PATHS)[number];

export type StickerMotionPose = {
	opacity: number;
	scale: number;
	rotate: number;
	positionX: number;
	positionY: number;
};

export const STICKER_MOTION_IDENTITY: StickerMotionPose = {
	opacity: 1,
	scale: 1,
	rotate: 0,
	positionX: 0,
	positionY: 0,
};

export type StickerMotionKey = { t: number; v: number };

export type StickerMotionTrack = {
	path: string;
	interp?: "linear" | "step";
	keys: StickerMotionKey[];
};

export type StickerMotion = {
	format?: string;
	duration: number;
	loop?: "clamp" | "loop";
	tracks: StickerMotionTrack[];
};

export type StickerAnimAssignment = {
	in?: { packId: string } | null;
	out?: { packId: string } | null;
	loop?: { packId: string } | null;
};

export type StickerAnimSpan = [number, number];

const PATH_SET = new Set<string>(STICKER_MOTION_PATHS);

export function isStickerMotionPath(path: string): path is StickerMotionPath {
	return PATH_SET.has(path);
}

export function sampleStickerKeys(
	keys: StickerMotionKey[] | undefined,
	time: number,
	interp: "linear" | "step" = "linear",
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
			const u = (time - a.t) / (b.t - a.t);
			return a.v + (b.v - a.v) * u;
		}
	}
	return sorted[sorted.length - 1].v;
}

function mapMotionTime(time: number, duration: number, loop: "clamp" | "loop"): number {
	const d = Math.max(0.0001, duration);
	let t = Number(time) || 0;
	if (loop === "loop") {
		t = t % d;
		if (t < 0) t += d;
		return t;
	}
	return Math.max(0, Math.min(d, t));
}

export function sampleStickerMotion(
	motion: StickerMotion | null | undefined,
	time: number,
): StickerMotionPose {
	const pose: StickerMotionPose = { ...STICKER_MOTION_IDENTITY };
	if (!motion) return pose;
	const duration = Math.max(0.1, Number(motion.duration) || 0.5);
	const loop = motion.loop === "loop" ? "loop" : "clamp";
	const t = mapMotionTime(time, duration, loop);
	for (const track of motion.tracks || []) {
		if (!isStickerMotionPath(track.path)) continue;
		const value = sampleStickerKeys(track.keys, t, track.interp === "step" ? "step" : "linear");
		if (value == null || !Number.isFinite(value)) continue;
		if (track.path === "sticker.opacity") pose.opacity = value;
		else if (track.path === "sticker.scale") pose.scale = value;
		else if (track.path === "sticker.rotate") pose.rotate = value;
		else if (track.path === "sticker.positionX") pose.positionX = value;
		else pose.positionY = value;
	}
	return pose;
}

export function combineStickerPoses(poses: StickerMotionPose[]): StickerMotionPose {
	const pose: StickerMotionPose = { ...STICKER_MOTION_IDENTITY };
	for (const part of poses) {
		pose.opacity *= part.opacity;
		pose.scale *= part.scale;
		pose.rotate += part.rotate;
		pose.positionX += part.positionX;
		pose.positionY += part.positionY;
	}
	return pose;
}

export function stickerAnimSpans({
	clipDuration,
	inDuration,
	outDuration,
	hasLoop,
}: {
	clipDuration: number;
	inDuration: number;
	outDuration: number;
	hasLoop: boolean;
}): { in: StickerAnimSpan | null; out: StickerAnimSpan | null; loop: StickerAnimSpan | null } {
	const D = Math.max(0, clipDuration);
	const inDur = inDuration > 0 ? Math.min(inDuration, D) : 0;
	const outDur = outDuration > 0 ? Math.min(outDuration, D) : 0;
	const inSpan: StickerAnimSpan | null = inDur > 0 ? [0, inDur] : null;
	const outSpan: StickerAnimSpan | null = outDur > 0 ? [D - outDur, D] : null;
	const loopStart = inSpan ? inSpan[1] : 0;
	const loopEnd = outSpan ? outSpan[0] : D;
	const loop: StickerAnimSpan | null =
		hasLoop && loopEnd - loopStart > 0.0001 ? [loopStart, loopEnd] : null;
	return { in: inSpan, out: outSpan, loop };
}

function motionDuration(motion: StickerMotion | null): number {
	if (!motion) return 0;
	const d = Number(motion.duration);
	return Number.isFinite(d) && d > 0 ? d : 0;
}

export function resolveAppliedStickerPose({
	stickerAnims,
	localTimeSec,
	clipDurationSec,
	motionForPack,
}: {
	stickerAnims: StickerAnimAssignment | null | undefined;
	localTimeSec: number;
	clipDurationSec: number;
	motionForPack: (packId: string) => StickerMotion | null;
}): StickerMotionPose {
	const assignment = stickerAnims || {};
	const inMotion = assignment.in?.packId ? motionForPack(assignment.in.packId) : null;
	const outMotion = assignment.out?.packId ? motionForPack(assignment.out.packId) : null;
	const loopMotion = assignment.loop?.packId ? motionForPack(assignment.loop.packId) : null;
	const spans = stickerAnimSpans({
		clipDuration: clipDurationSec,
		inDuration: motionDuration(inMotion),
		outDuration: motionDuration(outMotion),
		hasLoop: !!loopMotion,
	});
	const t = Number(localTimeSec) || 0;
	const parts: StickerMotionPose[] = [];
	if (inMotion && spans.in && t >= spans.in[0] && t < spans.in[1]) {
		parts.push(sampleStickerMotion(inMotion, t - spans.in[0]));
	}
	if (loopMotion && spans.loop && t >= spans.loop[0] && t < spans.loop[1]) {
		parts.push(sampleStickerMotion(loopMotion, t - spans.loop[0]));
	}
	if (outMotion && spans.out && t >= spans.out[0] && t <= spans.out[1] + 1e-6) {
		parts.push(sampleStickerMotion(outMotion, t - spans.out[0]));
	}
	return combineStickerPoses(parts);
}
