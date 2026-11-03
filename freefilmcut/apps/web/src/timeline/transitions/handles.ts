import { getSourceTimeAtClipTime } from "@/retime";
import type { MediaTime } from "@/wasm";
import { mediaTime, mediaTimeToSeconds } from "@/wasm";

export type TransitionSourceRole = "from" | "to";

export function sampleTransitionSourceTime({
	role,
	timelineTime,
	elementStart,
	elementDuration,
	trimStart,
	trimEnd,
	sourceDuration,
	cutTime: _cutTime,
}: {
	role: TransitionSourceRole;
	timelineTime: MediaTime;
	elementStart: MediaTime;
	elementDuration: MediaTime;
	trimStart: MediaTime;
	trimEnd: MediaTime;
	sourceDuration: MediaTime | undefined;
	cutTime: MediaTime;
}): { sourceTimeSec: number; frozen: boolean } {
	void _cutTime;
	const clipTime = timelineTime - elementStart;
	const mappedSourceOffset = getSourceTimeAtClipTime({ clipTime });
	let sourceTicks = trimStart + mappedSourceOffset;
	let frozen = false;

	if (role === "to" && clipTime < 0) {
		const desired = trimStart + mappedSourceOffset;
		if (desired < 0) {
			sourceTicks = trimStart;
			frozen = true;
		}
	}

	if (sourceDuration !== undefined) {
		const maxExclusive = sourceDuration - trimEnd;
		const lastSampleable =
			maxExclusive > 0 ? maxExclusive - 1 : mediaTime({ ticks: 0 });

		if (sourceTicks >= maxExclusive) {
			sourceTicks = lastSampleable;
			frozen = true;
		}
	}

	return {
		sourceTimeSec: mediaTimeToSeconds({
			time: mediaTime({ ticks: sourceTicks }),
		}),
		frozen,
	};
}
