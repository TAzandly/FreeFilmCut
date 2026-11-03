import type { FrameRate } from "opencut-wasm";
import { EditorCore } from "@/core";
import { DEFAULT_FPS } from "@/fps/defaults";
import { findTrackInSceneTracks } from "@/timeline/track-element-update";
import { ensureVideoTrackTransitions } from "@/timeline/transitions/prune";
import type { SceneTracks, VideoTrack } from "@/timeline";

export function readTransitionFps(): FrameRate {
	return (
		EditorCore.getInstance().project.getActiveOrNull()?.settings.fps ??
		DEFAULT_FPS
	);
}

export function requireVideoTrack({
	tracks,
	trackId,
}: {
	tracks: SceneTracks;
	trackId: string;
}): VideoTrack {
	const track = findTrackInSceneTracks({ tracks, trackId });
	if (!track || track.type !== "video") {
		throw new Error("Video track not found");
	}
	return ensureVideoTrackTransitions({ track });
}

export function updateVideoTrackInSceneTracks({
	tracks,
	trackId,
	update,
}: {
	tracks: SceneTracks;
	trackId: string;
	update: (track: VideoTrack) => VideoTrack;
}): SceneTracks {
	if (tracks.main.id === trackId) {
		return {
			...tracks,
			main: update(ensureVideoTrackTransitions({ track: tracks.main })),
		};
	}

	const overlayIndex = tracks.overlay.findIndex(
		(track) => track.id === trackId,
	);
	if (overlayIndex < 0) {
		return tracks;
	}

	const overlayTrack = tracks.overlay[overlayIndex];
	if (!overlayTrack || overlayTrack.type !== "video") {
		return tracks;
	}

	return {
		...tracks,
		overlay: tracks.overlay.map((track, index) =>
			index === overlayIndex
				? update(ensureVideoTrackTransitions({ track: overlayTrack }))
				: track,
		),
	};
}
