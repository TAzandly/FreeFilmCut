import type { FrameRate } from "opencut-wasm";
import type { MediaTime } from "@/wasm";
import {
	addMediaTime,
	mediaTime,
	mediaTimeFromSeconds,
	mediaTimeToSeconds,
	minMediaTime,
	roundFrameTime,
	roundMediaTime,
	subMediaTime,
} from "@/wasm";

export const DEFAULT_TRANSITION_DURATION_SEC = 1;
const MAX_TRANSITION_DURATION_SEC = 5;

export function defaultTransitionDuration(): MediaTime {
	return mediaTimeFromSeconds({ seconds: DEFAULT_TRANSITION_DURATION_SEC });
}

export function transitionWindow({
	cutTime,
	duration,
}: {
	cutTime: MediaTime;
	duration: MediaTime;
}): { start: MediaTime; end: MediaTime } {
	const half = roundMediaTime({ time: duration / 2 });
	return {
		start: subMediaTime({ a: cutTime, b: half }),
		end: addMediaTime({ a: cutTime, b: half }),
	};
}

/**
 * Either edge moves by `deltaTime`; the opposite edge mirrors so the cut
 * stays centered. Positive right-edge delta (and negative left-edge delta)
 * grows the total duration by twice that amount.
 */
export function symmetricDurationFromEdgeDelta({
	startDuration,
	deltaTime,
	side,
}: {
	startDuration: MediaTime;
	deltaTime: MediaTime;
	side: "left" | "right";
}): MediaTime {
	const signedTicks = side === "right" ? deltaTime : -deltaTime;
	const nextTicks = startDuration + signedTicks * 2;
	return mediaTime({
		ticks: nextTicks === 0 ? 0 : nextTicks,
	});
}

export function resizeTransitionDuration({
	startDuration,
	deltaTime,
	side,
	fromDuration,
	toDuration,
	fps,
}: {
	startDuration: MediaTime;
	deltaTime: MediaTime;
	side: "left" | "right";
	fromDuration: MediaTime;
	toDuration: MediaTime;
	fps: FrameRate;
}): MediaTime {
	return clampTransitionDuration({
		duration: symmetricDurationFromEdgeDelta({
			startDuration,
			deltaTime,
			side,
		}),
		fromDuration,
		toDuration,
		fps,
	});
}

export function packTimelineSampleTime({
	timelineTime,
	windowStart,
	duration,
	packTimelineDurationSec,
}: {
	timelineTime: number;
	windowStart: number;
	duration: number;
	packTimelineDurationSec: number;
}): number {
	if (duration <= 0) {
		return 0;
	}
	const u = Math.min(1, Math.max(0, (timelineTime - windowStart) / duration));
	return u * Math.max(0, packTimelineDurationSec);
}

export function clampTransitionDuration({
	duration,
	fromDuration,
	toDuration,
	fps,
	maxCapSec = MAX_TRANSITION_DURATION_SEC,
}: {
	duration: MediaTime;
	fromDuration: MediaTime;
	toDuration: MediaTime;
	fps: FrameRate;
	maxCapSec?: number;
}): MediaTime {
	const fpsFloat = fps.numerator / fps.denominator;
	const min = roundFrameTime({
		time: mediaTimeFromSeconds({ seconds: 2 / fpsFloat }),
		fps,
	});
	const maxByClips = mediaTimeFromSeconds({
		seconds:
			2 *
			Math.min(
				mediaTimeToSeconds({ time: fromDuration }),
				mediaTimeToSeconds({ time: toDuration }),
			),
	});
	const maxCap = mediaTimeFromSeconds({ seconds: maxCapSec });
	const max = minMediaTime({ a: maxByClips, b: maxCap });
	let clamped = duration;
	if (clamped < min) {
		clamped = min;
	}
	if (clamped > max) {
		clamped = max;
	}
	return roundFrameTime({ time: clamped, fps });
}
