import type { DropTarget, TimelineTrack } from "@/timeline";
import { timelineTimeToPixels } from "@/timeline/pixel-utils";
import { listAdjacentCuts } from "@/timeline/transitions";
import { TIMELINE_CONTENT_TOP_PADDING_PX } from "@/timeline/components/layout";
import {
	getCumulativeHeightBefore,
	getTrackHeight,
} from "@/timeline/components/track-layout";

/** Pixel radius around a cut that accepts a transition-pack drop. */
export const TRANSITION_CUT_HIT_THRESHOLD_PX = 12;

/**
 * Hit-test a transition pack against adjacent cuts.
 * Time comes from mouse X; the track comes from mouse Y.
 * Returns null when the pointer is on a non-video track, a gap, or
 * farther than {@link TRANSITION_CUT_HIT_THRESHOLD_PX} from every cut.
 */
export function resolveTransitionCutDrop({
	mouseX,
	mouseY,
	tracks,
	zoomLevel,
}: {
	mouseX: number;
	mouseY: number;
	tracks: TimelineTrack[];
	zoomLevel: number;
}): DropTarget | null {
	const hit = findTrackAtY({ mouseY, tracks });
	if (!hit || hit.track.type !== "video") return null;

	const cuts = listAdjacentCuts({ elements: hit.track.elements });
	const nearest = nearestCutWithinThreshold({
		cuts,
		mouseX,
		zoomLevel,
	});
	if (!nearest) return null;

	return {
		trackIndex: hit.trackIndex,
		isNewTrack: false,
		insertPosition: null,
		xPosition: nearest.cutTime,
		targetElement: null,
		transitionCut: {
			trackId: hit.track.id,
			fromElementId: nearest.fromId,
			toElementId: nearest.toId,
			cutTime: nearest.cutTime,
		},
	};
}

function findTrackAtY({
	mouseY,
	tracks,
}: {
	mouseY: number;
	tracks: TimelineTrack[];
}): { track: TimelineTrack; trackIndex: number } | null {
	const y = mouseY - TIMELINE_CONTENT_TOP_PADDING_PX;
	if (y < 0) return null;

	for (let trackIndex = 0; trackIndex < tracks.length; trackIndex++) {
		const top = getCumulativeHeightBefore({ tracks, trackIndex });
		const height = getTrackHeight({ type: tracks[trackIndex].type });
		if (y >= top && y < top + height) {
			return { track: tracks[trackIndex], trackIndex };
		}
	}

	return null;
}

function nearestCutWithinThreshold({
	cuts,
	mouseX,
	zoomLevel,
}: {
	cuts: ReturnType<typeof listAdjacentCuts>;
	mouseX: number;
	zoomLevel: number;
}): ReturnType<typeof listAdjacentCuts>[number] | null {
	let nearest: ReturnType<typeof listAdjacentCuts>[number] | null = null;
	let nearestDistance = TRANSITION_CUT_HIT_THRESHOLD_PX;

	for (const cut of cuts) {
		const cutX = timelineTimeToPixels({ time: cut.cutTime, zoomLevel });
		const distance = Math.abs(mouseX - cutX);
		if (nearest === null) {
			if (distance <= TRANSITION_CUT_HIT_THRESHOLD_PX) {
				nearest = cut;
				nearestDistance = distance;
			}
			continue;
		}
		if (distance < nearestDistance) {
			nearest = cut;
			nearestDistance = distance;
		}
	}

	return nearest;
}
