import type { SceneTracks, VideoTrack } from "../types";
import { findAdjacentCut } from "./adjacency";

/** Older projects were saved before cut transitions existed. */
export function ensureVideoTrackTransitions({
	track,
}: {
	track: VideoTrack;
}): VideoTrack {
	if (Array.isArray(track.transitions)) {
		return track;
	}
	return { ...track, transitions: [] };
}

export function ensureSceneTrackTransitions({
	tracks,
}: {
	tracks: SceneTracks;
}): SceneTracks {
	const main = ensureVideoTrackTransitions({ track: tracks.main });
	let overlayChanged = false;
	const overlay = tracks.overlay.map((track) => {
		if (track.type !== "video") {
			return track;
		}
		const next = ensureVideoTrackTransitions({ track });
		if (next !== track) {
			overlayChanged = true;
		}
		return next;
	});
	if (main === tracks.main && !overlayChanged) {
		return tracks;
	}
	return { ...tracks, main, overlay };
}

export function pruneInvalidTransitions({
	track,
}: {
	track: VideoTrack;
}): VideoTrack {
	const ensured = ensureVideoTrackTransitions({ track });
	const transitions = ensured.transitions.filter(
		(edge) =>
			findAdjacentCut({
				elements: track.elements,
				fromId: edge.fromElementId,
				toId: edge.toElementId,
			}) !== null,
	);
	if (ensured === track && transitions.length === ensured.transitions.length) {
		return track;
	}
	return { ...ensured, transitions };
}

export function pruneAllTracks({
	tracks,
}: {
	tracks: SceneTracks;
}): SceneTracks {
	const main = pruneInvalidTransitions({ track: tracks.main });
	let overlayChanged = false;
	const overlay = tracks.overlay.map((track) => {
		if (track.type !== "video") {
			return track;
		}
		const pruned = pruneInvalidTransitions({ track });
		if (pruned !== track) {
			overlayChanged = true;
		}
		return pruned;
	});
	if (main === tracks.main && !overlayChanged) {
		return tracks;
	}
	return {
		...tracks,
		main,
		overlay,
	};
}
