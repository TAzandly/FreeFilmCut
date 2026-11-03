import { Command, type CommandResult } from "@/commands/base-command";
import { EditorCore } from "@/core";
import { clampTransitionDuration } from "@/timeline/transitions";
import type { SceneTracks } from "@/timeline";
import type { MediaTime } from "@/wasm";
import {
	readTransitionFps,
	requireVideoTrack,
	updateVideoTrackInSceneTracks,
} from "./video-track";

export class SetTransitionDurationCommand extends Command {
	private savedState: SceneTracks | null = null;
	private readonly trackId: string;
	private readonly transitionId: string;
	private readonly duration: MediaTime;

	constructor({
		trackId,
		transitionId,
		duration,
	}: {
		trackId: string;
		transitionId: string;
		duration: MediaTime;
	}) {
		super();
		this.trackId = trackId;
		this.transitionId = transitionId;
		this.duration = duration;
	}

	execute(): CommandResult | undefined {
		const editor = EditorCore.getInstance();
		const tracks = editor.scenes.getActiveScene().tracks;
		const track = requireVideoTrack({ tracks, trackId: this.trackId });
		const edge = track.transitions.find(
			(transition) => transition.id === this.transitionId,
		);
		if (!edge) {
			throw new Error("Transition not found");
		}
		const fromElement = track.elements.find(
			(element) => element.id === edge.fromElementId,
		);
		const toElement = track.elements.find(
			(element) => element.id === edge.toElementId,
		);
		if (!fromElement || !toElement) {
			throw new Error("Transition clips not found");
		}

		this.savedState = tracks;
		const duration = clampTransitionDuration({
			duration: this.duration,
			fromDuration: fromElement.duration,
			toDuration: toElement.duration,
			fps: readTransitionFps(),
		});
		const updatedTracks = updateVideoTrackInSceneTracks({
			tracks,
			trackId: this.trackId,
			update: (videoTrack) => ({
				...videoTrack,
				transitions: videoTrack.transitions.map((transition) =>
					transition.id === this.transitionId
						? { ...transition, duration }
						: transition,
				),
			}),
		});

		editor.timeline.updateTracks(updatedTracks);
		return undefined;
	}

	undo(): void {
		if (this.savedState) {
			EditorCore.getInstance().timeline.updateTracks(this.savedState);
		}
	}
}
