import type { RetimeConfig } from "@/timeline";
import {
	getClipTimeAtSourceTime,
	getSourceTimeAtClipTime,
} from "@/retime/resolve";

export function getMappedSourceTime({
	clipTime,
	clipDuration,
	trimStart,
	retime,
	reversed = false,
}: {
	clipTime: number;
	clipDuration: number;
	trimStart: number;
	retime?: RetimeConfig;
	reversed?: boolean;
}): number {
	const forwardDelta = getSourceTimeAtClipTime({
		clipTime,
		retime,
		clipDuration,
	});
	if (!reversed) {
		return trimStart + forwardDelta;
	}
	const span = getSourceTimeAtClipTime({
		clipTime: clipDuration,
		retime,
		clipDuration,
	});
	return trimStart + span - forwardDelta;
}

export function getMappedClipTimeFromSource({
	sourceTime,
	clipDuration,
	trimStart,
	retime,
	reversed = false,
}: {
	sourceTime: number;
	clipDuration: number;
	trimStart: number;
	retime?: RetimeConfig;
	reversed?: boolean;
}): number {
	const delta = sourceTime - trimStart;
	if (!reversed) {
		return getClipTimeAtSourceTime({
			sourceTime: delta,
			retime,
			clipDuration,
		});
	}
	const span = getSourceTimeAtClipTime({
		clipTime: clipDuration,
		retime,
		clipDuration,
	});
	return getClipTimeAtSourceTime({
		sourceTime: span - delta,
		retime,
		clipDuration,
	});
}
